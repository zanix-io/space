import { assert, assertEquals } from '@std/assert'
import { build } from 'vite'
import type { Rollup } from 'vite'
import deno from '@deno/vite-plugin'
import { getTemporaryFolder } from '@zanix/helpers'
import { cometPlugin } from 'modules/bundler/comet-plugin.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

/**
 * Real network resolution against `jsr.io`, same convention `deno-optimize-deps-alias.test.ts`'s
 * own "leaves a specifier that resolves to a remote JSR module alone" test already establishes for
 * exactly this class of case — a real `@deno/vite-plugin` resolution of a genuinely remote
 * specifier can't be faithfully reproduced by a hand-written stub (confirmed empirically: a plain
 * `resolveId`/`load` stub standing in for `@deno/vite-plugin`'s own wrapped id hits an unrelated
 * Rollup tree-shaking difference for a synthetic, disconnected entry with no real importer — never
 * the actual thing this test needs to verify).
 */
const REMOTE_COMET_URL =
  'https://jsr.io/@zanix/space/1.5.0/src/modules/comets/submit-guard-react.tsx'

/**
 * Real `vite build()` runs, not mocks — this is the one place in this package's suite that
 * actually exercises the bundler, because `cometPlugin`'s entire job (forcing a separate output
 * chunk, then writing a manifest that correlates back to it) can only be verified against real
 * bundler output; asserting on the plugin's own hooks in isolation would prove nothing about
 * whether the resulting build is actually split and manifested the way a comet needs it to be.
 */
Deno.test(
  "cometPlugin: forces a 'use comet' file into its own chunk, not inlined into its importer",
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.mkdir(`${root}/comets`, { recursive: true })
      const counterPath = `${root}/comets/counter.tsx`
      await Deno.writeTextFile(
        counterPath,
        '\'use comet\'\nexport function Counter() { return "counter" }\n',
      )
      await Deno.writeTextFile(
        `${root}/main.ts`,
        "import { Counter } from './comets/counter.tsx'\nconsole.log(Counter())\n",
      )

      const result = await build({
        root,
        logLevel: 'silent',
        build: {
          write: false,
          minify: false,
          rollupOptions: { input: `${root}/main.ts` },
        },
        plugins: [cometPlugin()],
      })

      // `cometPlugin` resolves through the real (symlink-resolved) filesystem path, matching what
      // Rollup/Rolldown themselves use for a chunk's own `facadeModuleId` — real on some systems
      // (e.g. macOS's `/tmp`/`/var`) even for a freshly made temp dir.
      const realCounterPath = await Deno.realPath(counterPath)

      const { output } = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
      const chunks = output.filter((entry): entry is Rollup.OutputChunk => entry.type === 'chunk')
      const assets = output.filter((entry) => entry.type === 'asset')

      const cometChunk = chunks.find((chunk) => chunk.facadeModuleId === realCounterPath)
      const mainChunk = chunks.find((chunk) => chunk.facadeModuleId?.endsWith('main.ts'))

      assert(cometChunk, 'expected a dedicated chunk for the "use comet" file')
      assert(mainChunk, 'expected a chunk for the main entry')
      assertEquals(
        chunks.length,
        2,
        'the comet must not be inlined into any other chunk',
      )
      assert(cometChunk.code.includes('function Counter'), cometChunk.code)
      assert(
        !mainChunk.code.includes('function Counter'),
        'the importer must reference the comet chunk, not duplicate its code',
      )

      const manifestAsset = assets.find((asset) => asset.fileName === 'comets-manifest.json')
      assert(manifestAsset, 'expected a comets-manifest.json asset')
      const manifest = JSON.parse(manifestAsset.source as string)
      assertEquals(manifest[realCounterPath], `/${cometChunk.fileName}`)
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  "cometPlugin: a 'server-only' module reached through a non-filesystem id (e.g. a remote " +
    "JSR-resolved specifier `Deno.realPath` can't resolve) reports the violation instead of " +
    'crashing the build',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.mkdir(`${root}/comets`, { recursive: true })
      await Deno.writeTextFile(
        `${root}/comets/counter.tsx`,
        "'use comet'\nimport { secret } from 'virtual:remote-server-only'\n" +
          'export function Counter() { return secret }\n',
      )
      await Deno.writeTextFile(
        `${root}/main.ts`,
        "import { Counter } from './comets/counter.tsx'\nconsole.log(Counter())\n",
      )

      // Stands in for a real remote JSR specifier (`deno::TypeScript::https://jsr.io/...`) that
      // `@deno/vite-plugin`'s own resolver can hand `transform` — any `id` `Deno.realPath` can't
      // resolve to a real on-disk path reproduces the same crash, without needing a real network
      // fetch to prove it.
      const remoteServerOnlyPlugin = {
        name: 'stub-remote-server-only',
        resolveId(source: string) {
          if (source === 'virtual:remote-server-only') return 'virtual:remote-server-only'
        },
        load(id: string) {
          if (id === 'virtual:remote-server-only') return "'server-only'\nexport const secret = 1\n"
        },
      }

      let thrown: unknown
      try {
        await build({
          root,
          logLevel: 'silent',
          build: {
            write: false,
            minify: false,
            rollupOptions: { input: `${root}/main.ts` },
          },
          plugins: [remoteServerOnlyPlugin, cometPlugin()],
        })
      } catch (error) {
        thrown = error
      }

      assert(thrown, 'expected the build to fail on the server-only violation')
      const message = String((thrown as { message?: string })?.message ?? thrown)
      assert(
        message.includes('Server-only module imported into client Comet'),
        `expected the clean violation message, got: ${message}`,
      )
      assert(
        !message.includes('NUL byte') && !message.includes('unexpected'),
        `expected no raw realpath crash, got: ${message}`,
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'cometPlugin: a Comet whose own SOURCE FILE resolves through a remote specifier (e.g. a ' +
    'ready-made Comet this package itself ships, used from a jsr:-installed consumer) gets a ' +
    'real comets-manifest.json entry keyed by its plain, resolved URL — never a crash on ' +
    "@deno/vite-plugin's own wrapped id, and never keyed by that wrapped id either. Exercised " +
    "against this package's own real, published SubmitGuard source (immutable once published, " +
    'so this never drifts against a moving target)',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      // A ready-made Comet is always registered as a known entry (`build-client.ts`'s own doc),
      // so the plain resolved URL itself is the `rollupOptions.input` value, exactly as that
      // wiring does — never the wrapped id `@deno/vite-plugin`'s own resolver produces for it.
      const result = await build({
        root,
        logLevel: 'silent',
        build: {
          write: false,
          minify: false,
          rollupOptions: { input: { comet: REMOTE_COMET_URL } },
        },
        plugins: [deno(), cometPlugin({ knownEntryPaths: [REMOTE_COMET_URL] })],
      })

      const { output } = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
      const chunks = output.filter((entry): entry is Rollup.OutputChunk => entry.type === 'chunk')
      const assets = output.filter((entry) => entry.type === 'asset')

      const cometChunk = chunks.find((chunk) =>
        chunk.moduleIds.some((id) => id.includes(REMOTE_COMET_URL))
      )
      assert(cometChunk, 'expected a chunk for the remote comet entry')
      assert(cometChunk.code.includes('SubmitGuard'), cometChunk.code)

      const manifestAsset = assets.find((asset) => asset.fileName === 'comets-manifest.json')
      assert(manifestAsset, 'expected a comets-manifest.json asset')
      const manifest = JSON.parse(manifestAsset.source as string)
      assertEquals(manifest[REMOTE_COMET_URL], `/${cometChunk.fileName}`)
      // The wrapped, NUL-prefixed id `@deno/vite-plugin` actually resolves this specifier to must
      // never leak into the manifest as its own (unmatched) key — confirmed by asserting the
      // manifest holds EXACTLY the one, plain-URL-keyed entry a real runtime lookup can use.
      assertEquals(Object.keys(manifest), [REMOTE_COMET_URL])
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test('cometPlugin: a file with no "use comet" directive is left alone entirely', async () => {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    await Deno.mkdir(`${root}/comets`, { recursive: true })
    await Deno.writeTextFile(
      `${root}/comets/plain.tsx`,
      'export function Plain() { return "plain" }\n',
    )
    await Deno.writeTextFile(
      `${root}/main.ts`,
      "import { Plain } from './comets/plain.tsx'\nconsole.log(Plain())\n",
    )

    const result = await build({
      root,
      logLevel: 'silent',
      build: { write: false, rollupOptions: { input: `${root}/main.ts` } },
      plugins: [cometPlugin()],
    })

    const { output } = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
    const chunks = output.filter((entry): entry is Rollup.OutputChunk => entry.type === 'chunk')
    const assets = output.filter((entry) => entry.type === 'asset')

    assertEquals(
      chunks.length,
      1,
      'no directive, no split — inlined into the single entry chunk',
    )
    assertEquals(
      assets.find((a) => a.fileName === 'comets-manifest.json'),
      undefined,
    )
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test(
  "cometPlugin: a wrapped remote id whose OWN resolved value contains a literal '::' is never " +
    'truncated — the manifest key keeps the full value, matching what a real `import.meta.url` ' +
    'would actually be for it. Calls `transform`/`generateBundle` directly, bypassing a real ' +
    'Rollup build entirely: this exercises the id-unwrapping logic in isolation, the same way a ' +
    'real one never observably differs for THIS specific parsing question',
  async () => {
    // A hand-built wrapped id in the exact `deno::<loader>::<specifier>::<resolved>#deno` shape
    // `@deno/vite-plugin`'s own `toDenoSpecifier` produces — `resolved` deliberately contains its
    // own literal `::`, an edge case a real `https://`/`file://` value never produces today but
    // that a naive `lastIndexOf`-based parse would still mishandle if one ever did (silently
    // dropping everything before that inner `::`) — `@deno/vite-plugin`'s own `parseDenoSpecifier`
    // already guards against exactly this, and this plugin's own unwrap step mirrors it.
    const resolvedWithEmbeddedSeparator = 'https://jsr.io/@example/pkg/mod.ts?variant=a::b'
    const wrappedId = `\0deno::TSX::jsr:@example/pkg@^1.0.0::${resolvedWithEmbeddedSeparator}#deno`

    // Vite's own `Plugin['transform']`/`['generateBundle']` types are deeply recursive unions
    // this test has no interest in reproducing; a plain hook call only needs a `this` carrying
    // `emitFile` and the real (code, id)/(options, bundle) args, hence `any[]` for those.
    // deno-lint-ignore no-explicit-any
    type PluginHook = (this: { emitFile: (asset: unknown) => void }, ...args: any[]) => unknown

    const plugin = cometPlugin({ knownEntryPaths: [] })
    const fakeTransformContext = { emitFile: () => {} }
    await (plugin.transform as PluginHook).call(
      fakeTransformContext,
      "'use comet'\nexport default function C() {}\n",
      wrappedId,
    )

    let manifestSource: string | undefined
    const fakeGenerateBundleContext = {
      emitFile: (asset: unknown) => {
        const { fileName, source } = asset as { fileName: string; source: string }
        if (fileName === 'comets-manifest.json') manifestSource = source
      },
    }
    const fakeBundle: Record<string, unknown> = {
      'assets/example.js': {
        type: 'chunk',
        facadeModuleId: wrappedId,
        fileName: 'assets/example.js',
      },
    }
    ;(plugin.generateBundle as PluginHook).call(fakeGenerateBundleContext, {}, fakeBundle)

    assert(manifestSource, 'expected comets-manifest.json to have been emitted')
    const manifest = JSON.parse(manifestSource)
    assertEquals(manifest[resolvedWithEmbeddedSeparator], '/assets/example.js')
  },
)
