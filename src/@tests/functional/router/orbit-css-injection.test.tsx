// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import '../../../../mod-preact.ts'
import { assert, assertEquals, assertFalse } from '@std/assert'
import { createElement as createElementReact } from 'react'
import { createElement as createElementPreact } from 'preact'
import { SpacePageController } from 'modules/router/mod.ts'
import { setPageTree } from 'modules/router/page-tree-registry.ts'
import { mockPageContext } from 'modules/testing/mod.ts'
import { setCssManifest } from 'modules/render/css-manifest.ts'
import { renderPageResponse as renderPageResponseReact } from 'modules/router/render-page-react.tsx'
import { renderPageResponse as renderPageResponsePreact } from 'modules/router/render-page-preact.ts'
import { defineComet } from 'modules/comets/define-comet.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { extractStylesheetLinks } from 'modules/client/orbit.ts'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'

console.error = () => {}

/**
 * P2-12d: Orbit navigation-time CSS. These tests cover the SERVER half — that a fragment response
 * (`fragmentOnly: true`) carries the destination's own page CSS (and that a Comet's own inline CSS
 * stays present, unaffected) as real `<link rel="stylesheet">` elements, in the SAME
 * `StylesheetRef`/`CssManifest` shape a full SSR render already uses. Each test also runs the
 * fragment's real HTML through `extractStylesheetLinks` (`modules/client/orbit.ts`) — the exact
 * same pure function Orbit's own client runtime uses — closing the loop end-to-end without needing
 * a real browser.
 *
 * The CLIENT half (`ensureStylesheetsLoaded`'s actual `document.head` mutation, `load`/`error`/
 * timeout handling, dedup against the live DOM) is NOT covered here — this project has no DOM-shim
 * dependency anywhere (a deliberate, already-documented choice, same reasoning `prefetch.ts`'s own
 * DOM-dependent trigger wiring already carries) — verified by code review against the real DOM
 * APIs involved, not by an automated test.
 */

function reset() {
  setCssManifest(undefined)
  setActiveRenderer('react')
}

// -- React fixtures --------------------------------------------------------------------------

class ReactPageWithStyles extends SpacePageController {
  public override component = null
  public static override styles = ['./product.css']
}

class ReactPageNoStyles extends SpacePageController {
  public override component = null
}

Deno.test(
  'Orbit fragment (React): a destination page with its own styles carries them as real ' +
    '<link rel="stylesheet"> elements in the fragment body — extractStylesheetLinks recovers ' +
    'exactly the same href the manifest declared',
  async () => {
    setPageTree(ReactPageWithStyles, { filePath: '/fake/routes/product/page.tsx', segments: [] })
    setCssManifest({
      global: ['/assets/app-hash.css'],
      pages: { '/fake/routes/product/page.tsx': ['/assets/product-hash.css'] },
    })
    try {
      const response = await renderPageResponseReact(
        ReactPageWithStyles,
        () => createElementReact('p', null, 'ok'),
        mockPageContext(),
        undefined,
        true,
        undefined,
        undefined,
      )
      const html = await response.text()

      // Global never appears in a fragment — unchanged, pre-existing behavior.
      assertFalse(html.includes('app-hash.css'), html)
      assert(html.includes('<link rel="stylesheet" href="/assets/product-hash.css"'), html)

      const { refs } = extractStylesheetLinks(html)
      assertEquals(refs, [{ href: '/assets/product-hash.css' }])
    } finally {
      reset()
    }
  },
)

Deno.test(
  "Orbit fragment (React): a destination page's Comet keeps shipping its own CSS inline, " +
    'unaffected by P2-12d — extractStylesheetLinks recovers it the same way as page CSS, no ' +
    'special-casing',
  async () => {
    function Widget() {
      return createElementReact('div', null, 'widget')
    }
    const Comet = defineComet(Widget, `file://${Deno.cwd()}/comets/orbit-widget.tsx`)
    const cometKey = new URL(`file://${Deno.cwd()}/comets/orbit-widget.tsx`).pathname

    class ReactPageWithComet extends SpacePageController {
      public override component = Comet
    }

    setPageTree(ReactPageWithComet, { filePath: '/fake/routes/with-comet/page.tsx', segments: [] })
    setCssManifest({
      global: ['/assets/app-hash.css'],
      comets: { [cometKey]: ['/assets/widget-hash.css'] },
    })
    try {
      const response = await renderPageResponseReact(
        ReactPageWithComet,
        Comet,
        mockPageContext(),
        undefined,
        true,
        undefined,
        undefined,
      )
      const html = await response.text()

      assert(html.includes('href="/assets/widget-hash.css"'), html)
      const { refs } = extractStylesheetLinks(html)
      assertEquals(refs, [{ href: '/assets/widget-hash.css' }])
    } finally {
      reset()
    }
  },
)

Deno.test(
  'Orbit fragment (React): a destination with BOTH its own page CSS and a Comet with CSS carries ' +
    'both — extractStylesheetLinks recovers both, deduplicated, in order',
  async () => {
    function Widget() {
      return createElementReact('div', null, 'widget')
    }
    const Comet = defineComet(Widget, `file://${Deno.cwd()}/comets/orbit-both-widget.tsx`)
    const cometKey = new URL(`file://${Deno.cwd()}/comets/orbit-both-widget.tsx`).pathname

    class ReactPageWithBoth extends SpacePageController {
      public override component = Comet
      public static override styles = [
        { href: './product-mobile.css', media: '(max-width: 599px)' },
      ]
    }

    setPageTree(ReactPageWithBoth, { filePath: '/fake/routes/both/page.tsx', segments: [] })
    setCssManifest({
      global: ['/assets/app-hash.css'],
      pages: {
        '/fake/routes/both/page.tsx': [
          { href: '/assets/product-mobile-hash.css', media: '(max-width: 599px)' },
        ],
      },
      comets: { [cometKey]: ['/assets/widget-hash.css'] },
    })
    try {
      const response = await renderPageResponseReact(
        ReactPageWithBoth,
        Comet,
        mockPageContext(),
        undefined,
        true,
        undefined,
        undefined,
      )
      const html = await response.text()

      const { refs } = extractStylesheetLinks(html)
      assertEquals(refs, [
        { href: '/assets/product-mobile-hash.css', media: '(max-width: 599px)' },
        { href: '/assets/widget-hash.css' },
      ])
    } finally {
      reset()
    }
  },
)

Deno.test(
  'Orbit fragment (React): a page with NO styles produces a fragment with no extra stylesheet ' +
    'link at all — byte-identical backward compat with pre-P2-12d behavior',
  async () => {
    setPageTree(ReactPageNoStyles, { filePath: '/fake/routes/none/page.tsx', segments: [] })
    setCssManifest({ global: ['/assets/app-hash.css'] })
    try {
      const response = await renderPageResponseReact(
        ReactPageNoStyles,
        () => createElementReact('p', null, 'ok'),
        mockPageContext(),
        undefined,
        true,
        undefined,
        undefined,
      )
      const html = stripHydrationComments(await response.text())

      assertFalse(html.includes('stylesheet'), html)
      const { refs } = extractStylesheetLinks(html)
      assertEquals(refs, [])
    } finally {
      reset()
    }
  },
)

Deno.test(
  'Orbit full document (React): a page with its own styles renders an UNCHANGED full document — ' +
    'page CSS still comes through cssHrefs in <head> only, never duplicated via the new ' +
    'fragment-only <link> rendering path',
  async () => {
    setPageTree(ReactPageWithStyles, {
      filePath: '/fake/routes/product-full/page.tsx',
      segments: [],
    })
    setCssManifest({
      global: ['/assets/app-hash.css'],
      pages: { '/fake/routes/product-full/page.tsx': ['/assets/product-hash.css'] },
    })
    try {
      const response = await renderPageResponseReact(
        ReactPageWithStyles,
        () => createElementReact('p', null, 'ok'),
        mockPageContext(),
        undefined,
        false, // full document
        undefined,
        undefined,
      )
      const html = await response.text()

      const occurrences = html.split('/assets/product-hash.css').length - 1
      assertEquals(occurrences, 1, `expected exactly one occurrence, got ${occurrences}: ${html}`)
      assert(html.includes('/assets/app-hash.css'), html)
    } finally {
      reset()
    }
  },
)

// -- Preact fixtures -------------------------------------------------------------------------

class PreactPageWithStyles extends SpacePageController {
  public override component = null
  public static override styles = ['./product.css']
}

class PreactPageNoStyles extends SpacePageController {
  public override component = null
}

Deno.test(
  'Orbit fragment (Preact): a destination page with its own styles carries them as real ' +
    '<link rel="stylesheet"> elements — extractStylesheetLinks recovers the same href',
  async () => {
    setPageTree(PreactPageWithStyles, {
      filePath: '/fake/routes/product-preact/page.tsx',
      segments: [],
    })
    setCssManifest({
      global: ['/assets/app-hash.css'],
      pages: { '/fake/routes/product-preact/page.tsx': ['/assets/product-hash.css'] },
    })
    try {
      const response = await renderPageResponsePreact(
        PreactPageWithStyles,
        () => createElementPreact('p', null, 'ok'),
        mockPageContext(),
        undefined,
        true,
        undefined,
        undefined,
      )
      const html = await response.text()

      assertFalse(html.includes('app-hash.css'), html)
      const { refs } = extractStylesheetLinks(html)
      assertEquals(refs, [{ href: '/assets/product-hash.css' }])
    } finally {
      reset()
    }
  },
)

Deno.test(
  "Orbit fragment (Preact): a destination page's Comet-like inline CSS is recovered the same way " +
    'as page CSS by extractStylesheetLinks — no special-casing',
  async () => {
    function WidgetLikeContent() {
      return createElementPreact(
        'div',
        null,
        createElementPreact('link', { rel: 'stylesheet', href: '/assets/widget-hash.css' }),
        'widget',
      )
    }
    // A Preact page names its own renderer's component type as the third type argument — see
    // `SpacePageController`'s own `TComponent` doc. Without it the class is checked against
    // React's `ComponentType`, which no Preact component can satisfy.
    class PreactPageWithWidgetLike extends SpacePageController {
      public override component = WidgetLikeContent
    }

    setPageTree(PreactPageWithWidgetLike, {
      filePath: '/fake/routes/with-comet-preact/page.tsx',
      segments: [],
    })
    setCssManifest({ global: ['/assets/app-hash.css'] })
    try {
      const response = await renderPageResponsePreact(
        PreactPageWithWidgetLike,
        WidgetLikeContent,
        mockPageContext(),
        undefined,
        true,
        undefined,
        undefined,
      )
      const html = await response.text()

      const { refs, body } = extractStylesheetLinks(html)
      assertEquals(refs, [{ href: '/assets/widget-hash.css' }])
      assertFalse(body.includes('stylesheet'), body)
    } finally {
      reset()
    }
  },
)

Deno.test(
  "Orbit fragment (Preact): media survives on a page's own stylesheet ref",
  async () => {
    class PreactPageWithMedia extends SpacePageController {
      public override component = null
      public static override styles = [
        { href: './product-mobile.css', media: '(max-width: 599px)' },
      ]
    }
    setPageTree(PreactPageWithMedia, {
      filePath: '/fake/routes/media-preact/page.tsx',
      segments: [],
    })
    setCssManifest({
      global: [],
      pages: {
        '/fake/routes/media-preact/page.tsx': [
          { href: '/assets/product-mobile-hash.css', media: '(max-width: 599px)' },
        ],
      },
    })
    try {
      const response = await renderPageResponsePreact(
        PreactPageWithMedia,
        () => createElementPreact('p', null, 'ok'),
        mockPageContext(),
        undefined,
        true,
        undefined,
        undefined,
      )
      const html = await response.text()
      const { refs } = extractStylesheetLinks(html)
      assertEquals(refs, [
        { href: '/assets/product-mobile-hash.css', media: '(max-width: 599px)' },
      ])
    } finally {
      reset()
    }
  },
)

Deno.test(
  'Orbit fragment (Preact): a page with NO styles produces a fragment with no extra stylesheet ' +
    'link at all — byte-identical backward compat with pre-P2-12d behavior',
  async () => {
    setPageTree(PreactPageNoStyles, { filePath: '/fake/routes/none-preact/page.tsx', segments: [] })
    setCssManifest({ global: ['/assets/app-hash.css'] })
    try {
      const response = await renderPageResponsePreact(
        PreactPageNoStyles,
        () => createElementPreact('p', null, 'ok'),
        mockPageContext(),
        undefined,
        true,
        undefined,
        undefined,
      )
      const html = await response.text()

      assertFalse(html.includes('stylesheet'), html)
      const { refs } = extractStylesheetLinks(html)
      assertEquals(refs, [])
    } finally {
      reset()
    }
  },
)

Deno.test(
  'Orbit full document (Preact): a page with its own styles renders an UNCHANGED full document ' +
    '— page CSS still comes through cssHrefs in <head> only, never duplicated',
  async () => {
    setPageTree(PreactPageWithStyles, {
      filePath: '/fake/routes/product-full-preact/page.tsx',
      segments: [],
    })
    setCssManifest({
      global: ['/assets/app-hash.css'],
      pages: { '/fake/routes/product-full-preact/page.tsx': ['/assets/product-hash.css'] },
    })
    try {
      const response = await renderPageResponsePreact(
        PreactPageWithStyles,
        () => createElementPreact('p', null, 'ok'),
        mockPageContext(),
        undefined,
        false, // full document
        undefined,
        undefined,
      )
      const html = await response.text()

      const occurrences = html.split('/assets/product-hash.css').length - 1
      assertEquals(occurrences, 1, `expected exactly one occurrence, got ${occurrences}: ${html}`)
      assert(html.includes('/assets/app-hash.css'), html)
    } finally {
      reset()
    }
  },
)
