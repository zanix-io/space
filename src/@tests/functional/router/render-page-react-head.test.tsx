import { assert, assertEquals, assertFalse } from '@std/assert'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { SpacePageController } from 'modules/router/mod.ts'
import { setPageTree } from 'modules/router/page-tree-registry.ts'
import { mockPageContext } from 'modules/testing/mod.ts'
import { setCssManifest } from 'modules/render/css-manifest.ts'
import { setPwaConfig } from 'modules/pwa/mod.ts'
import { renderPageResponse } from 'modules/router/render-page-react.tsx'
import { CSP_SIGNATURE_NONE } from 'modules/router/csp-signature.ts'

console.error = () => {}

// Same fake-class-via-setPageTree style `render-page-preact.test.tsx` already establishes for its
// own head-management tests — this file exists specifically to mirror those, scenario by scenario,
// as the real proof of "React y Preact con el mismo descriptor" (see this file's own parity tests
// below): the SAME HeadDescriptor input, run through each renderer's own real composeSegments/
// renderPageResponse, produces the same OBSERVABLE result (title/meta present, precedence honored).
class FakeReactPage extends SpacePageController {
  public override component = null
}

class HeadOnlyReactPage extends SpacePageController {
  public override component = null
  public static override head = {
    title: 'Page Only Title',
    meta: [{ name: 'description', content: 'page only description' }],
  }
}

class HeadFunctionReactPage extends SpacePageController {
  public override component = null
  public static override head = (data: unknown) => ({
    title: (data as { name: string }).name,
  })
}

class HeadMergeReactPage extends SpacePageController {
  public override component = null
  public static override head = {
    title: 'Page Title',
    meta: [{ name: 'description', content: 'page description' }],
  }
}

class HeadNoOwnTitleReactPage extends SpacePageController {
  public override component = null
  public static override head = { meta: [{ property: 'og:type', content: 'article' }] }
}

// A custom root layout that renders its OWN real `<html>/<head>/<body>` — deliberately does NOT
// receive or forward any head-related prop of its own (unlike Preact's `document-shell-preact.ts`
// fix): React's own hoisting is what delivers Space's resolved `<title>`/`<meta>` here, regardless
// of what this layout itself does — the whole point of this file's own "custom layout" test below.
function CustomRootLayout({ children }: { children: ReactNode }) {
  return createElement(
    'html',
    null,
    createElement('head', null, createElement('meta', { charSet: 'utf-8' })),
    createElement('body', { 'data-testid': 'react-custom-layout' }, children),
  )
}

Deno.test('render-page-react head: only a page head — no layout declares one', async () => {
  function Ok() {
    return createElement('p', null, 'ok')
  }
  setPageTree(HeadOnlyReactPage, { filePath: '/fake/head-only.tsx', segments: [] })

  const pageCtx = mockPageContext()
  const response = await renderPageResponse(
    HeadOnlyReactPage,
    Ok,
    pageCtx,
    undefined,
    false,
    undefined,
    undefined,
    CSP_SIGNATURE_NONE,
  )
  const html = await response.text()

  assert(html.includes('<title>Page Only Title</title>'), html)
  assert(html.includes('name="description" content="page only description"'), html)
})

Deno.test(
  "render-page-react head: a page's head() function receives loader's own resolved data",
  async () => {
    function Ok() {
      return createElement('p', null, 'ok')
    }
    setPageTree(HeadFunctionReactPage, { filePath: '/fake/head-fn.tsx', segments: [] })

    const pageCtx = mockPageContext()
    const response = await renderPageResponse(
      HeadFunctionReactPage,
      Ok,
      pageCtx,
      { name: 'Widget' },
      false,
      undefined,
      undefined,
      CSP_SIGNATURE_NONE,
    )
    const html = await response.text()

    assert(html.includes('<title>Widget</title>'), html)
  },
)

Deno.test(
  'render-page-react head: root layout + nested layout + page — all merge, most specific wins',
  async () => {
    function Ok() {
      return createElement('p', null, 'ok')
    }
    setPageTree(HeadMergeReactPage, {
      filePath: '/fake/head-merge.tsx',
      segments: [
        { head: { title: 'Root Title', meta: [{ name: 'author', content: 'Acme' }] } },
        { head: { title: 'Nested Title', meta: [{ property: 'og:type', content: 'website' }] } },
      ],
    })

    const pageCtx = mockPageContext()
    const response = await renderPageResponse(
      HeadMergeReactPage,
      Ok,
      pageCtx,
      undefined,
      false,
      undefined,
      undefined,
      CSP_SIGNATURE_NONE,
    )
    const html = await response.text()

    assert(html.includes('<title>Page Title</title>'), html)
    assertFalse(html.includes('Root Title'), html)
    assertFalse(html.includes('Nested Title'), html)
    assert(html.includes('name="description" content="page description"'), html)
    assert(html.includes('property="og:type" content="website"'), html)
    assert(html.includes('name="author" content="Acme"'), html)
  },
)

Deno.test(
  'render-page-react head: a page with no own title falls through to its nearest layout, then root',
  async () => {
    function Ok() {
      return createElement('p', null, 'ok')
    }
    setPageTree(HeadNoOwnTitleReactPage, {
      filePath: '/fake/head-fallthrough.tsx',
      segments: [{ head: { title: 'Root Title' } }],
    })

    const pageCtx = mockPageContext()
    const response = await renderPageResponse(
      HeadNoOwnTitleReactPage,
      Ok,
      pageCtx,
      undefined,
      false,
      undefined,
      undefined,
      CSP_SIGNATURE_NONE,
    )
    const html = await response.text()

    assert(html.includes('<title>Root Title</title>'), html)
    assert(html.includes('property="og:type" content="article"'), html)
  },
)

Deno.test(
  'render-page-react head: meta dedup — same name declared at page AND layout, only the more ' +
    'specific one survives, never a literal duplicate',
  async () => {
    function Ok() {
      return createElement('p', null, 'ok')
    }
    setPageTree(HeadMergeReactPage, {
      filePath: '/fake/head-dedup.tsx',
      segments: [{ head: { meta: [{ name: 'description', content: 'layout description' }] } }],
    })

    const pageCtx = mockPageContext()
    const response = await renderPageResponse(
      HeadMergeReactPage,
      Ok,
      pageCtx,
      undefined,
      false,
      undefined,
      undefined,
      CSP_SIGNATURE_NONE,
    )
    const html = await response.text()

    const descriptionOccurrences = html.match(/name="description"/g) ?? []
    assertEquals(descriptionOccurrences.length, 1, html)
    assert(html.includes('page description'), html)
    assertFalse(html.includes('layout description'), html)
  },
)

Deno.test(
  'render-page-react head: COEXISTENCE — a manually-authored JSX <title> inside page content is ' +
    "NEVER suppressed (React's own native hoisting stays fully intact, never disabled), but " +
    "Space's resolved head — rendered before page content in this package's own tree, confirmed " +
    'empirically to be the encounter-order React flushes into <head> — deterministically wins ' +
    "document.title (the HTML Living Standard's own first-title-in-document rule), without this " +
    'package ever detecting or removing the author-rendered tag',
  async () => {
    function PageWithManualTitle() {
      return createElement(
        'div',
        null,
        createElement('title', { 'data-testid': 'manual-title' }, 'MANUAL PAGE TITLE'),
        createElement(
          'meta',
          { name: 'description', content: 'manual page description', 'data-testid': 'manual-meta' },
        ),
        'page body content',
      )
    }
    setPageTree(HeadOnlyReactPage, { filePath: '/fake/head-coexist.tsx', segments: [] })

    const pageCtx = mockPageContext()
    const response = await renderPageResponse(
      HeadOnlyReactPage,
      PageWithManualTitle,
      pageCtx,
      undefined,
      false,
      undefined,
      undefined,
      CSP_SIGNATURE_NONE,
    )
    const html = await response.text()

    // Both really exist in the output — React's hoisting was never touched or suppressed. Matches
    // a `<title ...>` with or without attributes — the manually-authored one below carries its own
    // `data-testid`, unlike Space's own bare `<title>`.
    const titleOccurrences = [...html.matchAll(/<title[^>]*>([^<]*)<\/title>/g)].map((m) => m[1])
    assertEquals(titleOccurrences, ['Page Only Title', 'MANUAL PAGE TITLE'])

    // The FIRST <title> in the whole document (i.e. document.title per the HTML spec) is Space's
    // own resolved one — deterministic, not incidental.
    const firstTitleIndex = html.indexOf('<title>')
    const manualTitleIndex = html.indexOf('MANUAL PAGE TITLE')
    assert(firstTitleIndex > -1 && firstTitleIndex < manualTitleIndex, html)

    // Both hoisted into the SAME real <head>...</head> — confirms React's own hoisting is doing
    // this, not some Space-specific placement trick.
    const headSlice = html.slice(0, html.indexOf('</head>'))
    assert(headSlice.includes('Page Only Title'), headSlice)
    assert(headSlice.includes('MANUAL PAGE TITLE'), headSlice)

    // The author's own tag is still real, present, findable in the DOM — never removed.
    assert(html.includes('data-testid="manual-title"'), html)
    assert(html.includes('data-testid="manual-meta"'), html)
  },
)

Deno.test(
  "render-page-react head: a custom root layout.tsx receives Space's resolved title/meta with " +
    "ZERO cooperation needed — React's own hoisting delivers them into <head> regardless of what " +
    'the custom layout itself renders (unlike Preact, which needs the explicit headExtras prop ' +
    "threading fixed separately — see document-shell-preact.ts's own doc)",
  async () => {
    function Ok() {
      return createElement('p', null, 'ok')
    }
    setPageTree(HeadOnlyReactPage, {
      filePath: '/fake/head-custom-layout.tsx',
      segments: [{ layout: CustomRootLayout }],
    })

    const pageCtx = mockPageContext()
    const response = await renderPageResponse(
      HeadOnlyReactPage,
      Ok,
      pageCtx,
      undefined,
      false,
      undefined,
      undefined,
      CSP_SIGNATURE_NONE,
    )
    const html = await response.text()

    assert(html.includes('data-testid="react-custom-layout"'), html)
    const headSlice = html.slice(0, html.indexOf('</head>'))
    assert(headSlice.includes('<title>Page Only Title</title>'), headSlice)
    assert(headSlice.includes('name="description" content="page only description"'), headSlice)
  },
)

Deno.test(
  'render-page-react head: cssHrefs/pwaHead render unaffected alongside the new title/meta fields',
  async () => {
    function Ok() {
      return createElement('p', null, 'ok')
    }
    setPageTree(HeadOnlyReactPage, { filePath: '/fake/head-with-css-pwa.tsx', segments: [] })
    setCssManifest({ global: ['/app.css'] })
    setPwaConfig({ name: 'Fixture App', icon: '/icon.png' })
    try {
      const pageCtx = mockPageContext()
      const response = await renderPageResponse(
        HeadOnlyReactPage,
        Ok,
        pageCtx,
        undefined,
        false,
        undefined,
        undefined,
        CSP_SIGNATURE_NONE,
      )
      const html = await response.text()

      assert(html.includes('<title>Page Only Title</title>'), html)
      assert(html.includes('href="/app.css"'), html)
      assert(html.includes('href="/manifest.webmanifest"'), html)
    } finally {
      setCssManifest(undefined)
      setPwaConfig(undefined)
    }
  },
)

Deno.test(
  'render-page-react head: Orbit fragment — the resolved title appears as literal text, ' +
    "findable by orbit.ts's own extractFragmentTitle regex, even with NO <head>/<html> anywhere " +
    'in the fragment (confirmed empirically that React still hoists/flushes it in this case)',
  async () => {
    function Ok() {
      return createElement('p', null, 'fragment content')
    }
    setPageTree(HeadOnlyReactPage, { filePath: '/fake/head-fragment.tsx', segments: [] })

    const pageCtx = mockPageContext()
    const response = await renderPageResponse(
      HeadOnlyReactPage,
      Ok,
      pageCtx,
      undefined,
      true,
      undefined,
      undefined,
      CSP_SIGNATURE_NONE,
    )
    const html = await response.text()

    assertFalse(html.includes('<html'), html)
    assert(html.includes('<title>Page Only Title</title>'), html)
    assert(html.includes('fragment content'), html)
  },
)

Deno.test('render-page-react head: a page with no head at all renders no <title> tag', async () => {
  function Ok() {
    return createElement('p', null, 'ok')
  }
  setPageTree(FakeReactPage, { filePath: '/fake/no-head.tsx', segments: [] })

  const pageCtx = mockPageContext()
  const response = await renderPageResponse(
    FakeReactPage,
    Ok,
    pageCtx,
    undefined,
    false,
    undefined,
    undefined,
    CSP_SIGNATURE_NONE,
  )
  const html = await response.text()

  assertFalse(html.includes('<title>'), html)
})
