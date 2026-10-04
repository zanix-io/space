import { assert, assertEquals, assertFalse, assertNotEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { buildSpaceClient } from 'modules/bundler/build-client.ts'
import { getGlobalCssPaths, setGlobalCssPaths } from 'modules/render/css-manifest.ts'
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

const write = async (path: string, text: string) => {
  await Deno.mkdir(join(path, '..'), { recursive: true })
  await Deno.writeTextFile(path, text)
}
const layout = (styles: string, extra = '') =>
  `export const styles = ${styles}\n${extra}export default function Layout() { return null }\n`
const page = (styles?: string) =>
  `export default class Page {\n${styles ? `  static styles = ${styles}\n` : ''}}\n`

type Manifest = {
  global: (string | { href: string })[]
  layouts?: Record<string, (string | { href: string; media?: string })[]>
  pages?: Record<string, (string | { href: string })[]>
}

const hrefOf = (ref: string | { href: string }) => typeof ref === 'string' ? ref : ref.href
const readManifest = async (outDir: string): Promise<Manifest> =>
  JSON.parse(await Deno.readTextFile(join(outDir, 'css-manifest.json')))
const readBuilt = (outDir: string, ref: string | { href: string }) =>
  Deno.readTextFile(join(outDir, hrefOf(ref).replace(/^\//, '')))

Deno.test(
  "buildSpaceClient: a layout's styles are built, hashed and scoped under the manifest's layouts, " +
    'keyed by the layout file path; a layout only lists its own, and none reaches global',
  async () => {
    await withTempDir(async (root) => {
      const routes = join(root, 'routes')
      await write(join(routes, 'root.css'), '.root { color: red; }\n')
      await write(join(routes, 'a', 'a.css'), '.a { color: green; }\n')
      await write(join(routes, 'a', 'a-print.css'), '.ap { color: black; }\n')
      await write(join(routes, 'b', 'b.css'), '.b { color: blue; }\n')
      await write(join(routes, 'layout.tsx'), layout(`['./root.css']`))
      await write(
        join(routes, 'a', 'layout.tsx'),
        layout(`['./a.css', { href: './a-print.css', media: 'print' }]`),
      )
      await write(join(routes, 'b', 'layout.tsx'), layout(`['./b.css']`))
      await write(join(routes, 'a', 'page.tsx'), page())
      await write(join(routes, 'b', 'page.tsx'), page())

      const result = await buildSpaceClient({ root, css: { tailwind: false }, routesDir: routes })
      const manifest = await readManifest(result.outDir)
      const layouts = manifest.layouts ?? {}

      assertEquals(
        Object.keys(layouts).sort(),
        [
          join(routes, 'a', 'layout.tsx'),
          join(routes, 'b', 'layout.tsx'),
          join(routes, 'layout.tsx'),
        ].sort(),
      )
      // Declaration order, media threaded through, content built from the layout's own directory.
      const a = layouts[join(routes, 'a', 'layout.tsx')]
      assertEquals(a.length, 2)
      assert((await readBuilt(result.outDir, a[0])).includes('color:green'))
      assertEquals(typeof a[0], 'string')
      assert(typeof a[1] === 'object' && a[1].media === 'print')
      assert((await readBuilt(result.outDir, a[1])).includes('color:#000'))
      // A layout never lists a sibling's stylesheet, and a built file name carries a content hash.
      assertFalse(layouts[join(routes, 'b', 'layout.tsx')].map(hrefOf).join().includes('a-'))
      assert(/-[A-Za-z0-9_-]{6,}\.css$/.test(hrefOf(a[0])), hrefOf(a[0]))
      // Nothing a layout owns was folded into the global scope.
      assertEquals(manifest.global, [])
      assertEquals(manifest.pages, undefined)
    })
  },
)

Deno.test(
  'buildSpaceClient: a stylesheet that two layouts, or a layout and a page, import is listed under ' +
    'each of them — one real asset, linked wherever an owner applies — and still never in global',
  async () => {
    await withTempDir(async (root) => {
      const routes = join(root, 'routes')
      await write(join(routes, 'shared.css'), '.shared { color: red; }\n')
      await write(join(routes, 'a', 'layout.tsx'), layout(`['../shared.css']`))
      await write(join(routes, 'b', 'layout.tsx'), layout(`['../shared.css']`))
      await write(join(routes, 'a', 'page.tsx'), page(`['../shared.css']`))
      await write(join(routes, 'b', 'page.tsx'), page(`['../shared.css']`))
      await write(join(routes, 'c', 'page.tsx'), page(`['../shared.css']`))

      const result = await buildSpaceClient({ root, css: { tailwind: false }, routesDir: routes })
      const manifest = await readManifest(result.outDir)

      const expected = manifest.layouts?.[join(routes, 'a', 'layout.tsx')]
      assertEquals(expected?.length, 1)
      assertEquals(manifest.layouts?.[join(routes, 'b', 'layout.tsx')], expected)
      for (const name of ['a', 'b', 'c']) {
        assertEquals(manifest.pages?.[join(routes, name, 'page.tsx')], expected, name)
      }
      assertEquals(manifest.global, [])
    })
  },
)

Deno.test(
  'buildSpaceClient: a globalCss file that @imports other sheets is flattened into ONE built ' +
    'stylesheet, rules in import order, and its content hash follows the imported files',
  async () => {
    const files = async (root: string) => {
      await write(join(root, 'theme', 'a.css'), '.a { color: red; }\n')
      await write(join(root, 'theme', 'b.css'), '.b { color: blue; }\n')
      await write(
        join(root, 'theme', 'core.css'),
        "@import './a.css';\n@import './b.css';\n.core { margin: 0; }\n",
      )
    }
    let firstHref = ''
    await withTempDir(async (root) => {
      await files(root)
      const result = await buildSpaceClient({
        root,
        css: { tailwind: false },
        globalCss: ['./theme/core.css'],
      })
      const manifest = await readManifest(result.outDir)

      assertEquals(manifest.global.length, 1)
      const built = await readBuilt(result.outDir, manifest.global[0])
      assertFalse(built.includes('@import'), built)
      const order = ['color:red', 'color:#00f', 'margin:0'].map((rule) => built.indexOf(rule))
      assert(order.every((index) => index >= 0), built)
      assertEquals([...order].sort((x, y) => x - y), order, built)
      firstHref = hrefOf(manifest.global[0])
    })
    // The same entry with a changed imported file hashes differently: an @import is part of the
    // built content, so a cache keyed by the file name never serves a stale sheet.
    await withTempDir(async (root) => {
      await files(root)
      await write(join(root, 'theme', 'b.css'), '.b { color: green; }\n')
      const result = await buildSpaceClient({
        root,
        css: { tailwind: false },
        globalCss: ['./theme/core.css'],
      })
      const manifest = await readManifest(result.outDir)
      assertEquals(manifest.global.length, 1)
      assertNotEquals(hrefOf(manifest.global[0]), firstHref)
    })
  },
)

Deno.test(
  "buildSpaceClient: a stylesheet linked from a layout's head is just an href — the CSS pipeline " +
    'never builds, hashes or lists it',
  async () => {
    await withTempDir(async (root) => {
      const routes = join(root, 'routes')
      await write(join(routes, 'area.css'), '@import "./other.css";\n.area { color: red; }\n')
      await write(join(routes, 'other.css'), '.other { color: blue; }\n')
      await write(
        join(routes, 'layout.tsx'),
        layout(
          '[]',
          "export const head = { link: [{ rel: 'stylesheet', href: '/area.css' }] }\n",
        ),
      )
      await write(join(routes, 'page.tsx'), page())

      const result = await buildSpaceClient({ root, css: { tailwind: false }, routesDir: routes })
      const manifest = await readManifest(result.outDir).catch(() => undefined)

      assertEquals(manifest?.global ?? [], [])
      assertEquals(manifest?.layouts, undefined)
      const built: string[] = []
      for await (const entry of Deno.readDir(join(result.outDir, 'assets'))) built.push(entry.name)
      assertFalse(built.some((name) => name.endsWith('.css')), built.join())
    })
  },
)

Deno.test(
  'buildSpaceClient: the cssSources a caller leaves out of an explicit globalCss are built in front ' +
    'of it — the shape `zanix space build` used to pass, which dropped them from the production manifest',
  async () => {
    await withTempDir(async (root) => {
      await write(join(root, 'app.css'), '.app { color: red; }\n')
      setGlobalCssPaths(['./app.css'])
      addCssSources([{ name: 'iam', css: '.iam { margin: 1px; }\n' }])

      // What a caller that reads the list BEFORE the sources are materialized passes: no source in it.
      const explicit = await buildSpaceClient({
        root,
        css: { tailwind: false },
        globalCss: getGlobalCssPaths() ?? [],
        outDir: '.dist/explicit',
      })
      const explicitManifest = await readManifest(explicit.outDir)
      assertEquals(explicitManifest.global.length, 2)
      assert((await readBuilt(explicit.outDir, explicitManifest.global[0])).includes('margin:1px'))
      assert((await readBuilt(explicit.outDir, explicitManifest.global[1])).includes('color:red'))

      // What `buildSpaceClient` builds when it reads the list itself: the same two sheets, same order.
      const own = await buildSpaceClient({ root, css: { tailwind: false }, outDir: '.dist/own' })
      const manifest = await readManifest(own.outDir)
      assertEquals(manifest.global.length, 2)
      assert((await readBuilt(own.outDir, manifest.global[0])).includes('margin:1px'))
      assert((await readBuilt(own.outDir, manifest.global[1])).includes('color:red'))
    })
  },
)
