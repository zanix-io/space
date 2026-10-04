import { assert, assertEquals, assertRejects } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { collectLayoutStyles, discoverPages } from 'modules/bundler/discover-pages.ts'

async function withTempDir(run: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
  try {
    await run(root)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

const write = (path: string, text: string) => Deno.writeTextFile(path, text)
const layoutModule = (styles: string) =>
  `export const styles = ${styles}\nexport default function Layout() { return null }\n`
const pageModule = 'export default class Page {}\n'

Deno.test(
  "discoverPages: a layout's styles resolve relative to THAT layout's own directory, in declaration " +
    'order, with media threaded through, under the SAME layoutFilePath scanPageFiles reports',
  async () => {
    await withTempDir(async (root) => {
      await Deno.mkdir(join(root, 'routes', 'area'), { recursive: true })
      await write(join(root, 'routes', 'area', 'area.css'), '.a { color: red; }\n')
      await write(join(root, 'routes', 'area', 'area-print.css'), '.ap { color: black; }\n')
      await write(
        join(root, 'routes', 'area', 'layout.tsx'),
        layoutModule(`['./area.css', { href: './area-print.css', media: 'print' }]`),
      )
      await write(join(root, 'routes', 'area', 'page.tsx'), pageModule)

      const routesDir = join(root, 'routes')
      const [page] = await discoverPages(routesDir)

      assertEquals(page.layoutStyles.length, 2)
      assertEquals(page.layoutStyles[0].layoutFilePath, join(routesDir, 'area', 'layout.tsx'))
      assertEquals(
        page.layoutStyles[0].resolvedCssPath,
        await Deno.realPath(join(routesDir, 'area', 'area.css')),
      )
      assertEquals(page.layoutStyles[0].media, undefined)
      assertEquals(
        page.layoutStyles[1].resolvedCssPath,
        await Deno.realPath(join(routesDir, 'area', 'area-print.css')),
      )
      assertEquals(page.layoutStyles[1].media, 'print')
    })
  },
)

Deno.test(
  'discoverPages: a page lists its layouts root layout first — the order a document links them — ' +
    'and a layout without styles contributes nothing',
  async () => {
    await withTempDir(async (root) => {
      await Deno.mkdir(join(root, 'routes', 'area', 'plain', 'leaf'), { recursive: true })
      await write(join(root, 'routes', 'root.css'), '.r {}\n')
      await write(join(root, 'routes', 'area', 'area.css'), '.a {}\n')
      await write(join(root, 'routes', 'layout.tsx'), layoutModule(`['./root.css']`))
      await write(join(root, 'routes', 'area', 'layout.tsx'), layoutModule(`['./area.css']`))
      // A layout between the two that declares no styles at all.
      await write(
        join(root, 'routes', 'area', 'plain', 'layout.tsx'),
        'export default function Layout() { return null }\n',
      )
      await write(join(root, 'routes', 'area', 'plain', 'leaf', 'page.tsx'), pageModule)

      const [page] = await discoverPages(join(root, 'routes'))
      assertEquals(
        page.layoutStyles.map((style) => style.resolvedCssPath.split('/').pop()),
        ['root.css', 'area.css'],
      )
    })
  },
)

Deno.test(
  'collectLayoutStyles: a layout shared by several pages contributes its entries once, while each ' +
    'page still lists the layouts of its own chain',
  async () => {
    await withTempDir(async (root) => {
      await Deno.mkdir(join(root, 'routes', 'area', 'one'), { recursive: true })
      await Deno.mkdir(join(root, 'routes', 'area', 'two'), { recursive: true })
      await write(join(root, 'routes', 'area', 'area.css'), '.a {}\n')
      await write(join(root, 'routes', 'area', 'layout.tsx'), layoutModule(`['./area.css']`))
      await write(join(root, 'routes', 'area', 'one', 'page.tsx'), pageModule)
      await write(join(root, 'routes', 'area', 'two', 'page.tsx'), pageModule)

      const pages = await discoverPages(join(root, 'routes'))
      assertEquals(pages.length, 2)
      assertEquals(pages.map((page) => page.layoutStyles.length), [1, 1])
      assertEquals(collectLayoutStyles(pages).length, 1)
    })
  },
)

Deno.test('discoverPages: a page outside every layout has no layout styles', async () => {
  await withTempDir(async (root) => {
    await Deno.mkdir(join(root, 'routes', 'bare'), { recursive: true })
    await write(join(root, 'routes', 'bare', 'page.tsx'), pageModule)

    const [page] = await discoverPages(join(root, 'routes'))
    assertEquals(page.layoutStyles, [])
    assertEquals(collectLayoutStyles([page]), [])
  })
})

Deno.test(
  'discoverPages: a layout styles entry that points at a missing file fails the discovery, the ' +
    "same way a page's does",
  async () => {
    await withTempDir(async (root) => {
      await Deno.mkdir(join(root, 'routes', 'area'), { recursive: true })
      await write(join(root, 'routes', 'area', 'layout.tsx'), layoutModule(`['./missing.css']`))
      await write(join(root, 'routes', 'area', 'page.tsx'), pageModule)

      await assertRejects(() => discoverPages(join(root, 'routes')), Deno.errors.NotFound)
    })
  },
)

Deno.test(
  'discoverPages: a layout styles export that is not a list of stylesheets is reported with the ' +
    'layout it came from',
  async () => {
    await withTempDir(async (root) => {
      await Deno.mkdir(join(root, 'routes', 'area'), { recursive: true })
      await write(join(root, 'routes', 'area', 'layout.tsx'), layoutModule(`'./area.css'`))
      await write(join(root, 'routes', 'area', 'page.tsx'), pageModule)

      const error = await assertRejects(() => discoverPages(join(root, 'routes')))
      assert(String((error as Error).message).includes('layout.tsx'))
      assertEquals((error as { code?: string }).code, 'SPACE_LAYOUT_STYLES_INVALID')
    })
  },
)
