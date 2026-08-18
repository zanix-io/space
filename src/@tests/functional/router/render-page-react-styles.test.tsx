// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals, assertFalse } from '@std/assert'
import { createElement } from 'react'
import { SpacePageController } from 'modules/router/mod.ts'
import { setPageTree } from 'modules/router/page-tree-registry.ts'
import { mockPageContext } from 'modules/testing/mod.ts'
import { setCssManifest } from 'modules/render/css-manifest.ts'
import { setDevClientEnabled } from 'modules/dev/dev-client-registry.ts'
import { renderPageResponse } from 'modules/router/render-page-react.tsx'
import { defineComet } from 'modules/comets/define-comet.ts'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'

console.error = () => {}

// Same fake-class-via-setPageTree style `render-page-react-head.test.tsx` already establishes —
// this file is the React counterpart to that one, for `static styles` (P2-12b) instead of `head`.
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

Deno.test(
  'render-page-react styles: page A gets global + its own CSS, page B gets global + ITS OWN — ' +
    "never the other's (real scope isolation, P2-12b)",
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
      )
      const htmlB = await responseB.text()
      assert(htmlB.includes('href="/assets/app-hash.css"'), htmlB)
      assert(htmlB.includes('href="/assets/b-hash.css"'), htmlB)
      assertFalse(htmlB.includes('a-hash.css'), htmlB)
    } finally {
      setCssManifest(undefined)
    }
  },
)

Deno.test(
  "render-page-react styles: a page's own declaration order is preserved in the real HTML — " +
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
      )
      const html = await response.text()
      const headContent = html.slice(html.indexOf('<head'), html.indexOf('</head>'))

      const appIndex = headContent.indexOf('/assets/app-hash.css')
      const mobileIndex = headContent.indexOf('/assets/mobile-hash.css')
      const baseIndex = headContent.indexOf('/assets/base-hash.css')
      const extraIndex = headContent.indexOf('/assets/extra-hash.css')
      assert(
        appIndex !== -1 && mobileIndex !== -1 && baseIndex !== -1 && extraIndex !== -1,
        headContent,
      )
      assert(
        appIndex < mobileIndex && mobileIndex < baseIndex && baseIndex < extraIndex,
        `expected app < mobile < base < extra, got indices ${
          JSON.stringify({ appIndex, mobileIndex, baseIndex, extraIndex })
        }: ${headContent}`,
      )
      assert(
        headContent.includes('href="/assets/extra-hash.css" media="(max-width: 599px)"'),
        headContent,
      )
      const baseLinkMatch = headContent.match(/<link[^>]*href="\/assets\/base-hash\.css"[^>]*>/)
      assert(baseLinkMatch, headContent)
      assertFalse(baseLinkMatch[0].includes('media='), baseLinkMatch[0])
    } finally {
      setCssManifest(undefined)
    }
  },
)

Deno.test(
  'render-page-react styles: a page with no styles declared behaves EXACTLY as before P2-12b — ' +
    'global only, nothing extra, no error',
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
      )
      const html = await response.text()
      assert(html.includes('href="/assets/app-hash.css"'), html)
      const linkCount = (html.match(/<link rel="stylesheet"/g) ?? []).length
      assertEquals(linkCount, 1, html)
    } finally {
      setCssManifest(undefined)
    }
  },
)

Deno.test(
  'render-page-react styles: cascade order in the real SSR HTML is global → page → comet — ' +
    "React 19 hoists the Comet's own precedence-managed <link> into the SAME real <head> " +
    "cssHrefs' own links already render in (confirmed empirically, P2-12c), but preserves " +
    'first-encounter order across the whole tree, so global/page (encountered in <head>, ' +
    "earlier) still precede the Comet's own link (encountered later, deeper in <body>)",
  async () => {
    function Widget() {
      return createElement('div', null, 'widget')
    }
    const Comet = defineComet(Widget, `file://${Deno.cwd()}/comets/widget.tsx`)
    const cometKey = new URL(`file://${Deno.cwd()}/comets/widget.tsx`).pathname

    class PageWithComet extends SpacePageController {
      public override component = Comet
      public static override styles = ['./page.css']
    }

    setPageTree(PageWithComet, { filePath: '/fake/routes/with-comet/page.tsx', segments: [] })
    setCssManifest({
      global: ['/assets/app-hash.css'],
      pages: { '/fake/routes/with-comet/page.tsx': ['/assets/page-hash.css'] },
      comets: { [cometKey]: ['/assets/widget-hash.css'] },
    })
    try {
      const response = await renderPageResponse(
        PageWithComet,
        Comet,
        mockPageContext(),
        undefined,
        false,
        undefined,
        undefined,
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

      // React 19's own resource hoisting pulls the Comet's `precedence`-managed <link> into the
      // SAME real <head> too (confirmed empirically, P2-12c's own design doc §9) — never left
      // behind in <body> the way it's declared in the source JSX. The order assertion above is
      // what actually proves cascade correctness here; this just confirms hoisting really ran.
      const headEnd = html.indexOf('</head>')
      assert(pageIndex < headEnd, 'expected the page CSS link inside <head>')
      assert(cometIndex < headEnd, "expected the comet's own <link> ALSO hoisted into <head>")
    } finally {
      setCssManifest(undefined)
    }
  },
)

Deno.test(
  "render-page-react styles: dev mode resolves a page's own styles relative to THAT page's own " +
    'file directory (the direct-asset path, no manifest/build involved) — different resolution ' +
    "base than globalCss's own root-relative one",
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
      )
      const html = stripHydrationComments(await response.text())

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
