import { assertEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { discoverPageStyles } from 'modules/bundler/discover-page-styles.ts'

async function withTempDir(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
  try {
    await run(root)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

Deno.test(
  "discoverPageStyles: resolves a page's own styles relative to THAT page's own directory, in " +
    'declaration order, with media threaded through',
  async () => {
    await withTempDir(async (root) => {
      await Deno.mkdir(join(root, 'routes', 'products', '[id]'), { recursive: true })
      const pagePath = join(root, 'routes', 'products', '[id]', 'page.tsx')
      await Deno.writeTextFile(
        join(root, 'routes', 'products', '[id]', 'product.css'),
        '.p { color: red; }\n',
      )
      await Deno.writeTextFile(
        join(root, 'routes', 'products', '[id]', 'product-mobile.css'),
        '.pm { color: blue; }\n',
      )
      await Deno.writeTextFile(
        pagePath,
        `export default class ProductPage {\n` +
          `  static styles = ['./product.css', { href: './product-mobile.css', media: '(max-width: 599px)' }]\n` +
          `}\n`,
      )

      const discovered = await discoverPageStyles(join(root, 'routes'))
      assertEquals(discovered.length, 2)
      assertEquals(discovered[0].pageFilePath, discovered[1].pageFilePath)
      assertEquals(
        discovered[0].resolvedCssPath,
        await Deno.realPath(join(root, 'routes', 'products', '[id]', 'product.css')),
      )
      assertEquals(discovered[0].media, undefined)
      assertEquals(
        discovered[1].resolvedCssPath,
        await Deno.realPath(join(root, 'routes', 'products', '[id]', 'product-mobile.css')),
      )
      assertEquals(discovered[1].media, '(max-width: 599px)')
    })
  },
)

Deno.test(
  'discoverPageStyles: pageFilePath is exactly what scanPageFiles itself reports, for the SAME ' +
    'routesDir value — the identity page-tree-registry.ts stores at request time',
  async () => {
    await withTempDir(async (root) => {
      await Deno.mkdir(join(root, 'routes', 'about'), { recursive: true })
      await Deno.writeTextFile(join(root, 'routes', 'about', 'x.css'), '.x{}\n')
      await Deno.writeTextFile(
        join(root, 'routes', 'about', 'page.tsx'),
        `export default class AboutPage { static styles = ['./x.css'] }\n`,
      )

      const routesDir = join(root, 'routes')
      const discovered = await discoverPageStyles(routesDir)
      assertEquals(discovered.length, 1)
      assertEquals(discovered[0].pageFilePath, join(routesDir, 'about', 'page.tsx'))
    })
  },
)

Deno.test('discoverPageStyles: a page with no styles field contributes nothing', async () => {
  await withTempDir(async (root) => {
    await Deno.mkdir(join(root, 'routes', 'home'), { recursive: true })
    await Deno.writeTextFile(
      join(root, 'routes', 'home', 'page.tsx'),
      `export default class HomePage {}\n`,
    )

    assertEquals(await discoverPageStyles(join(root, 'routes')), [])
  })
})

Deno.test('discoverPageStyles: a page with an EMPTY styles array contributes nothing', async () => {
  await withTempDir(async (root) => {
    await Deno.mkdir(join(root, 'routes', 'home'), { recursive: true })
    await Deno.writeTextFile(
      join(root, 'routes', 'home', 'page.tsx'),
      `export default class HomePage { static styles = [] }\n`,
    )

    assertEquals(await discoverPageStyles(join(root, 'routes')), [])
  })
})

Deno.test(
  'discoverPageStyles: two different pages resolve independently — different pageFilePath, ' +
    'different resolved CSS, no cross-contamination',
  async () => {
    await withTempDir(async (root) => {
      await Deno.mkdir(join(root, 'routes', 'a'), { recursive: true })
      await Deno.mkdir(join(root, 'routes', 'b'), { recursive: true })
      await Deno.writeTextFile(join(root, 'routes', 'a', 'a.css'), '.a{}\n')
      await Deno.writeTextFile(join(root, 'routes', 'b', 'b.css'), '.b{}\n')
      await Deno.writeTextFile(
        join(root, 'routes', 'a', 'page.tsx'),
        `export default class PageA { static styles = ['./a.css'] }\n`,
      )
      await Deno.writeTextFile(
        join(root, 'routes', 'b', 'page.tsx'),
        `export default class PageB { static styles = ['./b.css'] }\n`,
      )

      const discovered = await discoverPageStyles(join(root, 'routes'))
      assertEquals(discovered.length, 2)
      const byPage = Object.fromEntries(
        discovered.map((entry) => [entry.pageFilePath, entry.resolvedCssPath]),
      )
      assertEquals(
        byPage[join(root, 'routes', 'a', 'page.tsx')],
        await Deno.realPath(join(root, 'routes', 'a', 'a.css')),
      )
      assertEquals(
        byPage[join(root, 'routes', 'b', 'page.tsx')],
        await Deno.realPath(join(root, 'routes', 'b', 'b.css')),
      )
    })
  },
)

Deno.test('discoverPageStyles: no pages at all resolves to an empty list, no error', async () => {
  await withTempDir(async (root) => {
    assertEquals(await discoverPageStyles(join(root, 'routes')), [])
  })
})
