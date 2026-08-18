import { assertEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { collectPageStyles, discoverPages } from 'modules/bundler/discover-pages.ts'

// `discoverPageStyles` was folded into `discoverPages` — one pass now serves both CSS entry
// construction and document validation, instead of scanning and importing the same modules twice.
// These cases are preserved verbatim in behaviour, exercised through the styles slice of the new
// result, so the merge is demonstrably not a rewrite of what they covered.
const discoverPageStyles = async (routesDir: string | string[]) =>
  collectPageStyles(await discoverPages(routesDir))

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

// ================================================================================================
// What the single pass adds beyond styles.
//
// The discipline under test: discovery reports the STATIC slice and says so when something is not
// statically knowable. It never fabricates a `DocumentModel` (a per-request value needing a nonce,
// a theme and loader data) and never approximates `DocumentSemantics` (extracted from real rendered
// HTML). A guess dressed as a measurement is worse than an admitted gap.
// ================================================================================================

/** Builds a routes tree from `files`, then discovers it with a stubbed importer so these tests
 * never depend on real module evaluation or on this project's JSX factory. */
async function discoverWith(
  modules: Record<string, unknown>,
  files: string[],
): Promise<Awaited<ReturnType<typeof discoverPages>>> {
  let result: Awaited<ReturnType<typeof discoverPages>> = []
  await withTempDir(async (root) => {
    await Promise.all(
      files.map(async (file) => {
        const full = join(root, 'routes', file)
        await Deno.mkdir(join(full, '..'), { recursive: true })
        await Deno.writeTextFile(full, 'export default {}\n')
      }),
    )
    result = await discoverPages(join(root, 'routes'), (filePath) => {
      const key = Object.keys(modules).find((name) => filePath.endsWith(name))
      return Promise.resolve(key ? modules[key] : {})
    })
  })
  return result
}

Deno.test(
  'discoverPages: a plain object head is resolved through the real resolveHead',
  async () => {
    const [page] = await discoverWith(
      { 'page.tsx': { default: { head: { title: 'Widget' } } } },
      ['products/page.tsx'],
    )
    assertEquals(page.head.title, 'Widget')
    assertEquals(page.headIsDynamic, false)
  },
)

Deno.test(
  'discoverPages: a page whose head is a FUNCTION is flagged dynamic and never invoked — calling ' +
    'it with a fabricated argument would produce a head the page never actually has',
  async () => {
    let invoked = false
    const [page] = await discoverWith(
      {
        'page.tsx': {
          default: {
            head: () => {
              invoked = true
              return { title: 'never' }
            },
          },
        },
      },
      ['products/page.tsx'],
    )
    assertEquals(page.headIsDynamic, true)
    assertEquals(invoked, false)
    assertEquals(page.head.title, undefined)
  },
)

Deno.test(
  'discoverPages: a LAYOUT head function makes the page dynamic too — the missing part of the ' +
    'resolved head does not care which file it was missing from',
  async () => {
    const [page] = await discoverWith(
      {
        'page.tsx': { default: { head: { title: 'Widget' } } },
        'layout.tsx': { head: () => ({ meta: [{ name: 'author', content: 'x' }] }) },
      },
      ['products/page.tsx', 'products/layout.tsx'],
    )
    assertEquals(page.headIsDynamic, true)
    // What IS statically known still comes through.
    assertEquals(page.head.title, 'Widget')
  },
)

Deno.test('discoverPages: layout heads merge nearest-first, page winning', async () => {
  const [page] = await discoverWith(
    {
      'page.tsx': { default: { head: { title: 'Page' } } },
      'layout.tsx': { head: { title: 'Layout', meta: [{ name: 'author', content: 'Acme' }] } },
    },
    ['products/page.tsx', 'products/layout.tsx'],
  )
  assertEquals(page.head.title, 'Page')
  assertEquals(page.head.meta, [{ name: 'author', content: 'Acme' }])
  assertEquals(page.layoutHeads.length, 1)
})

Deno.test(
  'discoverPages: a page declaring a `kind` is IGNORED — there is deliberately no such field on ' +
    'the page contract. It was implemented and removed: it described a route that is not a ' +
    'document, which handleGet cannot produce. See typings/page.ts for the full reasoning',
  async () => {
    const [page] = await discoverWith(
      { 'page.tsx': { default: { kind: 'endpoint' } } },
      ['hooks/page.tsx'],
    )
    assertEquals(Object.hasOwn(page, 'kind'), false)
  },
)

Deno.test(
  'discoverPages: an unconditional redirect is detected; a CONDITIONAL one is not, because that ' +
    'page still renders a document whenever the condition is false',
  async () => {
    const [unconditional] = await discoverWith(
      { 'page.tsx': { default: { redirect: { to: '/new' } } } },
      ['old/page.tsx'],
    )
    assertEquals(unconditional.hasUnconditionalRedirect, true)

    const [conditional] = await discoverWith(
      { 'page.tsx': { default: { redirect: { to: '/new', condition: () => true } } } },
      ['maybe/page.tsx'],
    )
    assertEquals(conditional.hasUnconditionalRedirect, false)
  },
)

Deno.test(
  'discoverPages: the result carries no DocumentModel and no DocumentSemantics — discovery reports ' +
    'the static slice and leaves per-request and post-render values to the layers that own them',
  async () => {
    const [page] = await discoverWith(
      { 'page.tsx': { default: { head: { title: 'Widget' } } } },
      ['products/page.tsx'],
    )
    const keys = Object.keys(page).sort()
    assertEquals(keys, [
      'filePath',
      'hasUnconditionalRedirect',
      'head',
      'headIsDynamic',
      'layoutHeads',
      'routePath',
      'styles',
    ])
  },
)
