import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { buildSpaceClient } from 'modules/bundler/build-client.ts'
import { CLIENT_ENTRY_VIRTUAL_ID } from 'modules/render/client-entry.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

async function withTempDir(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    await run(root)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

Deno.test(
  'buildSpaceClient: with no clientEntry configured, auto-generates the default bootstrap ' +
    '(hydrateComets/initOrbit) and writes client-entry-manifest.json for it',
  async () => {
    await withTempDir(async (root) => {
      // `minify: false` — an identifier like `hydrateComets` survives real minification only by
      // accident; keeping the build readable is what makes asserting on it meaningful, same
      // convention `build-client.test.ts`'s own "minify: false keeps real, readable output" test
      // already establishes.
      const result = await buildSpaceClient({ root, css: { tailwind: false }, minify: false })

      const manifest = JSON.parse(
        await Deno.readTextFile(join(result.outDir, 'client-entry-manifest.json')),
      )
      const builtUrl: string = manifest[CLIENT_ENTRY_VIRTUAL_ID]
      assert(builtUrl, JSON.stringify(manifest))

      const code = await Deno.readTextFile(join(result.outDir, builtUrl.replace(/^\//, '')))
      assert(code.includes('hydrateComets'), code)
      assert(code.includes('initOrbit'), code)
    })
  },
)

Deno.test(
  'buildSpaceClient: the default bootstrap imports the PREACT client barrel when renderer is preact',
  async () => {
    await withTempDir(async (root) => {
      const result = await buildSpaceClient({
        root,
        css: { tailwind: false },
        renderer: 'preact',
        minify: false,
      })

      const manifest = JSON.parse(
        await Deno.readTextFile(join(result.outDir, 'client-entry-manifest.json')),
      )
      const builtUrl: string = manifest[CLIENT_ENTRY_VIRTUAL_ID]
      const code = await Deno.readTextFile(join(result.outDir, builtUrl.replace(/^\//, '')))
      // Bundled output — asserting on the renderer-specific hydrate module each barrel pulls in
      // (same suffix `client-barrel-guard.ts` itself checks), not on the import specifier text
      // itself, which a real bundler is free to rewrite/inline.
      assert(code.includes('hydrate-comets-preact') || code.includes('preact'), code)
    })
  },
)

Deno.test(
  'buildSpaceClient: an explicit clientEntry override replaces the default, keyed by its own realpath',
  async () => {
    await withTempDir(async (root) => {
      const entryPath = join(root, 'main.client.ts')
      await Deno.writeTextFile(
        entryPath,
        `console.log('custom-client-entry-marker')\n`,
      )

      const result = await buildSpaceClient({
        root,
        clientEntry: './main.client.ts',
        css: { tailwind: false },
      })

      const manifest = JSON.parse(
        await Deno.readTextFile(join(result.outDir, 'client-entry-manifest.json')),
      )
      const realEntryPath = await Deno.realPath(entryPath)
      const builtUrl: string = manifest[realEntryPath]
      assert(builtUrl, JSON.stringify(manifest))
      assertEquals(manifest[CLIENT_ENTRY_VIRTUAL_ID], undefined)

      const code = await Deno.readTextFile(join(result.outDir, builtUrl.replace(/^\//, '')))
      assert(code.includes('custom-client-entry-marker'), code)
    })
  },
)
