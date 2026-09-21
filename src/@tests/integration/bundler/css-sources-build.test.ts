import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { buildSpaceClient } from 'modules/bundler/build-client.ts'
import { setGlobalCssPaths } from 'modules/render/css-manifest.ts'
import { addCssSources, resetCssSources } from 'modules/render/css-sources.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

async function withTempDir(run: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    await run(root)
  } finally {
    resetCssSources()
    setGlobalCssPaths(undefined)
    await Deno.remove(root, { recursive: true })
  }
}

/** The built CSS of the `index`-th entry of the manifest's `global` scope. */
async function builtGlobalCss(
  outDir: string,
  manifest: { global: (string | { href: string })[] },
  index: number,
): Promise<string> {
  const entry = manifest.global[index]
  const href = typeof entry === 'string' ? entry : entry.href
  return await Deno.readTextFile(join(outDir, href.replace(/^\//, '')))
}

for (const renderer of ['react', 'preact'] as const) {
  Deno.test(
    `buildSpaceClient (renderer: '${renderer}'): a declared cssSource is built and listed in ` +
      "css-manifest.json ahead of the app's own globalCss, in declaration order",
    async () => {
      await withTempDir(async (root) => {
        await Deno.writeTextFile(join(root, 'app.css'), '.app { color: red; }\n')
        setGlobalCssPaths(['./app.css'])
        addCssSources([
          { name: 'iam', css: ':where(.x) { margin: 1px; }\n' },
          { name: 'ui', css: () => '.ui { padding: 2px; }\n' },
        ])

        const result = await buildSpaceClient({ root, renderer, css: { tailwind: false } })
        const manifest = JSON.parse(
          await Deno.readTextFile(join(result.outDir, 'css-manifest.json')),
        )

        assertEquals(manifest.global.length, 3)
        assert((await builtGlobalCss(result.outDir, manifest, 0)).includes('margin:1px'))
        assert((await builtGlobalCss(result.outDir, manifest, 1)).includes('padding:2px'))
        assert((await builtGlobalCss(result.outDir, manifest, 2)).includes('color:red'))
      })
    },
  )

  Deno.test(
    `buildSpaceClient (renderer: '${renderer}'): a source with media keeps it in the manifest`,
    async () => {
      await withTempDir(async (root) => {
        addCssSources([{ name: 'print', css: '.p { color: black; }\n', media: 'print' }])

        const result = await buildSpaceClient({ root, renderer, css: { tailwind: false } })
        const manifest = JSON.parse(
          await Deno.readTextFile(join(result.outDir, 'css-manifest.json')),
        )

        assertEquals(manifest.global.length, 1)
        assertEquals(manifest.global[0].media, 'print')
      })
    },
  )
}

Deno.test(
  'buildSpaceClient: a caller that passes its own globalCss owns the whole list, sources are not added',
  async () => {
    await withTempDir(async (root) => {
      await Deno.writeTextFile(join(root, 'own.css'), '.own { color: blue; }\n')
      addCssSources([{ name: 'iam', css: '.a { color: red; }\n' }])

      const result = await buildSpaceClient({
        root,
        globalCss: ['./own.css'],
        css: { tailwind: false },
      })
      const manifest = JSON.parse(
        await Deno.readTextFile(join(result.outDir, 'css-manifest.json')),
      )
      assertEquals(manifest.global.length, 1)
      assert((await builtGlobalCss(result.outDir, manifest, 0)).includes('color:#00f'))
    })
  },
)
