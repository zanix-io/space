import { assert, assertEquals, assertFalse } from '@std/assert'
import { createElement } from 'preact'
import { SpacePageController } from 'modules/router/mod.ts'
import { setPageTree } from 'modules/router/page-tree-registry.ts'
import { mockPageContext } from 'modules/testing/mod.ts'
import { setDevClientEnabled } from 'modules/dev/dev-client-registry.ts'
import { setCssManifest } from 'modules/render/css-manifest.ts'
import { setPwaConfig } from 'modules/pwa/mod.ts'
import { renderPageResponse } from 'modules/router/render-page-preact.ts'
import { CSP_SIGNATURE_NONE } from 'modules/router/csp-signature.ts'

console.error = () => {}

// A fake page class, registered directly via `setPageTree` — bypasses `loadRoutes()`/file-based
// discovery entirely, since this file is testing `render-page-preact.ts`'s own composition logic
// in isolation (mirrors how `page-composition.test.tsx` tests the React version through real
// fixture files instead; both approaches reach the same `composeSegments`-shaped code).
class FakePreactPage extends SpacePageController {
  public override component = null
}

/**
 * A root `layout.tsx` written the way an app really writes one: it owns the document and knows
 * nothing whatsoever about head management.
 *
 * Deliberately uncooperative: this layout destructures no head-related prop and renders no head
 * content itself, so the tests below prove the realistic case — a layout that does nothing for
 * metadata still gets a real head — rather than the much weaker claim that a layout which
 * cooperates gets the head. Head placement happens entirely after render
 * (`render/head-markup.ts`), independent of what any layout component itself renders.
 */
function Layout(
  { params, children }: {
    params: unknown
    // deno-lint-ignore no-explicit-any
    children: any
  },
) {
  return createElement(
    'html',
    { lang: 'en' },
    createElement('head', null),
    createElement(
      'body',
      { 'data-testid': 'preact-layout' },
      createElement('span', null, JSON.stringify(params)),
      children,
    ),
  )
}

function Boom(): never {
  throw new Error('preact segment error')
}

function ErrorFallback({ error }: { error: unknown }) {
  return createElement(
    'p',
    { 'data-testid': 'preact-error-fallback' },
    (error as Error).message,
  )
}

Deno.test(
  'render-page-preact composeSegments: error.tsx catches a thrown segment SYNCHRONOUSLY — fallback content renders in the same SSR response (no Suspense/streaming-resume needed, unlike React)',
  async () => {
    setPageTree(FakePreactPage, {
      filePath: '/fake/page.tsx',
      segments: [{ layout: Layout, error: ErrorFallback }],
    })

    const pageCtx = mockPageContext({ params: { id: '42' } })
    const response = await renderPageResponse(
      FakePreactPage,
      Boom,
      pageCtx,
      undefined,
      false,
      undefined,
      undefined,
      CSP_SIGNATURE_NONE,
    )

    // Unlike the React version (`page-composition.test.tsx`'s own equivalent test, which can only
    // assert `200` — the fallback's real content never appears in that SAME response), Preact's
    // synchronous error-boundary recovery means the fallback's actual content IS already in this
    // response — confirmed here, not assumed.
    assertEquals(response.status, 200)
    const html = await response.text()
    assert(html.includes('data-testid="preact-layout"'), html)
    assert(html.includes('data-testid="preact-error-fallback"'), html)
    assert(html.includes('preact segment error'), html)
  },
)

Deno.test(
  // A single segment's own `layout` is index 0 — `applyDocumentShell`'s ROOT layout, trusted to
  // render the document itself (same contract as React's version) — not wrapped by the
  // `i !== 0` loop in `composeSegments`. This test exercises exactly that path for Preact.
  'render-page-preact composeSegments: no error — root layout renders, real params flow through, real component renders',
  async () => {
    function Ok({ label }: { label: string }) {
      return createElement('p', { 'data-testid': 'ok' }, label)
    }

    setPageTree(FakePreactPage, {
      filePath: '/fake/page2.tsx',
      segments: [{ layout: Layout }],
    })

    const pageCtx = mockPageContext({ params: { id: 'abc' } })
    const response = await renderPageResponse(
      FakePreactPage,
      Ok,
      pageCtx,
      { label: 'hi' },
      false,
      undefined,
      undefined,
      CSP_SIGNATURE_NONE,
    )

    assertEquals(response.status, 200)
    const html = await response.text()
    assert(html.includes('data-testid="preact-layout"'), html)
    // Rendered as Preact's own HTML text-node output, real entity-escaping and all — not the raw
    // JSON string (`JSON.stringify` produced `"` characters; Preact serializes them as `&quot;`
    // inside a text node, same as any other HTML SSR renderer would).
    assert(html.includes('&quot;id&quot;:&quot;abc&quot;'), html)
    assert(html.includes('data-testid="ok"'), html)
    assert(html.includes('>hi<'), html)
  },
)

Deno.test(
  'render-page-preact composeSegments: the DEFAULT document shell (no custom root layout) DOES ' +
    'inject cssHrefs — baseline behavior, unchanged by the custom-root-layout fix below',
  async () => {
    function Ok() {
      return createElement('p', null, 'ok')
    }
    setPageTree(FakePreactPage, {
      filePath: '/fake/css-default-shell.tsx',
      segments: [],
    })
    setCssManifest({ global: ['/app.css'] })
    try {
      const pageCtx = mockPageContext()
      const response = await renderPageResponse(
        FakePreactPage,
        Ok,
        pageCtx,
        undefined,
        false,
        undefined,
        undefined,
        CSP_SIGNATURE_NONE,
      )
      const html = await response.text()

      assert(html.includes('href="/app.css"'), html)
    } finally {
      setCssManifest(undefined)
    }
  },
)

Deno.test(
  'render-page-preact composeSegments: a {href, media} cssHrefs entry renders its media ' +
    'attribute; a plain string entry renders none at all — same parity React already has (P2-12a)',
  async () => {
    function Ok() {
      return createElement('p', null, 'ok')
    }
    setPageTree(FakePreactPage, {
      filePath: '/fake/css-media-default-shell.tsx',
      segments: [],
    })
    setCssManifest({
      global: [
        { href: '/mobile.css', media: '(max-width: 599px)' },
        '/app.css',
      ],
    })
    try {
      const pageCtx = mockPageContext()
      const response = await renderPageResponse(
        FakePreactPage,
        Ok,
        pageCtx,
        undefined,
        false,
        undefined,
        undefined,
        CSP_SIGNATURE_NONE,
      )
      const html = await response.text()

      assert(
        html.includes('href="/mobile.css" media="(max-width: 599px)"'),
        html,
      )
      const appLinkMatch = html.match(/<link[^>]*href="\/app\.css"[^>]*>/)
      assert(appLinkMatch, html)
      assert(!appLinkMatch[0].includes('media='), appLinkMatch[0])
    } finally {
      setCssManifest(undefined)
    }
  },
)

Deno.test(
  'render-page-preact composeSegments: a custom root layout.tsx that cooperates in NO way still ' +
    'gets the stylesheet links into its own <head> — placement happens after render, so there is ' +
    'no prop for a layout to forget to render',
  async () => {
    function Ok() {
      return createElement('p', null, 'ok')
    }
    setPageTree(FakePreactPage, {
      filePath: '/fake/css-custom-layout.tsx',
      segments: [{ layout: Layout }],
    })
    setCssManifest({ global: ['/app.css'] })
    try {
      const pageCtx = mockPageContext()
      const response = await renderPageResponse(
        FakePreactPage,
        Ok,
        pageCtx,
        undefined,
        false,
        undefined,
        undefined,
        CSP_SIGNATURE_NONE,
      )
      const html = await response.text()

      assert(html.includes('data-testid="preact-layout"'), html)
      assert(html.includes('<link rel="stylesheet" href="/app.css">'), html)
      // Inside the real <head>, not merely somewhere in the document.
      const headOpen = html.indexOf('<head>')
      const headClose = html.indexOf('</head>')
      const cssIndex = html.indexOf('href="/app.css"')
      assert(cssIndex > headOpen && cssIndex < headClose, html)
    } finally {
      setCssManifest(undefined)
    }
  },
)

Deno.test(
  'render-page-preact composeSegments: the PWA contribution reaches an uncooperative custom root ' +
    'layout too, same mechanism as the stylesheet links above',
  async () => {
    function Ok() {
      return createElement('p', null, 'ok')
    }
    setPageTree(FakePreactPage, {
      filePath: '/fake/pwa-custom-layout.tsx',
      segments: [{ layout: Layout }],
    })
    setPwaConfig({ name: 'Fixture App', icon: '/icon.png' })
    try {
      const pageCtx = mockPageContext()
      const response = await renderPageResponse(
        FakePreactPage,
        Ok,
        pageCtx,
        undefined,
        false,
        undefined,
        undefined,
        CSP_SIGNATURE_NONE,
      )
      const html = await response.text()

      assert(html.includes('data-testid="preact-layout"'), html)
      assert(html.includes('<link rel="manifest" href="/manifest.webmanifest">'), html)
    } finally {
      setPwaConfig(undefined)
    }
  },
)

Deno.test(
  'render-page-preact composeSegments: fragmentOnly skips the document shell entirely (no <html>)',
  async () => {
    function Ok() {
      return createElement('p', null, 'fragment')
    }
    setPageTree(FakePreactPage, { filePath: '/fake/page3.tsx', segments: [] })

    const pageCtx = mockPageContext()
    const response = await renderPageResponse(
      FakePreactPage,
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
    assert(html.includes('data-space-outlet'), html)
    assert(html.includes('fragment'), html)
  },
)

Deno.test(
  "render-page-preact renderPageResponse: isDevClientEnabled() wires devClient with this page's own filePath",
  async () => {
    function Ok() {
      return createElement('p', null, 'ok')
    }
    setPageTree(FakePreactPage, {
      filePath: '/fake/dev-client-page.tsx',
      segments: [],
    })

    setDevClientEnabled(true)
    try {
      const pageCtx = mockPageContext()
      const response = await renderPageResponse(
        FakePreactPage,
        Ok,
        pageCtx,
        undefined,
        false,
        undefined,
        undefined,
        CSP_SIGNATURE_NONE,
      )
      const html = await response.text()

      assert(html.includes('/socket/'), html)
      assert(html.includes(JSON.stringify('/fake/dev-client-page.tsx')), html)
    } finally {
      setDevClientEnabled(false)
    }
  },
)

Deno.test(
  'render-page-preact renderPageResponse: no dev client script when isDevClientEnabled() is false, unchanged production behavior',
  async () => {
    function Ok() {
      return createElement('p', null, 'ok')
    }
    setPageTree(FakePreactPage, {
      filePath: '/fake/no-dev-client-page.tsx',
      segments: [],
    })

    const pageCtx = mockPageContext()
    const response = await renderPageResponse(
      FakePreactPage,
      Ok,
      pageCtx,
      undefined,
      false,
      undefined,
      undefined,
      CSP_SIGNATURE_NONE,
    )
    const html = await response.text()

    assertFalse(html.includes('<script'), html)
  },
)

// === Head management (title/meta/link) — first iteration, see head-descriptor.ts's own doc ===

class HeadOnlyPreactPage extends SpacePageController {
  public override component = null
  public static override head = {
    title: 'Page Only Title',
    meta: [{ name: 'description', content: 'page only description' }],
  }
}

class HeadFunctionPreactPage extends SpacePageController {
  public override component = null
  public static override head = (data: unknown) => ({
    title: (data as { name: string }).name,
  })
}

class HeadMergePreactPage extends SpacePageController {
  public override component = null
  public static override head = {
    title: 'Page Title',
    meta: [{ name: 'description', content: 'page description' }],
  }
}

class HeadNoOwnTitlePreactPage extends SpacePageController {
  public override component = null
  public static override head = { meta: [{ property: 'og:type', content: 'article' }] }
}

Deno.test('render-page-preact head: only a page head — no layout declares one', async () => {
  function Ok() {
    return createElement('p', null, 'ok')
  }
  setPageTree(HeadOnlyPreactPage, { filePath: '/fake/head-only.tsx', segments: [] })

  const pageCtx = mockPageContext()
  const response = await renderPageResponse(
    HeadOnlyPreactPage,
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
  "render-page-preact head: a page's head() function receives loader's own resolved data",
  async () => {
    function Ok() {
      return createElement('p', null, 'ok')
    }
    setPageTree(HeadFunctionPreactPage, { filePath: '/fake/head-fn.tsx', segments: [] })

    const pageCtx = mockPageContext()
    const response = await renderPageResponse(
      HeadFunctionPreactPage,
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
  'render-page-preact head: root layout + nested layout + page — all merge, most specific wins',
  async () => {
    function Ok() {
      return createElement('p', null, 'ok')
    }
    // segments[0] = root, segments[1] = nearest/leaf — same storage order load-routes.ts uses.
    setPageTree(HeadMergePreactPage, {
      filePath: '/fake/head-merge.tsx',
      segments: [
        { head: { title: 'Root Title', meta: [{ name: 'author', content: 'Acme' }] } },
        { head: { title: 'Nested Title', meta: [{ property: 'og:type', content: 'website' }] } },
      ],
    })

    const pageCtx = mockPageContext()
    const response = await renderPageResponse(
      HeadMergePreactPage,
      Ok,
      pageCtx,
      undefined,
      false,
      undefined,
      undefined,
      CSP_SIGNATURE_NONE,
    )
    const html = await response.text()

    // Precedence: the PAGE's own title wins over both layouts.
    assert(html.includes('<title>Page Title</title>'), html)
    assertFalse(html.includes('Root Title'), html)
    assertFalse(html.includes('Nested Title'), html)
    // Meta from every level survives (different keys) — all merged, none dropped.
    assert(html.includes('name="description" content="page description"'), html)
    assert(html.includes('property="og:type" content="website"'), html)
    assert(html.includes('name="author" content="Acme"'), html)
  },
)

Deno.test(
  'render-page-preact head: a page with no own title falls through to its nearest layout, then root',
  async () => {
    function Ok() {
      return createElement('p', null, 'ok')
    }
    setPageTree(HeadNoOwnTitlePreactPage, {
      filePath: '/fake/head-fallthrough.tsx',
      segments: [{ head: { title: 'Root Title' } }],
    })

    const pageCtx = mockPageContext()
    const response = await renderPageResponse(
      HeadNoOwnTitlePreactPage,
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
  'render-page-preact head: meta dedup — same name declared at page AND layout, only the more ' +
    'specific one survives, never a literal duplicate',
  async () => {
    function Ok() {
      return createElement('p', null, 'ok')
    }
    setPageTree(HeadMergePreactPage, {
      filePath: '/fake/head-dedup.tsx',
      segments: [{ head: { meta: [{ name: 'description', content: 'layout description' }] } }],
    })

    const pageCtx = mockPageContext()
    const response = await renderPageResponse(
      HeadMergePreactPage,
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
  'render-page-preact head: a manually-authored <title> inside page content never reaches ' +
    "<head> at all — Preact has no hoisting (confirmed absent in this package's own decision " +
    "spike) — so Space's resolved head is unaffected by it and remains the document's only real " +
    '<title> element',
  async () => {
    function PageWithManualTitle() {
      return createElement(
        'div',
        null,
        createElement('title', { 'data-testid': 'manual-title' }, 'MANUAL PAGE TITLE'),
        'page body content',
      )
    }
    setPageTree(HeadOnlyPreactPage, { filePath: '/fake/head-coexist.tsx', segments: [] })

    const pageCtx = mockPageContext()
    const response = await renderPageResponse(
      HeadOnlyPreactPage,
      PageWithManualTitle,
      pageCtx,
      undefined,
      false,
      undefined,
      undefined,
      CSP_SIGNATURE_NONE,
    )
    const html = await response.text()

    const headSlice = html.slice(0, html.indexOf('</head>'))
    // Space's own resolved title is the one (and only one) inside <head>.
    assert(headSlice.includes('<title>Page Only Title</title>'), headSlice)
    assertFalse(headSlice.includes('MANUAL PAGE TITLE'), headSlice)
    // The manually-authored tag still rendered — literally, inertly, inside <body> — proving
    // this package never detects/suppresses it, only that it has no effect on the real <head>.
    assert(html.includes('data-testid="manual-title"'), html)
    assert(html.includes('MANUAL PAGE TITLE'), html)
  },
)

Deno.test(
  'render-page-preact head: the resolved title/meta reach an uncooperative custom root layout — ' +
    'the single most important cross-renderer guarantee, since React gets this for free from ' +
    'hoisting and Preact previously did not get it at all',
  async () => {
    function Ok() {
      return createElement('p', null, 'ok')
    }
    setPageTree(HeadOnlyPreactPage, {
      filePath: '/fake/head-custom-layout.tsx',
      segments: [{ layout: Layout }],
    })

    const pageCtx = mockPageContext()
    const response = await renderPageResponse(
      HeadOnlyPreactPage,
      Ok,
      pageCtx,
      undefined,
      false,
      undefined,
      undefined,
      CSP_SIGNATURE_NONE,
    )
    const html = await response.text()

    assert(html.includes('data-testid="preact-layout"'), html)
    assert(html.includes('<title>Page Only Title</title>'), html)
    assert(html.includes('name="description"'), html)
  },
)

Deno.test(
  'render-page-preact head: cssHrefs/pwaHead render unaffected alongside the new title/meta fields',
  async () => {
    function Ok() {
      return createElement('p', null, 'ok')
    }
    setPageTree(HeadOnlyPreactPage, { filePath: '/fake/head-with-css-pwa.tsx', segments: [] })
    setCssManifest({ global: ['/app.css'] })
    setPwaConfig({ name: 'Fixture App', icon: '/icon.png' })
    try {
      const pageCtx = mockPageContext()
      const response = await renderPageResponse(
        HeadOnlyPreactPage,
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
  'render-page-preact head: Orbit fragment — the resolved title appears as literal text, ' +
    "findable by orbit.ts's own extractFragmentTitle regex, even though the fragment skips the " +
    'whole document shell',
  async () => {
    function Ok() {
      return createElement('p', null, 'fragment content')
    }
    setPageTree(HeadOnlyPreactPage, { filePath: '/fake/head-fragment.tsx', segments: [] })

    const pageCtx = mockPageContext()
    const response = await renderPageResponse(
      HeadOnlyPreactPage,
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
