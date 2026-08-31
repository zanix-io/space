import { assertEquals } from '@std/assert'
import { deriveAutoSitemapEntries } from 'modules/bundler/auto-sitemap.ts'
import type { DiscoveredPage } from 'modules/bundler/discover-pages.ts'
import type { ResolvedHead } from 'modules/router/head-descriptor.ts'
import { setLangRegistration } from 'modules/middleware/lang-registry.ts'

function head(overrides: Partial<ResolvedHead> = {}): ResolvedHead {
  return { title: 'Widget', meta: [], link: [], ...overrides }
}

function page(overrides: Partial<DiscoveredPage> = {}): DiscoveredPage {
  return {
    filePath: 'routes/products/page.tsx',
    routePath: 'products',
    styles: [],
    head: head(),
    headIsDynamic: false,
    hasUnconditionalRedirect: false,
    layoutHeads: [],
    ...overrides,
  }
}

Deno.test('deriveAutoSitemapEntries: a plain static route becomes a single loc entry', () => {
  const entries = deriveAutoSitemapEntries([page({ routePath: 'about' })])
  assertEquals(entries, [{ loc: '/about' }])
})

Deno.test('deriveAutoSitemapEntries: a route with a dynamic segment is excluded', () => {
  const entries = deriveAutoSitemapEntries([page({ routePath: 'products/:id' })])
  assertEquals(entries, [])
})

Deno.test(
  'deriveAutoSitemapEntries: a route with an unconditional redirect is excluded — it never renders its own document',
  () => {
    const entries = deriveAutoSitemapEntries([page({ hasUnconditionalRedirect: true })])
    assertEquals(entries, [])
  },
)

Deno.test(
  "deriveAutoSitemapEntries: a route whose resolved head declares noindex is excluded — an auto-derived sitemap can never contradict SEO004's own check",
  () => {
    const entries = deriveAutoSitemapEntries([
      page({ head: head({ meta: [{ name: 'robots', content: 'noindex' }] }) }),
    ])
    assertEquals(entries, [])
  },
)

Deno.test(
  'deriveAutoSitemapEntries: a page with a dynamic head still qualifies — noindex is a static declaration, never something a loader computes',
  () => {
    const entries = deriveAutoSitemapEntries([page({ headIsDynamic: true })])
    assertEquals(entries, [{ loc: '/products' }])
  },
)

Deno.test(
  'deriveAutoSitemapEntries: mixed pages — only the qualifying ones make it into the result, in the same order',
  () => {
    const entries = deriveAutoSitemapEntries([
      page({ routePath: 'about' }),
      page({ routePath: 'products/:id' }),
      page({ routePath: 'secret', head: head({ meta: [{ name: 'robots', content: 'noindex' }] }) }),
      page({ routePath: 'contact', hasUnconditionalRedirect: true }),
      page({ routePath: 'pricing' }),
    ])
    assertEquals(entries, [{ loc: '/about' }, { loc: '/pricing' }])
  },
)

Deno.test('deriveAutoSitemapEntries: no pages produces no entries', () => {
  assertEquals(deriveAutoSitemapEntries([]), [])
})

// ================================================================================================
// langPreHandler registration — a `:lang`-only dynamic route has a small, statically known
// enumeration (`availableLangs`), unlike a database-backed one (`:id`), so it expands instead of
// being excluded. See `deriveAutoSitemapEntries`'s own doc for the exact rule.
// ================================================================================================

Deno.test(
  "deriveAutoSitemapEntries: with langPreHandler registered, a ':lang'-only dynamic route " +
    'expands into one entry per availableLangs, each cross-referencing the others via alternates',
  () => {
    setLangRegistration({
      availableLangs: ['en', 'es'],
      paramName: 'lang',
      defaultLang: 'en',
      cookieName: 'X-Znx-Lang',
    })
    try {
      const entries = deriveAutoSitemapEntries([page({ routePath: ':lang' })])
      assertEquals(entries, [
        {
          loc: '/en',
          alternates: [{ lang: 'en', href: '/en' }, { lang: 'es', href: '/es' }],
        },
        {
          loc: '/es',
          alternates: [{ lang: 'en', href: '/en' }, { lang: 'es', href: '/es' }],
        },
      ])
    } finally {
      setLangRegistration(undefined)
    }
  },
)

Deno.test(
  "deriveAutoSitemapEntries: a ':lang' segment followed by a static suffix expands correctly, " +
    'substituting only the lang segment',
  () => {
    setLangRegistration({
      availableLangs: ['en', 'es'],
      paramName: 'lang',
      defaultLang: 'en',
      cookieName: 'X-Znx-Lang',
    })
    try {
      const entries = deriveAutoSitemapEntries([page({ routePath: ':lang/about' })])
      assertEquals(entries.map((entry) => entry.loc), ['/en/about', '/es/about'])
    } finally {
      setLangRegistration(undefined)
    }
  },
)

Deno.test(
  'deriveAutoSitemapEntries: a route mixing the lang param with ANOTHER dynamic segment still ' +
    "excludes entirely — ':region' has no fixed set to enumerate either, even with langPreHandler " +
    'registered',
  () => {
    setLangRegistration({
      availableLangs: ['en', 'es'],
      paramName: 'lang',
      defaultLang: 'en',
      cookieName: 'X-Znx-Lang',
    })
    try {
      const entries = deriveAutoSitemapEntries([
        page({ routePath: ':lang/regions/:region' }),
      ])
      assertEquals(entries, [])
    } finally {
      setLangRegistration(undefined)
    }
  },
)

Deno.test(
  'deriveAutoSitemapEntries: without langPreHandler registered, a ":lang"-shaped dynamic ' +
    'route still excludes — unchanged behavior from before this expansion existed',
  () => {
    setLangRegistration(undefined)
    const entries = deriveAutoSitemapEntries([page({ routePath: ':lang' })])
    assertEquals(entries, [])
  },
)

Deno.test(
  'deriveAutoSitemapEntries: a custom paramName is respected — a dynamic segment matching a ' +
    'DIFFERENT name than the registered one is NOT treated as the lang param',
  () => {
    setLangRegistration({
      availableLangs: ['en', 'es'],
      paramName: 'locale',
      defaultLang: 'en',
      cookieName: 'X-Znx-Lang',
    })
    try {
      // `:lang` here is coincidentally shaped like the default convention, but the registration
      // names `locale` instead — this must still exclude, not expand.
      assertEquals(deriveAutoSitemapEntries([page({ routePath: ':lang' })]), [])
      // `:locale` — the actually-registered name — does expand.
      assertEquals(
        deriveAutoSitemapEntries([page({ routePath: ':locale' })]).map((entry) => entry.loc),
        ['/en', '/es'],
      )
    } finally {
      setLangRegistration(undefined)
    }
  },
)

Deno.test(
  'deriveAutoSitemapEntries: an expanded lang route still respects redirect/noindex — checked ' +
    'once per page, applying to every expanded language variant alike',
  () => {
    setLangRegistration({
      availableLangs: ['en', 'es'],
      paramName: 'lang',
      defaultLang: 'en',
      cookieName: 'X-Znx-Lang',
    })
    try {
      const entries = deriveAutoSitemapEntries([
        page({
          routePath: ':lang',
          head: head({ meta: [{ name: 'robots', content: 'noindex' }] }),
        }),
      ])
      assertEquals(entries, [])
    } finally {
      setLangRegistration(undefined)
    }
  },
)
