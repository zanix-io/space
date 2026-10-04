import '../../../../mod-react.ts'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { loadRoutes, Page, SpacePageController } from 'modules/router/mod.ts'
import { getPageTree } from 'modules/router/page-tree-registry.ts'
import { getRootLayoutStyles } from 'modules/router/app-shell-registry.ts'

async function withRoutesDir(
  run: (routesDir: string) => Promise<void>,
): Promise<void> {
  const routesDir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
  try {
    await Deno.mkdir(join(routesDir, 'area'), { recursive: true })
    for (const file of ['layout.tsx', join('area', 'layout.tsx'), join('area', 'page.tsx')]) {
      // Only existence matters: `importModule` below decides what each file "imports" as.
      // deno-lint-ignore no-await-in-loop
      await Deno.writeTextFile(join(routesDir, file), 'export default null\n')
    }
    await run(routesDir)
  } finally {
    await Deno.remove(routesDir, { recursive: true })
  }
}

type Modules = { root: Record<string, unknown>; area: Record<string, unknown> }

function importerFor(routesDir: string, modules: Modules, Target: unknown) {
  return (filePath: string) =>
    Promise.resolve(
      filePath === join(routesDir, 'layout.tsx')
        ? modules.root
        : filePath === join(routesDir, 'area', 'layout.tsx')
        ? modules.area
        : { default: Target },
    )
}

Deno.test(
  "loadRoutes: a layout's styles export lands on its segment, with the layout's own file path, " +
    'and the root layout registers its styles for documents outside a page',
  async () => {
    await withRoutesDir(async (routesDir) => {
      @Page()
      class LayoutStylesPage extends SpacePageController {
        public override component = null
      }

      await loadRoutes(routesDir, {
        importModule: importerFor(routesDir, {
          root: { default: () => null, styles: ['./root.css'] },
          area: { default: () => null, styles: [{ href: './area.css', media: 'print' }] },
        }, LayoutStylesPage),
      })

      const segments = getPageTree(LayoutStylesPage)?.segments ?? []
      assertEquals(segments.map((segment) => segment.layoutFilePath), [
        join(routesDir, 'layout.tsx'),
        join(routesDir, 'area', 'layout.tsx'),
      ])
      assertEquals(segments[0].styles, ['./root.css'])
      assertEquals(segments[1].styles, [{ href: './area.css', media: 'print' }])
      assertEquals(getRootLayoutStyles(), {
        layoutFilePath: join(routesDir, 'layout.tsx'),
        styles: ['./root.css'],
      })
    })
  },
)

Deno.test(
  'loadRoutes: a layout that exports styles that are not a list of stylesheets fails the load, ' +
    'naming the layout',
  async () => {
    await withRoutesDir(async (routesDir) => {
      @Page()
      class InvalidStylesPage extends SpacePageController {
        public override component = null
      }

      const error = await assertRejects(() =>
        loadRoutes(routesDir, {
          importModule: importerFor(routesDir, {
            root: { default: () => null },
            area: { default: () => null, styles: './area.css' },
          }, InvalidStylesPage),
        })
      )
      assert(String((error as Error).message).includes(join('area', 'layout.tsx')))
      assertEquals((error as { code?: string }).code, 'SPACE_LAYOUT_STYLES_INVALID')
    })
  },
)
