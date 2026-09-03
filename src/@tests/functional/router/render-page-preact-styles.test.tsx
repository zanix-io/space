import { assert, assertEquals, assertFalse } from '@std/assert'
import { createElement } from 'preact'
import { SpacePageController } from 'modules/router/mod.ts'
import { setPageTree } from 'modules/router/page-tree-registry.ts'
import { mockPageContext } from 'modules/testing/mod.ts'
import { setDevClientEnabled } from 'modules/dev/dev-client-registry.ts'
import { setCssManifest } from 'modules/render/css-manifest.ts'
import { renderPageResponse } from 'modules/router/render-page-preact.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { CSP_SIGNATURE_NONE } from 'modules/router/csp-signature.ts'

console.error = () => {}

// Preact counterpart to `render-page-react-styles.test.tsx` — same scenarios, same
// setPageTree/setCssManifest low-level approach `render-page-preact.test.tsx` already
// establishes for this renderer.
class PageA extends SpacePageController {
  public override component = null
  public static override styles = ['./a.css']
}

class PageB extends SpacePageController {
  public override component = null
  public static override styles = ['./b.css']
}

class PageNoStyles extends SpacePageController {
  public override component = null
}

class PageWithOrder extends SpacePageController {
  public override component = null
  public static override styles = [
    './mobile.css',
    { href: './base.css', media: undefined },
    { href: './extra.css', media: '(max-width: 599px)' },
  ]
}

function Ok() {
  return createElement('p', null, 'ok')
}

function reset() {
  setCssManifest(undefined)
  setActiveRenderer('react')
}

Deno.test(
  'render-page-preact styles: page A gets global + its own CSS, page B gets global + ITS OWN — ' +
    "never the other's (real scope isolation, P2-12b, Preact parity)",
  async () => {
    setPageTree(PageA, { filePath: '/fake/routes/a/page.tsx', segments: [] })
    setPageTree(PageB, { filePath: '/fake/routes/b/page.tsx', segments: [] })
    setCssManifest({
      global: ['/assets/app-hash.css'],
      pages: {
        '/fake/routes/a/page.tsx': ['/assets/a-hash.css'],
        '/fake/routes/b/page.tsx': ['/assets/b-hash.css'],
      },
    })
    try {
      const responseA = await renderPageResponse(
        PageA,
        Ok,
        mockPageContext(),
        undefined,
        false,
        undefined,
        undefined,
        CSP_SIGNATURE_NONE,
      )
      const htmlA = await responseA.text()
      assert(htmlA.includes('href="/assets/app-hash.css"'), htmlA)
      assert(htmlA.includes('href="/assets/a-hash.css"'), htmlA)
      assertFalse(htmlA.includes('b-hash.css'), htmlA)

      const responseB = await renderPageResponse(
        PageB,
        Ok,
        mockPageContext(),
        undefined,
        false,
        undefined,
        undefined,
        CSP_SIGNATURE_NONE,
      )
      const htmlB = await responseB.text()
      assert(htmlB.includes('href="/assets/app-hash.css"'), htmlB)
      assert(htmlB.includes('href="/assets/b-hash.css"'), htmlB)
      assertFalse(htmlB.includes('a-hash.css'), htmlB)
    } finally {
      reset()
    }
  },
)

Deno.test(
  "render-page-preact styles: a page's own declaration order is preserved in the real HTML — " +
    "global first, then this page's own entries in the SAME order it declared them, media " +
    'threaded through correctly',
  async () => {
    setPageTree(PageWithOrder, { filePath: '/fake/routes/order/page.tsx', segments: [] })
    setCssManifest({
      global: ['/assets/app-hash.css'],
      pages: {
        '/fake/routes/order/page.tsx': [
          '/assets/mobile-hash.css',
          '/assets/base-hash.css',
          { href: '/assets/extra-hash.css', media: '(max-width: 599px)' },
        ],
      },
    })
    try {
      const response = await renderPageResponse(
        PageWithOrder,
        Ok,
        mockPageContext(),
        undefined,
        false,
        undefined,
        undefined,
        CSP_SIGNATURE_NONE,
      )
      const html = await response.text()

      const appIndex = html.indexOf('/assets/app-hash.css')
      const mobileIndex = html.indexOf('/assets/mobile-hash.css')
      const baseIndex = html.indexOf('/assets/base-hash.css')
      const extraIndex = html.indexOf('/assets/extra-hash.css')
      assert(
        appIndex !== -1 && mobileIndex !== -1 && baseIndex !== -1 && extraIndex !== -1,
        html,
      )
      assert(
        appIndex < mobileIndex && mobileIndex < baseIndex && baseIndex < extraIndex,
        `expected app < mobile < base < extra, got indices ${
          JSON.stringify({ appIndex, mobileIndex, baseIndex, extraIndex })
        }: ${html}`,
      )
      assert(
        html.includes('href="/assets/extra-hash.css" media="(max-width: 599px)"'),
        html,
      )
      const baseLinkMatch = html.match(/<link[^>]*href="\/assets\/base-hash\.css"[^>]*>/)
      assert(baseLinkMatch, html)
      assertFalse(baseLinkMatch[0].includes('media='), baseLinkMatch[0])
    } finally {
      reset()
    }
  },
)

Deno.test(
  'render-page-preact styles: a page with no styles declared behaves EXACTLY as before P2-12b ' +
    '— global only, nothing extra, no error',
  async () => {
    setPageTree(PageNoStyles, { filePath: '/fake/routes/none/page.tsx', segments: [] })
    setCssManifest({ global: ['/assets/app-hash.css'] })
    try {
      const response = await renderPageResponse(
        PageNoStyles,
        Ok,
        mockPageContext(),
        undefined,
        false,
        undefined,
        undefined,
        CSP_SIGNATURE_NONE,
      )
      const html = await response.text()
      assert(html.includes('href="/assets/app-hash.css"'), html)
      const linkCount = (html.match(/<link rel="stylesheet"/g) ?? []).length
      assertEquals(linkCount, 1, html)
    } finally {
      reset()
    }
  },
)

Deno.test(
  'render-page-preact styles: cascade order in the real SSR HTML is global → page → comet — ' +
    'Preact has no hoisting at all (confirmed absent, P2-12c), so this is guaranteed purely by ' +
    'render position: global/page inside <head>, whatever renders later in <body> (where a ' +
    "Comet's own inline <link> would sit — see this test's own note below) stays there",
  async () => {
    setActiveRenderer('preact')
    // A plain, hand-written `<link>` standing in for a real Comet's own inline stylesheet link,
    // NOT `defineComet` itself — this test targets one structural guarantee (a `<link>` rendered
    // deeper in `<body>` stays exactly where it was placed, since Preact has no hoisting to move
    // it), and a stand-in isolates that from everything a real Comet also does.
    //
    // HISTORICAL NOTE, kept deliberately: this comment used to claim that feeding `defineComet`'s
    // output to Preact's renderer "does not work in a bare `deno test` environment". That
    // diagnosis was wrong, and the wrongness mattered — the real cause was that `CometBoundary`
    // built its markup with React JSX (this package's fixed `jsxImportSource`), so under Preact a
    // Comet silently rendered as NOTHING in production too, not just in tests. It is fixed:
    // `define-comet.ts` now builds elements through the active renderer's own `createElement`
    // (see `comets/element-factory.ts`), and `define-comet-preact.test.ts` pins the real
    // behaviour shut against a real Preact SSR render. The stand-in below stays because it is the
    // right tool for THIS test's narrow question, not because a Comet cannot be rendered here.
    function WidgetLikeContent() {
      return createElement(
        'div',
        null,
        createElement('link', { rel: 'stylesheet', href: '/assets/widget-hash.css' }),
        'widget',
      )
    }

    // A Preact page names its own renderer's component type as the third type argument — see
    // `SpacePageController`'s own `TComponent` doc. Without it the class is checked against
    // React's `ComponentType`, which no Preact component can satisfy.
    class PageWithWidgetLike extends SpacePageController {
      public override component = WidgetLikeContent
      public static override styles = ['./page.css']
    }

    setPageTree(PageWithWidgetLike, {
      filePath: '/fake/routes/with-comet-preact/page.tsx',
      segments: [],
    })
    setCssManifest({
      global: ['/assets/app-hash.css'],
      pages: { '/fake/routes/with-comet-preact/page.tsx': ['/assets/page-hash.css'] },
    })
    try {
      const response = await renderPageResponse(
        PageWithWidgetLike,
        WidgetLikeContent,
        mockPageContext(),
        undefined,
        false,
        undefined,
        undefined,
        CSP_SIGNATURE_NONE,
      )
      const html = await response.text()

      const appIndex = html.indexOf('/assets/app-hash.css')
      const pageIndex = html.indexOf('/assets/page-hash.css')
      const cometIndex = html.indexOf('/assets/widget-hash.css')
      assert(appIndex !== -1 && pageIndex !== -1 && cometIndex !== -1, html)
      assert(
        appIndex < pageIndex && pageIndex < cometIndex,
        `expected global < page < comet, got ${
          JSON.stringify({ appIndex, pageIndex, cometIndex })
        }: ${html}`,
      )

      const headEnd = html.indexOf('</head>')
      assert(pageIndex < headEnd, 'expected the page CSS link inside <head>')
      assert(cometIndex > headEnd, 'expected the comet-like <link> in <body>, no hoisting')
    } finally {
      reset()
    }
  },
)

Deno.test(
  "render-page-preact styles: dev mode resolves a page's own styles relative to THAT page's " +
    'own file directory, same as React',
  async () => {
    class DevOrderPage extends SpacePageController {
      public override component = null
      public static override styles = [
        './product.css',
        { href: './product-mobile.css', media: '(max-width: 599px)' },
      ]
    }
    setPageTree(DevOrderPage, {
      filePath: 'routes/products/[id]/page.tsx',
      segments: [],
    })
    setDevClientEnabled(true)
    try {
      const response = await renderPageResponse(
        DevOrderPage,
        Ok,
        mockPageContext(),
        undefined,
        false,
        undefined,
        undefined,
        CSP_SIGNATURE_NONE,
      )
      const html = await response.text()

      assert(
        html.includes('href="/routes/products/[id]/product.css?direct"'),
        html,
      )
      assert(
        html.includes(
          'href="/routes/products/[id]/product-mobile.css?direct" media="(max-width: 599px)"',
        ),
        html,
      )
    } finally {
      setDevClientEnabled(false)
    }
  },
)
