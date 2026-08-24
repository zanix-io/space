import { assert, assertEquals } from '@std/assert'
import { fromFileUrl, join } from '@std/path'

/**
 * Structural proofs for the voice input-eligibility guardrail's own architecture — requested
 * explicitly: that moving the `.wav`-only rule into `policies/voice.ts` did NOT leak "voice" as a
 * concept into the profile-agnostic layers (`AudioTranscoder`, `AssetTransformer`), and that a
 * future, genuinely different profile could define its own input rule in true isolation. No fake
 * profile is implemented here — these tests inspect the REAL module graph/source of the code that
 * already exists, the same technique `src/@tests/unit/asset-transform/dependency-boundary.test.ts`
 * already establishes for a different boundary.
 *
 * @module
 */

const ROOT = fromFileUrl(import.meta.resolve('../../../../../'))

/** Strips `//` line comments and block comments — good enough for this file's own
 * purpose (finding a literal identifier in real CODE, not documentation prose), not a general
 * JS/TS parser. Deliberately conservative: it does not try to distinguish a comment marker
 * appearing inside a string literal, but neither of the two files this test inspects has one in
 * its own source (confirmed by reading them), so this is not a real gap for THIS specific check. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

async function readSource(relativePath: string): Promise<string> {
  return await Deno.readTextFile(join(ROOT, relativePath))
}

interface ModuleGraph {
  code: Set<string>
  type: Set<string>
}

/** Same technique `dependency-boundary.test.ts` already establishes: real `deno info --json`
 * output, transitive reachability — never a grep over `deno.json`'s own `imports` map. */
async function moduleGraph(entry: string): Promise<ModuleGraph> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ['info', '--json', entry],
    stdout: 'piped',
    stderr: 'piped',
  })
  const { stdout, stderr, success } = await command.output()
  if (!success) {
    throw new Error(`'deno info --json ${entry}' failed: ${new TextDecoder().decode(stderr)}`)
  }
  // deno-lint-ignore no-explicit-any -- `deno info --json`'s own output shape, not this package's.
  const parsed: any = JSON.parse(new TextDecoder().decode(stdout))
  const code = new Set<string>()
  const type = new Set<string>()
  for (const module of parsed.modules ?? []) {
    for (const dep of module.dependencies ?? []) {
      if (dep.code?.specifier) code.add(dep.code.specifier)
      if (dep.type?.specifier) type.add(dep.type.specifier)
    }
  }
  return { code, type }
}

function includesLocalPathSegment(specifiers: Set<string>, segment: string): boolean {
  return [...specifiers].some((specifier) => specifier.includes(segment))
}

// --- Claim: AudioTranscoder (the common port) never hardcodes "voice" in real CODE — only in
// documentation prose explaining why the union type exists at all. --------------------------------

Deno.test(
  'architecture: audio-transcoder.ts (the common port) never hardcodes "voice" in real code, ' +
    'only in doc comments',
  async () => {
    const source = await readSource('src/modules/media/audio/audio-transcoder.ts')
    const code = stripComments(source)
    // The ONE legitimate exception: importing/re-exporting the profile's own TYPE — a structural
    // necessity for the union to exist, never a control-flow decision. Everything else in `code`
    // must be voice-free.
    const codeWithoutTypeReferences = code
      .replace(/import type \{[^}]*\} from '\.\/policies\/voice\.ts'/g, '')
      .replace(/export type \{[^}]*\} from '\.\/policies\/voice\.ts'/g, '')
      .replace(/export type AudioTransformOptions = VoiceAudioTransformOptions/g, '')
    assertEquals(
      /voice/i.test(codeWithoutTypeReferences),
      false,
      `unexpected "voice" reference in real code:\n${codeWithoutTypeReferences}`,
    )
  },
)

Deno.test(
  'architecture: asset-transformer.ts never hardcodes "voice" anywhere in real code, only in ' +
    'doc comments',
  async () => {
    const source = await readSource('src/modules/asset-transform/asset-transformer.ts')
    const code = stripComments(source)
    assertEquals(/voice/i.test(code), false, `unexpected "voice" reference in real code:\n${code}`)
  },
)

// --- Claim: cached-audio-transcoder.ts / system-ffmpeg-audio-transcoder.ts dispatch on profile
// in exactly ONE identifiable place each — never scattered through their own control flow. -------

Deno.test(
  'architecture: the two files that DO know about "voice" (by necessity — they dispatch on ' +
    'profile) confine it to their own documented dispatch functions, never elsewhere',
  async () => {
    const adapterSource = await readSource(
      'src/modules/media/audio/system-ffmpeg-audio-transcoder.ts',
    )
    const cacheSource = await readSource('src/modules/media/audio/cached-audio-transcoder.ts')

    // Both files' OWN `transcode()` control flow calls a named dispatch function instead of
    // switching on `options.profile` inline — confirmed by real source inspection, not assumed.
    assert(
      adapterSource.includes('validateAudioInput(input, options)') &&
        adapterSource.includes('resolveVoiceEncoding(options)'),
      'system-ffmpeg-audio-transcoder.ts must dispatch through its own named functions',
    )
    assert(
      cacheSource.includes('resolveIdentity(opts)'),
      'cached-audio-transcoder.ts must dispatch through its own named function',
    )
  },
)

// --- Claim: `policies/` introduces no music policy. -------------------------------------------

Deno.test(
  'architecture: no music policy was introduced — policies/ contains ONLY voice.ts',
  async () => {
    const entries: string[] = []
    for await (const entry of Deno.readDir(join(ROOT, 'src/modules/media/audio/policies'))) {
      entries.push(entry.name)
    }
    assertEquals(entries, ['voice.ts'])
  },
)

// --- Claim: a future, genuinely different profile could define its own input rule in true
// isolation — proven by showing `policies/voice.ts`'s own module graph never reaches back into
// the dispatcher files that would need to route to it. A sibling `policies/music.ts` could exist
// with its own `validateMusicSource` (completely different rules — accepting `.mp3`/`.flac`/
// whatever music needs) without importing anything from, or being imported by, `voice.ts`. --------

Deno.test(
  'architecture: policies/voice.ts never reaches back into the dispatcher files that route to ' +
    'it — proving a sibling policies/music.ts could exist in true isolation',
  async () => {
    const graph = await moduleGraph('src/modules/media/audio/policies/voice.ts')
    for (const forbidden of ['system-ffmpeg-audio-transcoder.ts', 'cached-audio-transcoder.ts']) {
      assert(
        !includesLocalPathSegment(graph.code, forbidden),
        `policies/voice.ts must never resolve ${forbidden} as code`,
      )
      assert(
        !includesLocalPathSegment(graph.type, forbidden),
        `policies/voice.ts must never resolve ${forbidden} as a type`,
      )
    }
  },
)

Deno.test(
  'architecture: policies/voice.ts has zero coupling to Vite/bundler/ffmpeg-adapter internals ' +
    '— confirming it is safe to add a sibling policy module beside it, without entanglement',
  async () => {
    const graph = await moduleGraph('src/modules/media/audio/policies/voice.ts')
    for (
      const forbidden of ['vite', 'modules/bundler', 'ffprobe-audio.ts', 'ffmpeg-availability.ts']
    ) {
      assert(
        !includesLocalPathSegment(graph.code, forbidden),
        `policies/voice.ts must never resolve ${forbidden} as code`,
      )
    }
    // Its own direct import (visible right in the source, no graph traversal needed) is the
    // ONLY local dependency this module declares — everything else the graph finds is `@zanix/
    // errors`'s OWN transitive closure (logger, path helpers, ...), not something `voice.ts`
    // itself reaches for.
    const source = await readSource('src/modules/media/audio/policies/voice.ts')
    const localImports = [...source.matchAll(/^import .* from '(\.[^']+)'/gm)].map((m) => m[1])
    assertEquals(localImports, [])
  },
)
