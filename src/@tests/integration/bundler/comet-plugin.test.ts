import { assert, assertEquals } from '@std/assert'
import { build } from 'vite'
import type { Rollup } from 'vite'
import { getTemporaryFolder } from '@zanix/helpers'
import { cometPlugin } from 'modules/bundler/comet-plugin.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

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
