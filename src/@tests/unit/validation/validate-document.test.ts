import { assertEquals } from '@std/assert'
import { validateDocuments } from 'modules/validation/validate-document.ts'
import type { StaticAppInput, StaticPageInput } from 'modules/validation/validate-document.ts'
import type { ResolvedHead } from 'modules/router/head-descriptor.ts'
import type { ValidationConfig } from 'modules/validation/engine.ts'

function head(overrides: Partial<ResolvedHead> = {}): ResolvedHead {
  return { title: 'Widget', meta: [], link: [], ...overrides }
}

function page(overrides: Partial<StaticPageInput> = {}): StaticPageInput {
  return {
    filePath: 'routes/products/page.tsx',
    routePath: 'products',
    head: head(),
    ...overrides,
  }
}

/** Codes reported, for the rules enabled by a given config. */
function codes(
  pages: StaticPageInput[],
  app: StaticAppInput = {},
  config: ValidationConfig = {},
): string[] {
  return validateDocuments(pages, app, config).map((diagnostic) => diagnostic.code)
}

// --- DOC001 / title ------------------------------------------------------------------------------

Deno.test('DOC001: a page resolving no title is reported', () => {
  const found = codes([page({ head: head({ title: undefined }) })])
  assertEquals(found.includes('DOC001'), true)
})

Deno.test('DOC001: a page with a resolved title is not', () => {
  assertEquals(codes([page()]).includes('DOC001'), false)
})

Deno.test(
  'DOC001: a page whose head is DYNAMIC is skipped entirely — the resolved head is not what the ' +
    'document will carry, so every head rule would be answering the wrong question. Silence about ' +
    'something unknowable is correct; a confident wrong answer is not',
  () => {
    const found = codes([page({ head: head({ title: undefined }), headIsDynamic: true })])
    assertEquals(found.includes('DOC001'), false)
    assertEquals(found.includes('SEO001'), false)
  },
)

// --- exemptions ----------------------------------------------------------------------------------

// There is deliberately no per-page way to opt out of document rules. A `static kind = 'endpoint'`
// existed briefly and was removed: it described a route that is not a document, which `handleGet`
// cannot produce — every GET yields a document, a redirect or a 304. The two real exemptions below
// need nothing declared on the page.

Deno.test(
  'exemption: a page with an unconditional redirect is exempt automatically — it never renders a ' +
    'document, so there is nothing for a document rule to be about',
  () => {
    const found = codes([
      page({ head: head({ title: undefined }), hasUnconditionalRedirect: true }),
    ])
    assertEquals(found, [])
  },
)

Deno.test('exemption: a route pattern with ** matches across segments', () => {
  const found = codes(
    [page({ routePath: 'preview/deep/thing', head: head({ title: undefined }) })],
    {},
    { exempt: ['preview/**'] },
  )
  assertEquals(found, [])
})

Deno.test('exemption: a route pattern with * does NOT match across segments', () => {
  const found = codes(
    [page({ routePath: 'preview/deep/thing', head: head({ title: undefined }) })],
    {},
    { exempt: ['preview/*'] },
  )
  assertEquals(found.includes('DOC001'), true)
})

// --- canonical -----------------------------------------------------------------------------------

Deno.test(
  'FW001: two canonicals with differing hrefs is an error — checked even though resolveHead makes ' +
    'it unreachable today, because a future change to the dedup rule would otherwise reintroduce ' +
    'it unnoticed',
  () => {
    const diagnostics = validateDocuments([
      page({
        head: head({
          link: [
            { rel: 'canonical', href: 'https://example.com/a' },
            { rel: 'canonical', href: 'https://example.com/b' },
          ],
        }),
      }),
    ])
    const fw001 = diagnostics.find((diagnostic) => diagnostic.code === 'FW001')
    assertEquals(fw001?.severity, 'error')
  },
)

Deno.test('SEO005: a relative canonical is reported', () => {
  const found = codes([page({ head: head({ link: [{ rel: 'canonical', href: '/products' }] }) })])
  assertEquals(found.includes('SEO005'), true)
})

Deno.test(
  'SEO002: a missing canonical is OFF by default — project policy, not a requirement',
  () => {
    assertEquals(codes([page()]).includes('SEO002'), false)
  },
)

Deno.test('SEO002: a project can opt in, and then it reports', () => {
  const found = codes([page()], {}, { rules: { SEO002: 'warning' } })
  assertEquals(found.includes('SEO002'), true)
})

Deno.test(
  'FW002: a canonical declared on a LAYOUT is reported against the layout file — it is a per-URL ' +
    'fact in a component shared across routes',
  () => {
    const diagnostics = validateDocuments([
      page({
        layoutHeads: [{
          filePath: 'routes/products/layout.tsx',
          head: { link: [{ rel: 'canonical', href: 'https://example.com/products' }] },
        }],
      }),
    ])
    const fw002 = diagnostics.find((diagnostic) => diagnostic.code === 'FW002')
    assertEquals(fw002?.file, 'routes/products/layout.tsx')
  },
)

Deno.test(
  'FW002 is reported even when the head is dynamic — the DECLARATION SITE is static knowledge ' +
    'whether or not the value is',
  () => {
    const found = codes([
      page({
        headIsDynamic: true,
        layoutHeads: [{
          filePath: 'routes/layout.tsx',
          head: { link: [{ rel: 'canonical', href: 'https://example.com/' }] },
        }],
      }),
    ])
    assertEquals(found.includes('FW002'), true)
  },
)

// --- robots --------------------------------------------------------------------------------------

Deno.test('SEO003: a recognized robots token is accepted, including parameterized ones', () => {
  const found = codes([
    page({ head: head({ meta: [{ name: 'robots', content: 'index, follow, max-snippet:-1' }] }) }),
  ])
  assertEquals(found.includes('SEO003'), false)
})

Deno.test('SEO003: an unrecognized token is reported as a warning, never an error', () => {
  const diagnostics = validateDocuments([
    page({ head: head({ meta: [{ name: 'robots', content: 'index, nosnipet' }] }) }),
  ])
  const seo003 = diagnostics.find((diagnostic) => diagnostic.code === 'SEO003')
  assertEquals(seo003?.severity, 'warning')
})

Deno.test(
  'no rule fires for an ABSENT robots meta — its absence means index,follow, which is the correct ' +
    'default and not something to warn about',
  () => {
    assertEquals(codes([page()]).includes('SEO003'), false)
  },
)

Deno.test('SEO004: noindex plus a sitemap entry for the same route is a contradiction', () => {
  const found = codes(
    [page({ routePath: 'secret', head: head({ meta: [{ name: 'robots', content: 'noindex' }] }) })],
    { sitemapLocations: ['/secret'], knownRoutes: ['secret'] },
  )
  assertEquals(found.includes('SEO004'), true)
})

// --- open graph (opt-in) --------------------------------------------------------------------------

Deno.test('SOC002: Open Graph rules are off unless the project opts in', () => {
  const partialOg = page({
    head: head({ meta: [{ property: 'og:title', content: 'Widget' }] }),
  })
  assertEquals(codes([partialOg]).includes('SOC002'), false)
  assertEquals(
    codes([partialOg], {}, { rules: { SOC002: 'warning' } }).includes('SOC002'),
    true,
  )
})

Deno.test('SOC001: a relative og:image is reported once opted in', () => {
  const found = codes(
    [page({ head: head({ meta: [{ property: 'og:image', content: '/img/hero.png' }] }) })],
    {},
    { rules: { SOC001: 'warning' } },
  )
  assertEquals(found.includes('SOC001'), true)
})

// --- PWA ------------------------------------------------------------------------------------------

Deno.test('PWA001: iconSizes without 192 and 512 is an error — the app cannot be installed', () => {
  const diagnostics = validateDocuments([], {
    pwa: { name: 'App', icon: '/icon.png', iconSizes: [256] },
  })
  const pwa001 = diagnostics.find((diagnostic) => diagnostic.code === 'PWA001')
  assertEquals(pwa001?.severity, 'error')
})

Deno.test('PWA001: the default icon sizes satisfy installability', () => {
  const found = codes([], { pwa: { name: 'App', icon: '/icon.png' } })
  assertEquals(found.includes('PWA001'), false)
})

Deno.test('PWA002: an offlineFallback matching no route is reported as a warning', () => {
  const found = codes([], {
    pwa: { name: 'App', icon: '/icon.png', offlineFallback: '/offline' },
    knownRoutes: ['products'],
  })
  assertEquals(found.includes('PWA002'), true)
})

Deno.test('PWA rules do not fire at all for an app with no pwa configured', () => {
  const found = codes([], { knownRoutes: ['products'] })
  assertEquals(found.some((code) => code.startsWith('PWA')), false)
})

// --- sitemap --------------------------------------------------------------------------------------

Deno.test(
  'SEO006: a sitemap entry is matched against DYNAMIC routes by pattern — /products/42 ' +
    'legitimately corresponds to products/:id, and reporting it as unmatched would be wrong',
  () => {
    const found = codes([], {
      sitemapLocations: ['/products/42'],
      knownRoutes: ['products/:id'],
    })
    assertEquals(found.includes('SEO006'), false)
  },
)

Deno.test('SEO006: an entry matching no route at all is reported', () => {
  const found = codes([], { sitemapLocations: ['/ghost'], knownRoutes: ['products/:id'] })
  assertEquals(found.includes('SEO006'), true)
})

// --- root layout heuristics -------------------------------------------------------------------------

Deno.test(
  'FW006: a root layout whose source renders no html/body is reported as a heuristic',
  () => {
    const diagnostics = validateDocuments([], {
      rootLayout: {
        filePath: 'routes/layout.tsx',
        source: 'export default (p) => <div>{p.children}</div>',
      },
    })
    const fw006 = diagnostics.find((diagnostic) => diagnostic.code === 'FW006')
    assertEquals(fw006?.severity, 'warning')
  },
)

Deno.test('FW006: a root layout that does render html is not reported', () => {
  const found = codes([], {
    rootLayout: {
      filePath: 'routes/layout.tsx',
      source: "export default (p) => <html lang='en'><body>{p.children}</body></html>",
    },
  })
  assertEquals(found.includes('FW006'), false)
})

Deno.test('FW005: a hardcoded lang alongside [lang] routes is a contradiction', () => {
  const found = codes([], {
    rootLayout: {
      filePath: 'routes/layout.tsx',
      source: "export default (p) => <html lang='en'><body>{p.children}</body></html>",
    },
    hasLangRoutes: true,
  })
  assertEquals(found.includes('FW005'), true)
})

Deno.test('FW005 does not fire for a single-language app', () => {
  const found = codes([], {
    rootLayout: {
      filePath: 'routes/layout.tsx',
      source: "export default (p) => <html lang='en'><body>{p.children}</body></html>",
    },
    hasLangRoutes: false,
  })
  assertEquals(found.includes('FW005'), false)
})

// --- ordering -----------------------------------------------------------------------------------

Deno.test('diagnostics are ordered most severe first, then stably by code', () => {
  const diagnostics = validateDocuments(
    [page({
      head: head({
        title: undefined,
        link: [
          { rel: 'canonical', href: 'https://example.com/a' },
          { rel: 'canonical', href: 'https://example.com/b' },
        ],
      }),
    })],
    { pwa: { name: 'App', icon: '/icon.png', iconSizes: [256] } },
  )
  const severities = diagnostics.map((diagnostic) => diagnostic.severity)
  const firstWarning = severities.indexOf('warning')
  const lastError = severities.lastIndexOf('error')
  assertEquals(lastError < firstWarning || firstWarning === -1, true)
})
