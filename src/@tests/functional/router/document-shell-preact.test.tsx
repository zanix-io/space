import { assert, assertEquals, assertFalse, assertStringIncludes } from '@std/assert'
import { createElement } from 'preact'
import type { ComponentChildren } from 'preact'
import { render } from 'preact-render-to-string'
import { applyDocumentShell } from 'modules/router/document-shell-preact.ts'
import { renderToResponse } from 'modules/render/render-to-response-preact.ts'
import { serializeHeadMarkup } from 'modules/render/head-markup.ts'
import type { DocumentModel } from 'modules/render/document-model.ts'

// This file covers the Preact document shell AFTER head placement moved out of it.
//
// The shell used to receive the resolved head as a `headExtras` prop and — when the app declared
// its own root `layout.tsx` — pass that prop on to that layout, depending on it to render the head.
// That made a document's entire metadata conditional on an app-authored component destructuring a
// prop that was not even part of the public `LayoutProps` type, so a root layout written from this
// package's own README served every page with no `<title>`, no canonical and no stylesheet links —
// under Preact only. Placement now happens once, after render, in `render-to-response-preact.ts`
// (see `render/head-markup.ts`). The shell is purely structural, and the tests below assert exactly
// that split: structure here, placement end-to-end.

function Content() {
  return createElement('p', null, 'content')
}

function model(overrides: Partial<DocumentModel> = {}): DocumentModel {
  return {
    head: { title: undefined, meta: [], link: [] },
    cssHrefs: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------------------------
// The default shell — structure only
// ---------------------------------------------------------------------------------------------

Deno.test('DefaultDocumentShell: renders a real html/head/body document', () => {
  const html = render(applyDocumentShell(undefined, createElement(Content, null), {}))

  assertStringIncludes(html, '<html lang="en">')
  assertStringIncludes(html, '<head>')
  assertStringIncludes(html, '<body>')
  assertStringIncludes(html, '<p>content</p>')
})

Deno.test('DefaultDocumentShell: declares the encoding and a zoomable viewport', () => {
  const html = render(applyDocumentShell(undefined, createElement(Content, null), {}))

  // `charset`, lowercase — Preact normalizes the JSX `charSet` property spelling to the real HTML
  // attribute on its own. A difference in how a renderer spells an attribute is exactly the kind of
  // thing the cross-renderer parity suite compares semantically rather than as a string.
  assertStringIncludes(html, 'charset="utf-8"')
  assertStringIncludes(html, 'name="viewport" content="width=device-width, initial-scale=1"')
  // Never zoom-blocking — a viewport declaring `user-scalable=no` or `maximum-scale` below 2 is a
  // real WCAG 1.4.4 (AA) failure under ACT rule b4f0c3, so this framework's own default must not
  // ship one.
  assertFalse(html.includes('user-scalable'), html)
  assertFalse(html.includes('maximum-scale'), html)
})

Deno.test(
  'DefaultDocumentShell: lang is threaded from the document model, defaulting to en',
  () => {
    const html = render(applyDocumentShell(undefined, createElement(Content, null), {}, 'es'))
    assertStringIncludes(html, '<html lang="es">')
  },
)

Deno.test(
  'DefaultDocumentShell: no longer renders head content of its own — placement is the ' +
    "serializer's job now, so the shell must not also emit it and produce duplicates",
  () => {
    const html = render(applyDocumentShell(undefined, createElement(Content, null), {}))
    assertFalse(html.includes('<title>'), html)
    assertFalse(html.includes('rel="stylesheet"'), html)
    assertFalse(html.includes('rel="manifest"'), html)
  },
)

// ---------------------------------------------------------------------------------------------
// A custom root layout — the shape that used to silently lose the whole head
// ---------------------------------------------------------------------------------------------

Deno.test('applyDocumentShell: a custom RootLayout is used as-is, with params forwarded', () => {
  function CustomLayout(
    { children, params }: { children: ComponentChildren; params: Record<string, string> },
  ) {
    return createElement(
      'html',
      { lang: params.lang ?? 'en' },
      createElement('head', null),
      createElement('body', { 'data-testid': 'custom-layout' }, children),
    )
  }

  const html = render(
    applyDocumentShell(CustomLayout, createElement(Content, null), { lang: 'fr' }),
  )

  assertStringIncludes(html, 'data-testid="custom-layout"')
  assertStringIncludes(html, '<html lang="fr">')
})

Deno.test(
  'applyDocumentShell: a custom RootLayout receives NO head-related prop — the contract it has to ' +
    'satisfy for metadata to reach the document is now empty, which is the entire point',
  () => {
    let receivedProps: Record<string, unknown> = {}
    function CustomLayout(props: { children: ComponentChildren }) {
      receivedProps = props as Record<string, unknown>
      return createElement('html', null, createElement('body', null, props.children))
    }

    render(applyDocumentShell(CustomLayout, createElement(Content, null), {}))

    // `data` joined the set post-segment-loaders (`LayoutProps.data`, `typings/page.ts`) — still
    // no head-related prop among them, which remains this test's own point.
    assertEquals(Object.keys(receivedProps).sort(), ['children', 'data', 'params'])
  },
)

// ---------------------------------------------------------------------------------------------
// End to end — the real regression this design closes
// ---------------------------------------------------------------------------------------------

/** A root layout written exactly the way this package's own README and `zanix generate layout`
 * produce one: it owns the document and knows nothing about head management. Under the previous
 * design this shape silently dropped every piece of resolved metadata. */
function UncooperativeRootLayout({ children }: { children: ComponentChildren }) {
  return createElement(
    'html',
    { lang: 'en' },
    createElement('head', null, createElement('meta', { charSet: 'utf-8' })),
    createElement('body', null, children),
  )
}

async function renderDocument(
  RootLayout: Parameters<typeof applyDocumentShell>[0],
  documentModel: DocumentModel,
): Promise<string> {
  const response = renderToResponse(
    applyDocumentShell(RootLayout, createElement(Content, null), {}),
    {
      doctype: true,
      headMarkup: serializeHeadMarkup(documentModel),
      serviceWorkerHref: documentModel.pwa?.serviceWorkerHref,
      nonce: documentModel.nonce,
    },
  )
  return await response.text()
}

Deno.test(
  'END TO END: a custom root layout that cooperates in NO way still receives the full resolved ' +
    'head — title, canonical, hreflang, stylesheets and PWA contribution. This is the exact case ' +
    'that previously produced a document with no metadata at all under Preact while the identical ' +
    'source produced a complete one under React',
  async () => {
    const html = await renderDocument(
      UncooperativeRootLayout,
      model({
        head: {
          title: 'Widget',
          meta: [{ name: 'description', content: 'a widget' }],
          link: [
            { rel: 'canonical', href: 'https://example.com/en/widget' },
            { rel: 'alternate', href: 'https://example.com/en/widget', hreflang: 'en' },
            { rel: 'alternate', href: 'https://example.com/en/widget', hreflang: 'x-default' },
          ],
        },
        cssHrefs: ['/app.css'],
        pwa: { manifestHref: '/manifest.webmanifest', themeColor: '#0af' },
      }),
    )

    assertStringIncludes(html, '<title>Widget</title>')
    assertStringIncludes(html, '<meta name="description" content="a widget">')
    assertStringIncludes(html, '<link rel="canonical" href="https://example.com/en/widget">')
    assertStringIncludes(html, 'hreflang="x-default"')
    assertStringIncludes(html, '<link rel="stylesheet" href="/app.css">')
    assertStringIncludes(html, '<link rel="manifest" href="/manifest.webmanifest">')
    assertStringIncludes(html, '<meta name="theme-color" content="#0af">')
  },
)

Deno.test(
  'END TO END: the head lands INSIDE the real <head> element, not somewhere else in the document',
  async () => {
    const html = await renderDocument(
      UncooperativeRootLayout,
      model({ head: { title: 'Widget', meta: [], link: [] } }),
    )

    const headOpen = html.indexOf('<head>')
    const headClose = html.indexOf('</head>')
    const title = html.indexOf('<title>Widget</title>')
    assert(headOpen !== -1 && headClose !== -1, html)
    assert(title > headOpen && title < headClose, html)
  },
)

Deno.test(
  "END TO END: the framework's resolved title is the document's FIRST <title>, even when the root " +
    'layout renders one of its own — the same coexistence guarantee React gets from hoisting',
  async () => {
    function LayoutWithOwnTitle({ children }: { children: ComponentChildren }) {
      return createElement(
        'html',
        { lang: 'en' },
        createElement('head', null, createElement('title', null, 'LAYOUT TITLE')),
        createElement('body', null, children),
      )
    }

    const html = await renderDocument(
      LayoutWithOwnTitle,
      model({ head: { title: 'SPACE TITLE', meta: [], link: [] } }),
    )

    assert(html.indexOf('SPACE TITLE') < html.indexOf('LAYOUT TITLE'), html)
    // Never suppressed — the author's own tag survives, exactly as documented.
    assertStringIncludes(html, 'LAYOUT TITLE')
  },
)

Deno.test(
  'END TO END: themeStyle renders after the stylesheet links, so it wins equal-specificity :root ' +
    'declarations by document order',
  async () => {
    const html = await renderDocument(
      UncooperativeRootLayout,
      model({
        cssHrefs: ['/app.css'],
        themeStyle: ':root{--space-color-primary:#16a34a}',
        nonce: 'theme-nonce',
      }),
    )

    assertStringIncludes(html, '<style nonce="theme-nonce">:root{--space-color-primary:#16a34a}')
    assert(html.indexOf('/app.css') < html.indexOf('<style nonce='), html)
  },
)

Deno.test('END TO END: omitting themeStyle renders no <style> tag at all', async () => {
  const html = await renderDocument(UncooperativeRootLayout, model({ cssHrefs: ['/app.css'] }))
  assertFalse(html.includes('<style'), html)
})

Deno.test(
  'END TO END: the service-worker registration script lands at the end of <body>, nonced — the ' +
    'shell no longer emits it, so this proves it still reaches the document',
  async () => {
    const html = await renderDocument(
      UncooperativeRootLayout,
      model({
        pwa: { manifestHref: '/manifest.webmanifest', serviceWorkerHref: '/sw.js' },
        nonce: 'sw-nonce',
      }),
    )

    assertStringIncludes(html, 'navigator.serviceWorker.register("/sw.js")')
    assertStringIncludes(html, '<script nonce="sw-nonce">')
    assert(html.indexOf('serviceWorker.register') < html.indexOf('</body>'), html)
  },
)

Deno.test(
  'END TO END: with no PWA configured, neither the manifest link nor the registration script is ' +
    'rendered at all',
  async () => {
    const html = await renderDocument(UncooperativeRootLayout, model())
    assertFalse(html.includes('rel="manifest"'), html)
    assertFalse(html.includes('serviceWorker'), html)
  },
)

Deno.test('END TO END: a full document is prefixed with a doctype', async () => {
  const html = await renderDocument(UncooperativeRootLayout, model())
  assert(html.startsWith('<!doctype html>'), html.slice(0, 60))
})
