// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import '../../../../mod-preact.ts'
import { assert, assertEquals, assertFalse } from '@std/assert'
import { createElement } from 'preact'
import { useState } from 'preact/hooks'
import { defineComet } from 'modules/comets/define-comet.ts'
import { setCometManifest } from 'modules/comets/comet-manifest.ts'
import { setCssManifest } from 'modules/render/css-manifest.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { renderToResponse as renderToResponsePreact } from 'modules/render/render-to-response-preact.ts'
// The Preact entry point, imported for its installation side effect — the same line a real
// `renderer: 'preact'` app writes.
import { renderPageResponse as renderPageResponsePreact } from 'modules/router/render-page-preact.ts'
import { createElement as createElementReact } from 'react'
import type { ComponentType as ComponentTypeReact } from 'react'
import type { CometProps } from 'typings/comet.ts'
import { renderToResponse as renderToResponseReact } from 'modules/render/render-to-response.tsx'
import { SpacePageController } from 'modules/router/mod.ts'
import { setPageTree } from 'modules/router/page-tree-registry.ts'
import { mockPageContext } from 'modules/testing/mod.ts'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'

/**
 * Regression suite for the one defect that made Comets a no-op under Preact: `defineComet` used to
 * build its own boundary markup with JSX, and this package's `jsxImportSource` is fixed to
 * `'react'` — so every element `CometBoundary` created was React-shaped. Fed to
 * `preact-render-to-string`, a React-shaped element is silently discarded (it renders as `""`, with
 * no throw and no warning), so a Comet under `--renderer=preact` produced NO marker and NO content:
 * the whole boundary vanished from the response, and the page still returned a well-formed 200.
 *
 * Every test below renders through a REAL Preact SSR path — `render-page-preact.ts`'s own
 * `renderPageResponse` (the full-document path a real app takes) or `render-to-response-preact.ts`'s
 * `renderToResponse` (the bare-fragment path) — never React's renderer with `setActiveRenderer`
 * flipped. That distinction is the entire point: the pre-existing "under preact" test
 * (`comet-css-scope.test.tsx`) flips the flag but still renders with React, which is exactly why it
 * stayed green while the feature was completely broken.
 *
 * @module
 */

console.error = () => {}

/** A stateless Preact comet — the minimal case. */
export function Widget({ label }: { label: string }) {
  return createElement('span', { class: 'widget' }, `widget:${label}`)
}

/** The React counterpart of `Widget`, for the React-regression test — same markup, React-built. */
export function ReactWidget({ label }: { label: string }) {
  return createElementReact('span', { className: 'widget' }, `widget:${label}`)
}

/** A stateful Preact comet — SSR must render its real initial hook state, not an empty shell. */
export function Counter({ start }: { start: number }) {
  const [count, setCount] = useState(start)
  return createElement('button', {
    type: 'button',
    onClick: () => setCount((c: number) => c + 1),
  }, `count:${count}`)
}

/**
 * `defineComet` declares its parameter as React's `ComponentType` — the public Comet API is
 * React-shaped regardless of the active renderer, so a Preact component never satisfies it and
 * every Preact comet has to cast at the boundary (the same
 * `as unknown as ComponentType<...>` the real comet wrappers under `benchmarks/space/scenario/
 * preact/comets/` already write). Centralised here so the cast appears once rather than at each
 * call site below.
 *
 * Worth naming plainly: this cast is why TypeScript could not have caught the defect this file
 * exists to pin shut. The type system has no way to reject a Preact component at the Comet
 * boundary, because the boundary demands a React one and every Preact app is obliged to silence
 * that check to use the API at all.
 */
function defineCometPreact<P extends object>(
  Component: (props: P) => unknown,
  sourceUrl: string,
): ComponentTypeReact<P & CometProps> {
  return defineComet(Component as unknown as ComponentTypeReact<P>, sourceUrl)
}

const WIDGET_SOURCE_URL = `file://${Deno.cwd()}/comets/preact-widget.tsx`
const COUNTER_SOURCE_URL = `file://${Deno.cwd()}/comets/preact-counter.tsx`
const WIDGET_KEY = new URL(WIDGET_SOURCE_URL).pathname
const COUNTER_KEY = new URL(COUNTER_SOURCE_URL).pathname

function reset() {
  setCometManifest(undefined)
  setCssManifest(undefined)
  setActiveRenderer('react')
}

/** Renders `element` through the real Preact fragment path, with the renderer actually switched. */
async function renderPreact(element: unknown): Promise<string> {
  setActiveRenderer('preact')
  const response = renderToResponsePreact(element as never)
  return await response.text()
}

Deno.test(
  'defineComet (preact): THE REGRESSION — a Preact comet renders its marker AND its real content ' +
    'through preact-render-to-string; before the element-factory fix the whole boundary rendered ' +
    'as nothing at all',
  async () => {
    setCometManifest({ [WIDGET_KEY]: '/assets/preact-widget-hash.js' })
    try {
      const Comet = defineCometPreact(Widget, WIDGET_SOURCE_URL)
      const html = await renderPreact(createElement(Comet as never, { label: 'a' }))

      // The boundary exists at all — this single assertion is the one that used to fail.
      assert(html.includes('data-comet='), html)
      // ...and it carries the component's REAL rendered output, not an empty wrapper.
      assert(html.includes('widget:a'), html)
      assert(html.includes('<span class="widget">widget:a</span>'), html)
    } finally {
      reset()
    }
  },
)

Deno.test(
  'defineComet (preact): the boundary carries the full marker protocol — id, strategy, module, ' +
    'export name, props — the exact same wire contract hydrate-comets-preact.ts reads back',
  async () => {
    setCometManifest({ [WIDGET_KEY]: '/assets/preact-widget-hash.js' })
    try {
      const Comet = defineCometPreact(Widget, WIDGET_SOURCE_URL)
      const html = await renderPreact(
        createElement(Comet as never, { label: 'b', comet: 'visible' }),
      )

      assert(html.includes(`data-comet="${WIDGET_SOURCE_URL}"`), html)
      assert(html.includes('data-comet-strategy="visible"'), html)
      assert(html.includes('data-comet-module="/assets/preact-widget-hash.js"'), html)
      assert(html.includes('data-comet-export="Widget"'), html)
    } finally {
      reset()
    }
  },
)

Deno.test(
  'defineComet (preact): data-comet-module resolves through the real manifest, and falls back to ' +
    'a dev-root-relative URL when no manifest is loaded — same resolution React already gets',
  async () => {
    // With a manifest: the built, hashed client URL.
    setCometManifest({ [WIDGET_KEY]: '/assets/preact-widget-hash.js' })
    const Comet = defineCometPreact(Widget, WIDGET_SOURCE_URL)
    const withManifest = await renderPreact(createElement(Comet as never, { label: 'c' }))
    assert(withManifest.includes('data-comet-module="/assets/preact-widget-hash.js"'), withManifest)
    reset()

    // Without one (dev): derived from the project root, never the raw file:// source path.
    const devHtml = await renderPreact(createElement(Comet as never, { label: 'c' }))
    assert(devHtml.includes('data-comet-module="/comets/preact-widget.tsx"'), devHtml)
    assertFalse(devHtml.includes('data-comet-module="file://'), devHtml)
    reset()
  },
)

Deno.test(
  "defineComet (preact): a comet's props are serialized as JSON into data-comet-props, with only " +
    'the comet-control props (comet/cometMedia/persist) stripped out',
  async () => {
    setCometManifest({ [COUNTER_KEY]: '/assets/preact-counter-hash.js' })
    try {
      const Comet = defineCometPreact(Counter, COUNTER_SOURCE_URL)
      const html = await renderPreact(
        createElement(Comet as never, { start: 7, comet: 'idle', persist: 'counter-1' }),
      )

      assert(html.includes('data-comet-props="{&quot;start&quot;:7}"'), html)
      // The control props are consumed by the boundary, never forwarded as component props.
      assertFalse(html.includes('&quot;comet&quot;'), html)
      assertFalse(html.includes('&quot;persist&quot;'), html)
      // ...but `persist` DOES survive as its own marker attribute, for Orbit retention.
      assert(html.includes('data-orbit-persist="counter-1"'), html)
      assert(html.includes('data-comet-strategy="idle"'), html)
    } finally {
      reset()
    }
  },
)

Deno.test(
  'defineComet (preact): a STATEFUL comet renders its real initial hook state server-side — ' +
    'useState must actually run under preact-render-to-string, not degrade to an empty shell',
  async () => {
    setCometManifest({ [COUNTER_KEY]: '/assets/preact-counter-hash.js' })
    try {
      const Comet = defineCometPreact(Counter, COUNTER_SOURCE_URL)
      const html = await renderPreact(createElement(Comet as never, { start: 41 }))

      assert(html.includes('count:41'), html)
      assert(html.includes('<button type="button">count:41</button>'), html)
      assert(html.includes('data-comet-export="Counter"'), html)
    } finally {
      reset()
    }
  },
)

Deno.test(
  'defineComet (preact): MULTIPLE comets on one page each get their own independent boundary, ' +
    'with their own props — not one shared or one swallowed',
  async () => {
    setCometManifest({
      [WIDGET_KEY]: '/assets/preact-widget-hash.js',
      [COUNTER_KEY]: '/assets/preact-counter-hash.js',
    })
    try {
      const WidgetComet = defineCometPreact(Widget, WIDGET_SOURCE_URL)
      const CounterComet = defineCometPreact(Counter, COUNTER_SOURCE_URL)

      const html = await renderPreact(
        createElement(
          'div',
          null,
          createElement(WidgetComet as never, { label: 'one' }),
          createElement(WidgetComet as never, { label: 'two', comet: 'idle' }),
          createElement(CounterComet as never, { start: 5 }),
        ),
      )

      const boundaries = html.split('data-comet=').length - 1
      assertEquals(boundaries, 3, `expected 3 comet boundaries, got ${boundaries}: ${html}`)
      assert(html.includes('widget:one'), html)
      assert(html.includes('widget:two'), html)
      assert(html.includes('count:5'), html)
      assert(html.includes('data-comet-export="Widget"'), html)
      assert(html.includes('data-comet-export="Counter"'), html)
      // Two instances of the SAME comet keep their own distinct props.
      assert(html.includes('data-comet-props="{&quot;label&quot;:&quot;one&quot;}"'), html)
      assert(html.includes('data-comet-props="{&quot;label&quot;:&quot;two&quot;}"'), html)
    } finally {
      reset()
    }
  },
)

Deno.test(
  'defineComet (preact): comet="none" renders the component bare, with no boundary at all; ' +
    'comet="only" renders the boundary with no server content, for a client-only mount',
  async () => {
    setCometManifest({ [WIDGET_KEY]: '/assets/preact-widget-hash.js' })
    try {
      const Comet = defineCometPreact(Widget, WIDGET_SOURCE_URL)

      const noneHtml = await renderPreact(
        createElement(Comet as never, { label: 'bare', comet: 'none' }),
      )
      assertEquals(noneHtml, '<span class="widget">widget:bare</span>')
      assertFalse(noneHtml.includes('data-comet'), noneHtml)

      const onlyHtml = await renderPreact(
        createElement(Comet as never, { label: 'client', comet: 'only' }),
      )
      assert(onlyHtml.includes('data-comet-strategy="only"'), onlyHtml)
      assertFalse(onlyHtml.includes('widget:client'), onlyHtml)
    } finally {
      reset()
    }
  },
)

Deno.test(
  "defineComet (preact): a comet's OWN CSS renders as an inline <link> at its own tree position, " +
    'with no precedence attribute — Preact has no hoisting, so position IS the contract',
  async () => {
    setCssManifest({ global: [], comets: { [WIDGET_KEY]: ['/assets/preact-widget-hash.css'] } })
    try {
      const Comet = defineCometPreact(Widget, WIDGET_SOURCE_URL)
      const html = await renderPreact(createElement(Comet as never, { label: 'css' }))

      assert(html.includes('<link rel="stylesheet" href="/assets/preact-widget-hash.css"'), html)
      assertFalse(html.includes('precedence'), html)
      assertFalse(html.includes('data-precedence'), html)
      // The link sits INSIDE the boundary, before the component's own output — its real position.
      const linkIndex = html.indexOf('/assets/preact-widget-hash.css')
      const contentIndex = html.indexOf('widget:css')
      assert(linkIndex !== -1 && contentIndex !== -1 && linkIndex < contentIndex, html)
    } finally {
      reset()
    }
  },
)

Deno.test(
  'defineComet (preact): a comet with a media-scoped CSS ref renders its media attribute; a comet ' +
    'absent from the manifest renders no stylesheet at all',
  async () => {
    setCssManifest({
      global: [],
      comets: {
        [WIDGET_KEY]: [{ href: '/assets/preact-widget-hash.css', media: '(min-width: 768px)' }],
      },
    })
    try {
      const WidgetComet = defineCometPreact(Widget, WIDGET_SOURCE_URL)
      const withCss = await renderPreact(createElement(WidgetComet as never, { label: 'm' }))
      assert(withCss.includes('media="(min-width: 768px)"'), withCss)

      const CounterComet = defineCometPreact(Counter, COUNTER_SOURCE_URL)
      const noCss = await renderPreact(createElement(CounterComet as never, { start: 1 }))
      assertFalse(noCss.includes('stylesheet'), noCss)
    } finally {
      reset()
    }
  },
)

Deno.test(
  'defineComet (preact): a comet inside a REAL full-document page render (render-page-preact.ts, ' +
    "the path a --renderer=preact app actually takes) lands in the document's body, intact",
  async () => {
    setActiveRenderer('preact')
    setCometManifest({ [WIDGET_KEY]: '/assets/preact-widget-hash.js' })
    setCssManifest({ global: ['/assets/app-hash.css'] })
    try {
      const Comet = defineCometPreact(Widget, WIDGET_SOURCE_URL)
      const PageBody = () =>
        createElement('main', null, createElement(Comet as never, { label: 'page' }))

      // A Preact page names its own renderer's component type as the third type argument — see
      // `SpacePageController`'s own `TComponent` doc. Without it the class is checked against
      // React's `ComponentType`, which no Preact component can satisfy.
      class PageWithComet extends SpacePageController {
        public override component = PageBody
      }
      setPageTree(PageWithComet, {
        filePath: '/fake/routes/preact-comet/page.tsx',
        segments: [],
      })

      const response = await renderPageResponsePreact(
        PageWithComet,
        PageBody,
        mockPageContext(),
        undefined,
        false,
        undefined,
        undefined,
      )
      const html = await response.text()

      assert(html.startsWith('<!doctype html>'), html.slice(0, 120))
      assert(html.includes('data-comet-export="Widget"'), html)
      assert(html.includes('widget:page'), html)
      // The boundary lives in <body>, past the document head — a real page position.
      const headEnd = html.indexOf('</head>')
      assert(headEnd !== -1, html)
      assert(html.indexOf('data-comet=') > headEnd, html)
    } finally {
      reset()
    }
  },
)

Deno.test(
  'defineComet (REACT REGRESSION): the React path renders exactly the markup it always has — the ' +
    'element-factory change must be invisible to the default renderer',
  async () => {
    setCometManifest({ [WIDGET_KEY]: '/assets/preact-widget-hash.js' })
    try {
      assertEquals(
        (await import('modules/router/active-renderer.ts')).getActiveRenderer(),
        'react',
      )
      const Comet = defineComet(ReactWidget, WIDGET_SOURCE_URL)
      const response = await renderToResponseReact(
        createElementReact(Comet as never, { label: 'react', comet: 'visible' }),
      )
      const html = stripHydrationComments(await response.text())

      assert(html.includes(`data-comet="${WIDGET_SOURCE_URL}"`), html)
      assert(html.includes('data-comet-strategy="visible"'), html)
      assert(html.includes('data-comet-module="/assets/preact-widget-hash.js"'), html)
      assert(html.includes('data-comet-export="ReactWidget"'), html)
      assert(html.includes('data-comet-props="{&quot;label&quot;:&quot;react&quot;}"'), html)
      assert(html.includes('style="display:contents"'), html)
      assert(html.includes('<span class="widget">widget:react</span>'), html)
    } finally {
      reset()
    }
  },
)
