// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals, assertFalse } from '@std/assert'
import { SpacePageController } from 'modules/router/mod.ts'
import { mockHandlerContext } from 'modules/testing/mod.ts'
import { POPULATION_LOCALS_KEY } from 'modules/middleware/population-guard.ts'
import { setThemeResolver } from 'modules/theme/mod.ts'
import { resetThemeResolver } from 'modules/theme/theme-registry.ts'
import { setCssManifest } from 'modules/render/css-manifest.ts'

function View() {
  return <p>ok</p>
}

/** Extracts a single named CSP directive's own value, as a plain string — `csp.split('; ')`
 * finds the exact `directiveName ...` segment and strips the name back off, so a test can assert
 * EXACT equality against it instead of a substring/prefix match against the whole CSP header (a
 * prefix match could still pass even if something were appended AFTER what it checked for, e.g.
 * `'self' 'nonce-X'` matching as a PREFIX of `'self' 'nonce-X' 'unsafe-inline'`). */
function directiveValue(csp: string, directiveName: string): string | undefined {
  return csp.split('; ').find((part) => part.startsWith(`${directiveName} `))
    ?.slice(directiveName.length + 1)
}

function ctxFor(population?: string) {
  return mockHandlerContext({
    locals: population ? { [POPULATION_LOCALS_KEY]: population } : {},
  })
}

Deno.test(
  'SpacePageController.handleGet: theme.resolve renders a <style> whose nonce EXACTLY equals ' +
    "the CSP header's own style-src nonce — a real HTML+header cross-check, not React's " +
    'internal structure',
  async () => {
    setThemeResolver(() => ({ '--space-color-primary': '#16a34a' }))
    try {
      class ThemedPage extends SpacePageController {
        public override component = View
      }

      const response = await new ThemedPage(ctxFor()).handleGet(ctxFor())
      const csp = response.headers.get('Content-Security-Policy')
      assert(csp, 'expected a Content-Security-Policy header')

      const html = await response.text()
      assert(html.includes(':root{--space-color-primary:#16a34a}'), html)

      // Invariant 1: the rendered HTML string itself contains a real nonced <style> tag.
      const styleNonce = html.match(/<style nonce="([^"]+)">/)?.[1]
      assert(styleNonce, 'expected a nonced <style> tag in the rendered HTML')

      // Invariant 2: that EXACT nonce is what style-src (and script-src) actually grant — full
      // directive-value equality, not a substring/prefix match.
      assertEquals(directiveValue(csp, 'style-src'), `'self' 'nonce-${styleNonce}'`)
      assertEquals(directiveValue(csp, 'script-src'), `'self' 'nonce-${styleNonce}'`)

      // Invariant 3: applies under the generated CSP WITHOUT 'unsafe-inline' — a nonce source is
      // sufficient on its own per the CSP spec (a nonce/hash source makes 'unsafe-inline' redundant
      // even if present, but this policy never adds it at all — verified directly, not inferred).
      assertFalse(csp.includes('unsafe-inline'), csp)
    } finally {
      resetThemeResolver()
    }
  },
)

Deno.test(
  'SpacePageController.handleGet: removing precedence introduces no cascade-order problem — ' +
    "the theme <style> renders AFTER the static stylesheet's own <link> in the ACTUAL HTML " +
    'output, so it correctly wins the cascade for equal-specificity :root declarations',
  async () => {
    setThemeResolver(() => ({ '--space-color-primary': '#16a34a' }))
    setCssManifest({ global: ['/assets/app-hash123.css'] })
    try {
      class ThemedWithStaticCssPage extends SpacePageController {
        public override component = View
      }

      const response = await new ThemedWithStaticCssPage(ctxFor()).handleGet(ctxFor())
      const html = await response.text()

      const linkIndex = html.indexOf('<link rel="stylesheet" href="/assets/app-hash123.css"')
      const styleIndex = html.indexOf('<style nonce=')
      assert(linkIndex !== -1, `expected the static stylesheet <link> in the HTML: ${html}`)
      assert(styleIndex !== -1, `expected the theme <style> in the HTML: ${html}`)
      assert(
        linkIndex < styleIndex,
        `expected the static <link> (index ${linkIndex}) to precede the theme <style> ` +
          `(index ${styleIndex}) in document order — cascade order depends on it: ${html}`,
      )
    } finally {
      resetThemeResolver()
      setCssManifest(undefined)
    }
  },
)

Deno.test(
  'SpacePageController.handleGet: theme.resolve returning undefined renders NO <style> tag at ' +
    'all — never an empty one',
  async () => {
    setThemeResolver(() => undefined)
    try {
      class UnthemedPage extends SpacePageController {
        public override component = View
      }

      const response = await new UnthemedPage(ctxFor()).handleGet(ctxFor())
      const html = await response.text()

      assertFalse(html.includes('<style'), html)
    } finally {
      resetThemeResolver()
    }
  },
)

Deno.test(
  'SpacePageController.handleGet: no theme.resolve configured at all — unaffected, same as ' +
    'before this feature existed',
  async () => {
    resetThemeResolver()
    class NoThemePage extends SpacePageController {
      public override component = View
    }

    const response = await new NoThemePage(ctxFor()).handleGet(ctxFor())
    const html = await response.text()

    assertFalse(html.includes('<style'), html)
  },
)

Deno.test(
  "SpacePageController.handleGet: theme.resolve receives this request's own population, and " +
    'two different populations render two different resolved themes',
  async () => {
    setThemeResolver(({ population }) => (
      population === 'tenant-b'
        ? { '--space-color-primary': '#16a34a' }
        : { '--space-color-primary': '#2563eb' }
    ))
    try {
      class MultiTenantPage extends SpacePageController {
        public override component = View
      }

      const tenantA = await new MultiTenantPage(ctxFor('tenant-a')).handleGet(ctxFor('tenant-a'))
      const tenantAHtml = await tenantA.text()
      assert(tenantAHtml.includes(':root{--space-color-primary:#2563eb}'), tenantAHtml)

      const tenantB = await new MultiTenantPage(ctxFor('tenant-b')).handleGet(ctxFor('tenant-b'))
      const tenantBHtml = await tenantB.text()
      assert(tenantBHtml.includes(':root{--space-color-primary:#16a34a}'), tenantBHtml)
    } finally {
      resetThemeResolver()
    }
  },
)

Deno.test(
  'SpacePageController.handleGet: an unsafe value returned by theme.resolve is sanitized end ' +
    'to end — never reaches the response raw',
  async () => {
    setThemeResolver(() => ({
      '--space-color-primary': '#16a34a', // survives
      '--space-evil': 'red;}body{display:none}<script>alert(1)</script>', // dropped entirely
    }))
    try {
      class SanitizedPage extends SpacePageController {
        public override component = View
      }

      const response = await new SanitizedPage(ctxFor()).handleGet(ctxFor())
      const html = await response.text()

      assert(html.includes(':root{--space-color-primary:#16a34a}'), html)
      assertFalse(html.includes('<script>alert(1)</script>'), html)
      assertFalse(html.includes('display:none'), html)
    } finally {
      resetThemeResolver()
    }
  },
)

Deno.test(
  'SpacePageController.handleGet: an Orbit fragment request omits themeStyle — already in ' +
    'effect on the page it is swapping into, same reasoning as cssHrefs/pwaHead',
  async () => {
    setThemeResolver(() => ({ '--space-color-primary': '#16a34a' }))
    try {
      class ThemedFragmentPage extends SpacePageController {
        public override component = View
      }

      const response = await new ThemedFragmentPage(ctxFor()).handleGet(
        mockHandlerContext({
          req: new Request('http://localhost/', {
            headers: { 'X-Znx-Space-Navigate': '1' },
          }),
        }),
      )
      const html = await response.text()

      assertFalse(html.includes('<style'), html)
    } finally {
      resetThemeResolver()
    }
  },
)

Deno.test(
  'SpacePageController.handleGet: cacheControl + theme.resolve — two populations sharing the ' +
    'SAME loader data get DIFFERENT ETags, closing the same-origin collision theme.resolve ' +
    'would otherwise cause',
  async () => {
    setThemeResolver(({ population }) => (
      population === 'tenant-b'
        ? { '--space-color-primary': '#16a34a' }
        : { '--space-color-primary': '#2563eb' }
    ))
    try {
      class CachedThemedPage extends SpacePageController {
        public static override cacheControl = 'public, max-age=60'
        public override component = View
        // Deliberately population-INDEPENDENT loader data — the exact scenario that used to
        // collide: the page's own content never varies by population, only its theme does.
        public override loader = () => ({ title: 'Welcome' })
      }

      const tenantA = await new CachedThemedPage(ctxFor('tenant-a')).handleGet(ctxFor('tenant-a'))
      const tenantB = await new CachedThemedPage(ctxFor('tenant-b')).handleGet(ctxFor('tenant-b'))

      assert(tenantA.headers.get('etag'))
      assert(tenantB.headers.get('etag'))
      assert(tenantA.headers.get('etag') !== tenantB.headers.get('etag'))
    } finally {
      resetThemeResolver()
    }
  },
)

Deno.test(
  'SpacePageController.handleGet: cacheControl WITHOUT theme.resolve configured keeps its ' +
    'EXACT previous ETag behavior — population plays no role at all',
  async () => {
    resetThemeResolver()
    class CachedUnthemedPage extends SpacePageController {
      public static override cacheControl = 'public, max-age=60'
      public override component = View
      public override loader = () => ({ title: 'Welcome' })
    }

    const tenantA = await new CachedUnthemedPage(ctxFor('tenant-a')).handleGet(ctxFor('tenant-a'))
    const tenantB = await new CachedUnthemedPage(ctxFor('tenant-b')).handleGet(ctxFor('tenant-b'))

    // Same loader data, no theme resolver configured at all — this package never claims to be
    // population-aware for caching on its own; `cacheControl` stays the author's explicit
    // responsibility, unchanged by this feature (see `computeEtag`'s own `extra` param doc).
    assertEquals(tenantA.headers.get('etag'), tenantB.headers.get('etag'))
  },
)
