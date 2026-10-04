import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { buildSpaceClient } from 'modules/bundler/build-client.ts'
import { setDevClientEnabled } from 'modules/dev/dev-client-registry.ts'
import {
  getGlobalCssPaths,
  resolveCssHrefs,
  setGlobalCssPaths,
} from 'modules/render/css-manifest.ts'
import {
  addCssSources,
  getCssSourcePaths,
  materializeCssSources,
  resetCssSources,
} from 'modules/render/css-sources.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

async function withTempDir(run: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    await run(root)
  } finally {
    setDevClientEnabled(false)
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

/** The built stylesheet texts of the manifest's `global` scope, in manifest order. */
async function builtGlobalTexts(
  outDir: string,
  manifest: { global: (string | { href: string })[] },
): Promise<string[]> {
  return await Promise.all(
    manifest.global.map((_, index) => builtGlobalCss(outDir, manifest, index)),
  )
}

async function readManifest(outDir: string): Promise<{ global: (string | { href: string })[] }> {
  return JSON.parse(await Deno.readTextFile(join(outDir, 'css-manifest.json')))
}

/** The source text of the files a root-relative path list names, in list order. */
async function sourceTexts(
  root: string,
  paths: (string | { href: string })[],
): Promise<string[]> {
  return await Promise.all(
    paths.map((ref) => Deno.readTextFile(join(root, typeof ref === 'string' ? ref : ref.href))),
  )
}

const MARKERS = ['.m-iam', '.m-ui', '.m-a', '.m-b'] as const

/** Each marker appears in exactly one built stylesheet: the order of the markers is the order of
 * the sheets, whatever hash the build gave them. */
function markerOrder(texts: string[]): string[] {
  return texts.map((text) => MARKERS.find((marker) => text.includes(marker.slice(1))) ?? '?')
}

Deno.test(
  "buildSpaceClient: a caller's own globalCss is merged behind the cssSources, never instead of them",
  async () => {
    await withTempDir(async (root) => {
      await Deno.writeTextFile(join(root, 'own.css'), '.own { color: blue; }\n')
      addCssSources([{ name: 'iam', css: '.a { color: red; }\n' }])

      const result = await buildSpaceClient({
        root,
        globalCss: ['./own.css'],
        css: { tailwind: false },
      })
      const manifest = await readManifest(result.outDir)
      assertEquals(manifest.global.length, 2)
      assert((await builtGlobalCss(result.outDir, manifest, 0)).includes('color:red'))
      assert((await builtGlobalCss(result.outDir, manifest, 1)).includes('color:#00f'))
    })
  },
)

Deno.test(
  'buildSpaceClient: the built manifest lists the stylesheets in the order zanix space dev serves ' +
    'them, with cssSources AND an explicit globalCss',
  async () => {
    await withTempDir(async (root) => {
      await Deno.writeTextFile(join(root, 'a.css'), '.m-a { color: green; }\n')
      await Deno.writeTextFile(join(root, 'b.css'), '.m-b { color: gray; }\n')
      setGlobalCssPaths(['./a.css', './b.css'])
      addCssSources([
        { name: 'iam', css: '.m-iam { margin: 1px; }\n' },
        { name: 'ui', css: '.m-ui { padding: 2px; }\n' },
      ])
      // What the CLI did: the app's list, read before the sources were files, passed explicitly.
      const explicit = getGlobalCssPaths()
      assertEquals(explicit, ['./a.css', './b.css'])

      const result = await buildSpaceClient({ root, globalCss: explicit, css: { tailwind: false } })
      const prod = markerOrder(
        await builtGlobalTexts(result.outDir, await readManifest(result.outDir)),
      )

      // The dev list: what `resolveCssHrefs()` resolves in `zanix space dev`.
      setDevClientEnabled(true)
      const devPaths = getGlobalCssPaths() ?? []
      const dev = markerOrder(await sourceTexts(root, devPaths))
      const devHrefs = resolveCssHrefs() ?? []

      assertEquals(prod, ['.m-iam', '.m-ui', '.m-a', '.m-b'])
      assertEquals(dev, prod)
      assertEquals(devHrefs.length, prod.length)
    })
  },
)

Deno.test(
  'buildSpaceClient: a globalCss that already names the materialized cssSources is not listed twice ' +
    'and keeps its own order',
  async () => {
    await withTempDir(async (root) => {
      await Deno.writeTextFile(join(root, 'a.css'), '.m-a { color: green; }\n')
      setGlobalCssPaths(['./a.css'])
      addCssSources([
        { name: 'iam', css: '.m-iam { margin: 1px; }\n' },
        { name: 'ui', css: '.m-ui { padding: 2px; }\n' },
      ])
      await materializeCssSources(root)
      // The caller read the list AFTER the sources were files: it already contains them...
      const alreadyComposed = getGlobalCssPaths() ?? []
      assertEquals(alreadyComposed.length, 3)
      // ...and a caller that put one of them after its own sheet keeps that choice.
      const reordered = ['./a.css', getCssSourcePaths()[0], getCssSourcePaths()[1]]

      const same = await buildSpaceClient({
        root,
        globalCss: alreadyComposed,
        css: { tailwind: false },
      })
      const sameManifest = await readManifest(same.outDir)
      assertEquals(sameManifest.global.length, 3)
      assertEquals(markerOrder(await builtGlobalTexts(same.outDir, sameManifest)), [
        '.m-iam',
        '.m-ui',
        '.m-a',
      ])

      const moved = await buildSpaceClient({ root, globalCss: reordered, css: { tailwind: false } })
      const movedManifest = await readManifest(moved.outDir)
      assertEquals(movedManifest.global.length, 3)
      assertEquals(markerOrder(await builtGlobalTexts(moved.outDir, movedManifest)), [
        '.m-a',
        '.m-iam',
        '.m-ui',
      ])
    })
  },
)

Deno.test(
  'buildSpaceClient: an @import inside a cssSource is flattened into that source, in its position',
  async () => {
    await withTempDir(async (root) => {
      await Deno.writeTextFile(join(root, 'shared.css'), '.m-b { color: gray; }\n')
      await Deno.writeTextFile(join(root, 'a.css'), '.m-a { color: green; }\n')
      setGlobalCssPaths(['./a.css'])
      // `.space/css-sources/iam.css` imports a file two directories up.
      addCssSources([
        { name: 'iam', css: "@import '../../shared.css';\n.m-iam { margin: 1px; }\n" },
      ])

      const result = await buildSpaceClient({
        root,
        globalCss: ['./a.css'],
        css: { tailwind: false },
      })
      const manifest = await readManifest(result.outDir)
      const texts = await builtGlobalTexts(result.outDir, manifest)
      assertEquals(texts.length, 2)
      // The source comes first, as one sheet that holds the imported rules before its own...
      assert(!texts[0].includes('@import'))
      assert(texts[0].includes('gray'))
      assert(texts[0].indexOf('gray') < texts[0].indexOf('margin'))
      // ...and the app's own sheet follows it.
      assert(texts[1].includes('green'))
    })
  },
)

Deno.test(
  "buildSpaceClient: with no globalCss argument the app's sources and its own list are built",
  async () => {
    await withTempDir(async (root) => {
      await Deno.writeTextFile(join(root, 'a.css'), '.m-a { color: green; }\n')
      setGlobalCssPaths(['./a.css'])
      addCssSources([{ name: 'iam', css: '.m-iam { margin: 1px; }\n' }])

      const result = await buildSpaceClient({ root, css: { tailwind: false } })
      const manifest = await readManifest(result.outDir)
      assertEquals(markerOrder(await builtGlobalTexts(result.outDir, manifest)), [
        '.m-iam',
        '.m-a',
      ])
    })
  },
)
