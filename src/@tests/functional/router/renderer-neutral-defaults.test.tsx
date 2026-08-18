import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { createElement as preactElement } from 'preact'
import type { VNode } from 'preact'
import { SpacePageController } from 'modules/router/mod.ts'
import type { LayoutProps } from 'typings/page.ts'
import { setPageTree } from 'modules/router/page-tree-registry.ts'
import { mockPageContext } from 'modules/testing/mod.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { renderPageResponse as renderReact } from 'modules/router/render-page-react.tsx'
import { renderPageResponse as renderPreact } from 'modules/router/render-page-preact.ts'
import { extractDocumentSemantics } from 'modules/render/document-semantics.ts'

/**
 * The two renderer-neutral defaults, exercised end to end through the REAL page renderers.
 *
 * `LayoutProps` used to default `children` to React's `ReactNode`, and `SpacePageController` used
 * to default `TComponent` to React's `ComponentType<any>`. Both now default to the neutral shapes
 * in `typings/renderable.ts`, and the claim this file has to keep honest is not "the type compiles"
 * — `renderable-types.test.ts` owns that — but that a page and a layout written with NO type
 * argument and NO cast actually render, identically in structure, under BOTH renderers.
 *
 * Everything below is deliberately written the way a real app writes it: `class HomePage extends
 * SpacePageController<Params>`, `function RootLayout({ children }: LayoutProps)`. Under the old
 * defaults, the Preact half of this file could not have been written at all — its page class would
 * have been rejected for declaring a Preact component, and its layout would have had to name
 * `LayoutProps<ComponentChildren>` explicitly.
 *
 * @module
 */

console.error = () => {}

type Params = { id: string }

// ------------------------------------------------------------------------------------------------
// React half — the bare defaults, JSX, no type argument anywhere.
// ------------------------------------------------------------------------------------------------

function ReactRootLayout({ children, params }: LayoutProps) {
  return (
    <html lang='en'>
      <head></head>
      <body data-params={JSON.stringify(params)}>{children}</body>
    </html>
  )
}

function ReactView({ id }: { id: string }) {
  return <h1 data-testid='view'>{id}</h1>
}

class ReactHomePage extends SpacePageController<Params> {
  public override component = ReactView
}

// ------------------------------------------------------------------------------------------------
// Preact half — the SAME bare defaults, no type argument anywhere.
// ------------------------------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
function PreactRootLayout({ children, params }: LayoutProps): VNode<any> {
  return preactElement(
    'html',
    { lang: 'en' },
    preactElement('head', null),
    preactElement('body', { 'data-params': JSON.stringify(params) }, children),
  )
}

// `VNode<any>` — the same structural contravariance `document-shell-preact.ts` documents; nothing
// to do with the neutral defaults under test here.
// deno-lint-ignore no-explicit-any
function PreactView({ id }: { id: string }): VNode<any> {
  return preactElement('h1', { 'data-testid': 'view' }, id)
}

class PreactHomePage extends SpacePageController<Params> {
  public override component = PreactView
}

Deno.test(
  'renderer-neutral defaults [react]: a page declared as SpacePageController<Params> with a bare ' +
    'LayoutProps layout renders a real document',
  async () => {
    setActiveRenderer('react')
    setPageTree(ReactHomePage, {
      filePath: '/routes/page.tsx',
      segments: [{ layout: ReactRootLayout }],
    })

    const response = await renderReact(
      ReactHomePage,
      // The view itself: `component` is a class FIELD (per `SpacePageController`'s own contract),
      // so it exists on instances, not on the prototype. The class declaration above is what
      // asserts the type — it would not compile if `TComponent` rejected this component.
      ReactView,
      mockPageContext<Params>({ params: { id: 'react-1' } }),
      { id: 'react-1' },
      false,
      undefined,
      undefined,
    )
    const html = await response.text()

    assertEquals(response.status, 200)
    assertStringIncludes(html, 'data-testid="view"')
    assertStringIncludes(html, 'react-1')
    // The layout really ran — `params` reached it through the neutral props type.
    assertStringIncludes(html, '{&quot;id&quot;:&quot;react-1&quot;}')
  },
)

Deno.test(
  'renderer-neutral defaults [preact]: the SAME declarations — bare SpacePageController<Params>, ' +
    'bare LayoutProps — render a real document under Preact, with no cast and no type argument',
  async () => {
    setActiveRenderer('preact')
    try {
      setPageTree(PreactHomePage, {
        filePath: '/routes/page.tsx',
        segments: [{ layout: PreactRootLayout }],
      })

      const response = await renderPreact(
        PreactHomePage,
        // Same as the React case above — the class declaration is the type assertion.
        PreactView,
        mockPageContext<Params>({ params: { id: 'preact-1' } }),
        { id: 'preact-1' },
        false,
        undefined,
        undefined,
      )
      const html = await response.text()

      assertEquals(response.status, 200)
      assertStringIncludes(html, 'data-testid="view"')
      assertStringIncludes(html, 'preact-1')
      assertStringIncludes(html, '{&quot;id&quot;:&quot;preact-1&quot;}')
    } finally {
      setActiveRenderer('react')
    }
  },
)

Deno.test(
  'renderer-neutral defaults: both documents carry the same SEMANTICS — the neutral defaults did ' +
    'not quietly change what either renderer produces',
  async () => {
    setActiveRenderer('react')
    setPageTree(ReactHomePage, {
      filePath: '/routes/page.tsx',
      segments: [{ layout: ReactRootLayout }],
    })
    const reactHtml = await (await renderReact(
      ReactHomePage,
      ReactView,
      mockPageContext<Params>({ params: { id: 'x' } }),
      { id: 'x' },
      false,
      undefined,
      undefined,
    )).text()

    setActiveRenderer('preact')
    let preactHtml: string
    try {
      setPageTree(PreactHomePage, {
        filePath: '/routes/page.tsx',
        segments: [{ layout: PreactRootLayout }],
      })
      preactHtml = await (await renderPreact(
        PreactHomePage,
        PreactView,
        mockPageContext<Params>({ params: { id: 'x' } }),
        { id: 'x' },
        false,
        undefined,
        undefined,
      )).text()
    } finally {
      setActiveRenderer('react')
    }

    const reactDoc = extractDocumentSemantics(reactHtml)
    const preactDoc = extractDocumentSemantics(preactHtml)

    // Compared as document semantics, never as HTML strings — the two serializers legitimately
    // differ on attribute order and whitespace (see `document-model.ts`'s own contract).
    assertEquals(preactDoc.isDocument, reactDoc.isDocument)
    assertEquals(preactDoc.lang, reactDoc.lang)
    assertEquals(preactDoc.h1Count, reactDoc.h1Count)
    assertEquals(preactDoc.hasTextContent, reactDoc.hasTextContent)
    assert(reactDoc.isDocument, reactHtml)
    assertEquals(reactDoc.h1Count, 1)
  },
)
