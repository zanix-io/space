import { assert } from '@std/assert'

/**
 * Structural guard rails for the Asset API's own dependency shape — same real `deno info --json`
 * technique `src/@tests/unit/asset-transform/dependency-boundary.test.ts`/`i18n/
 * dependency-boundary.test.ts` already establish (transitive reachability, never a grep over
 * `deno.json`'s own `imports` map).
 *
 * Closes a real, found discrepancy: `assets.controller.ts`'s own module doc claims "see
 * `src/@tests/unit/assets-api/controller.test.ts`'s own import-boundary check" — but that file
 * only ever tested `ZanixController`-vs-`ZanixSsrController` and `denyAllGuard`'s own behavior, no
 * import graph at all. This file is that missing check, in its own dedicated
 * `dependency-boundary.test.ts` (matching the two existing files' own naming), not shoehorned into
 * `controller.test.ts`.
 *
 * @module
 */

interface ModuleGraph {
  code: Set<string>
  type: Set<string>
}

async function rawInfo(entry: string): Promise<{ roots: string[]; modules: unknown[] }> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ['info', '--json', entry],
    stdout: 'piped',
    stderr: 'piped',
  })
  const { stdout, stderr, success } = await command.output()
  if (!success) {
    throw new Error(`'deno info --json ${entry}' failed: ${new TextDecoder().decode(stderr)}`)
  }
  return JSON.parse(new TextDecoder().decode(stdout))
}

/** Flat union of every code/type edge across the WHOLE graph — matches the technique
 * `asset-transform/dependency-boundary.test.ts`/`i18n/dependency-boundary.test.ts` already use.
 * Correct for THOSE files' own claims (their entry point has no type-only edge into a module that
 * itself pulls in the forbidden package as code) — but NOT sound in general: a module reachable
 * only via a TYPE edge from `entry` still contributes ITS OWN code edges to this flat set, which
 * would wrongly implicate `entry` for a dependency it never actually loads at runtime. Kept for
 * the checks below where that distinction doesn't matter (nothing here is type-only-reachable);
 * see {@linkcode codeReachableFrom} for the check that specifically needs the sound version. */
async function moduleGraph(entry: string): Promise<ModuleGraph> {
  const parsed = await rawInfo(entry)
  const code = new Set<string>()
  const type = new Set<string>()
  // deno-lint-ignore no-explicit-any -- `deno info --json`'s own output shape, not this package's.
  for (const module of parsed.modules as any[]) {
    for (const dep of module.dependencies ?? []) {
      if (dep.code?.specifier) code.add(dep.code.specifier)
      if (dep.type?.specifier) type.add(dep.type.specifier)
    }
  }
  return { code, type }
}

/** The SOUND version: real BFS from `entry`'s own resolved root, following ONLY `code` edges —
 * exactly what a real `deno run`/bundler would actually load at runtime. A module reachable from
 * `entry` ONLY through a `type`-only edge (e.g. `import type { AssetService } from
 * '../asset-service.ts'`) is correctly EXCLUDED here, along with everything asset-service.ts's own
 * CODE imports (ffmpeg included) — because none of that is ever really loaded when only the
 * controller itself runs. This is what {@linkcode moduleGraph}'s own flat aggregation cannot
 * distinguish. */
async function codeReachableFrom(entry: string): Promise<Set<string>> {
  const parsed = await rawInfo(entry)
  const byspecifier = new Map<string, string[]>()
  // deno-lint-ignore no-explicit-any -- `deno info --json`'s own output shape, not this package's.
  for (const module of parsed.modules as any[]) {
    const codeDeps = (module.dependencies ?? [])
      .map((dep: { code?: { specifier?: string } }) => dep.code?.specifier)
      .filter((specifier: string | undefined): specifier is string => Boolean(specifier))
    byspecifier.set(module.specifier, codeDeps)
  }

  const visited = new Set<string>()
  const queue = [...parsed.roots]
  while (queue.length > 0) {
    const current = queue.shift() as string
    if (visited.has(current)) continue
    visited.add(current)
    for (const dep of byspecifier.get(current) ?? []) {
      if (!visited.has(dep)) queue.push(dep)
    }
  }
  return visited
}

function includesLocalPathSegment(specifiers: Set<string>, segment: string): boolean {
  return [...specifiers].some((specifier) => specifier.includes(segment))
}

const CONTROLLER_ENTRY = 'src/modules/assets-api/controllers/assets.controller.ts'

// --- Claim: the controller never touches ffmpeg/sharp/filesystem/storage backends directly — it
// only ever calls `service`, a real value INJECTED at construction time. Proven by showing
// `asset-service.ts` (the one file that DOES import a real ffmpeg-backed `AssetTransformer`) is
// reachable ONLY as a type, never as code, from the controller's own module graph. -----------------

Deno.test(
  'assets.controller.ts: asset-service.ts (the real ffmpeg-backed implementation) is reachable ' +
    'only as a TYPE, never as CODE — the controller genuinely never constructs its own service',
  async () => {
    const graph = await moduleGraph(CONTROLLER_ENTRY)
    assert(
      !includesLocalPathSegment(graph.code, 'asset-service.ts'),
      'assets.controller.ts must never resolve asset-service.ts as code — `service` is injected',
    )
    assert(
      includesLocalPathSegment(graph.type, 'asset-service.ts'),
      'sanity check: the controller must still reference AssetService as a TYPE (its own ' +
        '`options.service` parameter) — a fully absent reference would mean this test stopped ' +
        'checking anything real',
    )
  },
)

Deno.test(
  'assets.controller.ts: the ffmpeg adapter, the video/thumbnail transcoder, and sharp-backed ' +
    'image optimization are never really LOADED at runtime — proven via a real code-only-edge ' +
    "BFS from the controller's own entry, not the coarser whole-graph aggregation above (which " +
    "would wrongly flag this: asset-service.ts's OWN code edges reach all of these, but " +
    'asset-service.ts itself is only ever a TYPE edge away from the controller — see ' +
    "codeReachableFrom's own doc)",
  async () => {
    const reachable = await codeReachableFrom(CONTROLLER_ENTRY)
    const forbidden = [
      'system-ffmpeg-audio-transcoder.ts',
      'system-ffmpeg-transcoder.ts',
      'cached-audio-transcoder.ts',
      'cached-video-transcoder.ts',
      'image-optimize.ts',
      'cached-image-optimizer.ts',
      '/asset-transform/asset-transformer.ts',
      'asset-service.ts',
    ]
    for (const segment of forbidden) {
      assert(
        !includesLocalPathSegment(reachable, segment),
        `assets.controller.ts must never really LOAD ${segment} at runtime`,
      )
    }
  },
)

Deno.test(
  'assets.controller.ts: never reaches Vite/bundler internals — it is a runtime HTTP surface, ' +
    'never a build-time concern',
  async () => {
    const graph = await moduleGraph(CONTROLLER_ENTRY)
    for (const pkg of ['vite', 'react', 'react-dom', 'preact']) {
      assert(!includesLocalPathSegment(graph.code, `npm:/${pkg}`), `${pkg} leaked in as code`)
    }
    assert(
      !includesLocalPathSegment(graph.code, '/modules/bundler/'),
      'assets.controller.ts must never resolve a module under modules/bundler/ as code',
    )
  },
)

// NOTE: "asset-transform never reaches back into assets-api" is ALREADY covered — for real, not
// redundantly re-added here — by `src/@tests/unit/asset-transform/dependency-boundary.test.ts`'s
// own "never reaches back into modules/assets-api/" test (same `deno info --json` technique, same
// `src/modules/asset-transform/mod.ts` entry point). Found while writing this file; not duplicated.

// --- Claim: `@zanix/datamaster` (and therefore S3/Mongo) never reaches this package's
// PUBLISHED `assets-api` surface — the composition deciding which `AssetStorage` implementation
// backs `AssetService` is exclusively a consuming application's job (see
// `src/@tests/support/resolve-asset-storage.ts`'s own doc), never this package's. Checked at both
// entry points that ship: the full barrel and the controller specifically. -----------------------

const ASSETS_API_ENTRIES = [
  'src/modules/assets-api/mod.ts',
  'src/modules/assets-api/controllers/assets.controller.ts',
]

function includesPackage(specifiers: Set<string>, pkg: string): boolean {
  return [...specifiers].some((specifier) => {
    if (specifier.startsWith(`jsr:${pkg}`)) return true
    if (!specifier.startsWith('npm:')) return false
    const rest = specifier.slice('npm:'.length).replace(/^\//, '')
    return rest === pkg || rest.startsWith(`${pkg}@`) || rest.startsWith(`${pkg}/`)
  })
}

for (const entry of ASSETS_API_ENTRIES) {
  Deno.test(
    `${entry}: never reaches @zanix/datamaster, at compile time or runtime`,
    async () => {
      const graph = await moduleGraph(entry)
      assert(
        !includesPackage(graph.code, '@zanix/datamaster'),
        `@zanix/datamaster leaked into ${entry} as code`,
      )
      assert(
        !includesPackage(graph.type, '@zanix/datamaster'),
        `@zanix/datamaster leaked into ${entry} as a type`,
      )
      assert(
        !includesLocalPathSegment(graph.code, '/storage/connector.ts'),
        `an S3 connector leaked into ${entry} as code (via a relative path)`,
      )
    },
  )
}
