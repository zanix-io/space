import { assert, assertEquals, assertFalse } from '@std/assert'
import { createElement as createElementPreact } from 'preact'
import { renderToResponse } from '../../../../mod-react.ts'
import { renderToResponse as renderToResponsePreact } from 'modules/render/render-to-response-preact.ts'
// BOTH entry points, and installed PER TEST rather than relying on import order. Installing a
// renderer replaces the page/not-found renderer wholesale (one renderer per app, per
// `renderer-runtime.ts`), and in a shared test process the last module evaluated anywhere in the
// run would otherwise decide it — a real source of order-dependent failures. Each case below states
// which renderer it needs. The Comet element factory is kept per renderer instead (one slot each),
// so both stay available regardless.
import { installPreactRuntime } from '../../../../mod-preact.ts'
import { installReactRuntime } from '../../../../mod-react.ts'
import { defineComet } from 'modules/comets/define-comet.ts'
import { setCometManifest } from 'modules/comets/comet-manifest.ts'
import { resolveCssHrefs, setCssManifest } from 'modules/render/css-manifest.ts'
import { getActiveRenderer, setActiveRenderer } from 'modules/router/active-renderer.ts'
import { Page, SpacePageController } from 'modules/router/mod.ts'
import { mockHandlerContext } from 'modules/testing/mod.ts'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'

console.error = () => {}

function Widget() {
  return <div>widget</div>
}

/** `Widget`'s Preact counterpart — built with Preact's own `createElement`, so the Preact test
 * below renders a genuinely Preact tree rather than a React one with a flag flipped. */
export function PreactWidget() {
  return createElementPreact('div', null, 'preact-widget')
}

const WIDGET_SOURCE_URL = `file://${Deno.cwd()}/comets/widget.tsx`
const OTHER_SOURCE_URL = `file://${Deno.cwd()}/comets/other.tsx`
// `css-manifest.json`'s `comets` field is always keyed by the NORMALIZED (plain-path, no
// `file://` prefix) form — the exact same identity `build-client.ts` writes via
// `normalizeSourceKey(comet)` (a Rollup module id, already a plain path). `getCometCssHrefs`
// normalizes ITS OWN `sourceUrl` argument before looking it up, so a manifest built/set with the
// raw `file://` form as its key would never match a real comet's lookup — these fixtures use the
// same normalized form a real build actually produces, not the raw `import.meta.url` shape.
const WIDGET_KEY = new URL(WIDGET_SOURCE_URL).pathname
const OTHER_KEY = new URL(OTHER_SOURCE_URL).pathname

function reset() {
  setCometManifest(undefined)
  setCssManifest(undefined)
  setActiveRenderer('react')
  // Restores the page renderer too, not just the flag: a Preact case installs Preact's, and every
  // full-document case in this file renders through React's.
  installReactRuntime()
}

/** Every full-document case here is a REACT render — stated per test rather than inherited from
 * whatever module happened to be evaluated last in the run. */
function useReact() {
  installReactRuntime()
  setActiveRenderer('react')
}

Deno.test(
  'defineComet: a comet with its own CSS in the manifest links that stylesheet inline, at its ' +
    'own render position',
  async () => {
    setCssManifest({ global: [], comets: { [WIDGET_KEY]: ['/assets/widget-hash.css'] } })
    try {
      const Comet = defineComet(Widget, WIDGET_SOURCE_URL)
      const response = await renderToResponse(<Comet comet='visible' />)
      const html = await response.text()

      assert(
        html.includes('<link rel="stylesheet" href="/assets/widget-hash.css"'),
        html,
      )
    } finally {
      reset()
    }
  },
)

Deno.test(
  'defineComet: a comet used on the page but absent from manifest.comets (no CSS of its own) ' +
    'renders no stylesheet link at all — never a broken/empty href',
  async () => {
    setCssManifest({ global: [], comets: { [OTHER_KEY]: ['/assets/other-hash.css'] } })
    try {
      const Comet = defineComet(Widget, WIDGET_SOURCE_URL)
      const response = await renderToResponse(<Comet comet='visible' />)
      const html = stripHydrationComments(await response.text())

      assertFalse(html.includes('stylesheet'), html)
    } finally {
      reset()
    }
  },
)

Deno.test(
  'defineComet: with no CSS manifest loaded at all, a comet renders with no stylesheet link ' +
    '(dev / no-CSS apps) — never throws',
  async () => {
    const Comet = defineComet(Widget, WIDGET_SOURCE_URL)
    const response = await renderToResponse(<Comet comet='visible' />)
    const html = stripHydrationComments(await response.text())

    assertFalse(html.includes('stylesheet'), html)
  },
)

Deno.test(
  "defineComet: a comet's CSS ref in object form ({href, media}) renders its media attribute too",
  async () => {
    setCssManifest({
      global: [],
      comets: {
        [WIDGET_KEY]: [{ href: '/assets/widget-hash.css', media: '(min-width: 768px)' }],
      },
    })
    try {
      const Comet = defineComet(Widget, WIDGET_SOURCE_URL)
      const response = await renderToResponse(<Comet comet='visible' />)
      const html = await response.text()

      assert(html.includes('href="/assets/widget-hash.css"'), html)
      assert(html.includes('media="(min-width: 768px)"'), html)
    } finally {
      reset()
    }
  },
)

Deno.test(
  'defineComet: a comet CSS ref in plain string form renders with no media attribute at all',
  async () => {
    setCssManifest({ global: [], comets: { [WIDGET_KEY]: ['/assets/widget-hash.css'] } })
    try {
      const Comet = defineComet(Widget, WIDGET_SOURCE_URL)
      const response = await renderToResponse(<Comet comet='visible' />)
      const html = await response.text()

      assertFalse(html.includes('media='), html)
    } finally {
      reset()
    }
  },
)

Deno.test(
  "defineComet: a comet's own CSS is NEVER part of resolveCssHrefs() (the global scope) — only " +
    "reachable via the comet's own render, proving global and comet CSS are two genuinely " +
    'separate delivery scopes, not one flattened list',
  () => {
    setCssManifest({
      global: ['/assets/app-hash.css'],
      comets: { [WIDGET_KEY]: ['/assets/widget-hash.css'] },
    })
    try {
      const globalHrefs = resolveCssHrefs()
      assertEquals(globalHrefs, ['/assets/app-hash.css'])
      assertFalse(
        (globalHrefs ?? []).some((ref) =>
          (typeof ref === 'string' ? ref : ref.href) === '/assets/widget-hash.css'
        ),
        JSON.stringify(globalHrefs),
      )
    } finally {
      reset()
    }
  },
)

Deno.test(
  'defineComet: under react (the default active renderer), the comet CSS <link> carries ' +
    "precedence='space' — React 19's own resource-hoisting/dedup contract, confirmed separately " +
    'by the full-document test below',
  async () => {
    setCssManifest({ global: [], comets: { [WIDGET_KEY]: ['/assets/widget-hash.css'] } })
    try {
      assertEquals(getActiveRenderer(), 'react')
      const Comet = defineComet(Widget, WIDGET_SOURCE_URL)
      const response = await renderToResponse(<Comet comet='visible' />)
      const html = await response.text()

      // React only renders `precedence` as a real DOM/HTML attribute (`data-precedence`) when the
      // element is NOT actually hoisted into a real `<head>` (there is none in this bare fragment
      // render) — still proof the prop was set at all, which is what this test targets; the real
      // document-level test below is what proves the ACTUAL hoisting/dedup behavior.
      assert(html.includes('data-precedence="space"'), html)
    } finally {
      reset()
    }
  },
)

Deno.test(
  'defineComet: under preact, the comet CSS <link> carries no precedence at all — Preact has no ' +
    "hoisting (confirmed absent, this package's own decision spike), so a `precedence` prop " +
    "would be meaningless there; CometBoundary's own branch on getActiveRenderer() omits it",
  async () => {
    // Rendered through Preact's REAL SSR path, not React's with the renderer flag flipped. The
    // earlier version of this test did the latter, and that is precisely why it stayed green
    // while Comets were completely non-functional under Preact: flipping `getActiveRenderer()`
    // exercises the `precedence` branch, but nothing about the actual renderer. The full
    // behavioural suite for this now lives in `define-comet-preact.test.ts`; this case stays here
    // because CSS scope is what this file is about — it just no longer lies about what it proves.
    installPreactRuntime()
    setActiveRenderer('preact')
    setCssManifest({ global: [], comets: { [WIDGET_KEY]: ['/assets/widget-hash.css'] } })
    try {
      const Comet = defineComet(PreactWidget, WIDGET_SOURCE_URL)
      const response = renderToResponsePreact(
        createElementPreact(Comet as never, { comet: 'visible' }),
      )
      const html = await response.text()

      assert(html.includes('href="/assets/widget-hash.css"'), html)
      assertFalse(html.includes('precedence'), html)
      // The boundary and its content really rendered — the assertion the old version could not
      // make, because under React it was never Preact's renderer producing this HTML.
      assert(html.includes('data-comet-export="PreactWidget"'), html)
      assert(html.includes('preact-widget'), html)
    } finally {
      reset()
    }
  },
)

function Empty() {
  return <div>empty</div>
}

Deno.test(
  'SpacePageController.handleGet: THE BUG FIX — a comet used by page A links its own CSS on ' +
    "page A's full document; page B, which never renders that comet, gets no such link at all, " +
    'even though both pages share the same production css-manifest.json',
  async () => {
    useReact()
    const Comet = defineComet(Widget, WIDGET_SOURCE_URL)

    @Page('comet-css-scope-with-widget')
    class WithWidgetPage extends SpacePageController {
      public override component = Comet
    }
    void WithWidgetPage

    @Page('comet-css-scope-without-widget')
    class WithoutWidgetPage extends SpacePageController {
      public override component = Empty
    }
    void WithoutWidgetPage

    setCssManifest({
      global: ['/assets/app-hash.css'],
      comets: { [WIDGET_KEY]: ['/assets/widget-hash.css'] },
    })
    try {
      const withResponse = await new WithWidgetPage(mockHandlerContext()).handleGet(
        mockHandlerContext(),
      )
      const withHtml = await withResponse.text()
      assert(withHtml.includes('href="/assets/app-hash.css"'), withHtml)
      assert(withHtml.includes('href="/assets/widget-hash.css"'), withHtml)

      const withoutResponse = await new WithoutWidgetPage(mockHandlerContext()).handleGet(
        mockHandlerContext(),
      )
      const withoutHtml = await withoutResponse.text()
      assert(withoutHtml.includes('href="/assets/app-hash.css"'), withoutHtml)
      assertFalse(
        withoutHtml.includes('widget-hash.css'),
        `page B must never link a comet's CSS it never renders: ${withoutHtml}`,
      )
    } finally {
      reset()
    }
  },
)

Deno.test(
  'SpacePageController.handleGet: React hoists AND dedupes a comet used TWICE on the same full ' +
    'document — exactly one <link> in <head>, not two, confirmed on the real rendered HTML ' +
    '(not inferred from React internals)',
  async () => {
    useReact()
    const Comet = defineComet(Widget, WIDGET_SOURCE_URL)

    function TwiceBody() {
      return (
        <div>
          <Comet comet='visible' />
          <Comet comet='visible' />
        </div>
      )
    }

    @Page('comet-css-scope-used-twice')
    class UsedTwicePage extends SpacePageController {
      public override component = TwiceBody
    }
    void UsedTwicePage

    setCssManifest({ global: [], comets: { [WIDGET_KEY]: ['/assets/widget-hash.css'] } })
    try {
      const response = await new UsedTwicePage(mockHandlerContext()).handleGet(
        mockHandlerContext(),
      )
      const html = await response.text()

      const headEnd = html.indexOf('</head>')
      assert(headEnd !== -1, html)
      const head = html.slice(0, headEnd)
      assert(head.includes('/assets/widget-hash.css'), html)

      const occurrences = html.split('/assets/widget-hash.css').length - 1
      assertEquals(occurrences, 1, `expected exactly one link, got ${occurrences}: ${html}`)
    } finally {
      reset()
    }
  },
)

Deno.test(
  'defineComet: backward compat — a css-manifest with no comets field at all (an app built ' +
    'before P2-12c, or one with zero comets) never throws; getCometCssHrefs-derived rendering ' +
    'simply omits any comet stylesheet, global scope unaffected',
  async () => {
    setCssManifest({ global: ['/assets/app-hash.css'] })
    try {
      const Comet = defineComet(Widget, WIDGET_SOURCE_URL)
      const response = await renderToResponse(<Comet comet='visible' />)
      const html = stripHydrationComments(await response.text())

      assertFalse(html.includes('stylesheet'), html)
      assertEquals(resolveCssHrefs(), ['/assets/app-hash.css'])
    } finally {
      reset()
    }
  },
)
