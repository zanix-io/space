import { assert, assertEquals, assertFalse } from '@std/assert'
import {
  extractFragmentTitle,
  extractStylesheetLinks,
  shouldInterceptNavigation,
} from 'modules/client/orbit.ts'

function baseInput() {
  return {
    href: '/products',
    target: null,
    hasOptOut: false,
    hasModifierKey: false,
    isSameOrigin: true,
    isSameDocumentHashLink: false,
  }
}

Deno.test('shouldInterceptNavigation: intercepts a plain, same-origin internal link', () => {
  assert(shouldInterceptNavigation(baseInput()))
})

Deno.test('shouldInterceptNavigation: never intercepts a link with no href', () => {
  assertFalse(shouldInterceptNavigation({ ...baseInput(), href: null }))
})

Deno.test('shouldInterceptNavigation: respects the data-orbit-hard escape hatch', () => {
  assertFalse(shouldInterceptNavigation({ ...baseInput(), hasOptOut: true }))
})

Deno.test('shouldInterceptNavigation: never intercepts a modified click', () => {
  assertFalse(
    shouldInterceptNavigation({ ...baseInput(), hasModifierKey: true }),
  )
})

Deno.test('shouldInterceptNavigation: never intercepts a cross-origin link', () => {
  assertFalse(
    shouldInterceptNavigation({ ...baseInput(), isSameOrigin: false }),
  )
})

Deno.test('shouldInterceptNavigation: never intercepts target="_blank"', () => {
  assertFalse(shouldInterceptNavigation({ ...baseInput(), target: '_blank' }))
})

Deno.test('shouldInterceptNavigation: target="_self" is the same as no target at all', () => {
  assert(shouldInterceptNavigation({ ...baseInput(), target: '_self' }))
})

Deno.test('shouldInterceptNavigation: never intercepts a same-document hash-only link', () => {
  assertFalse(
    shouldInterceptNavigation({ ...baseInput(), isSameDocumentHashLink: true }),
  )
})

Deno.test(
  'shouldInterceptNavigation: a hash link to a different document is still intercepted',
  () => {
    assert(
      shouldInterceptNavigation({
        ...baseInput(),
        href: '/other-page#section',
        isSameDocumentHashLink: false,
      }),
    )
  },
)

Deno.test('extractFragmentTitle: pulls the title out and strips it from the body', () => {
  const html = '<title>Product — Store</title><h1>Product</h1>'
  const { title, body } = extractFragmentTitle(html)

  assertEquals(title, 'Product — Store')
  assertEquals(body, '<h1>Product</h1>')
})

Deno.test('extractFragmentTitle: undefined title when the fragment has none', () => {
  const html = '<h1>Product</h1>'
  const { title, body } = extractFragmentTitle(html)

  assertEquals(title, undefined)
  assertEquals(body, html)
})

// extractStylesheetLinks (P2-12d) — every scenario below is DOM-free by design (a plain regex,
// same convention extractFragmentTitle already established above), so it runs directly in Deno,
// no DOM needed. The DOM-touching half (ensureStylesheetsLoaded — inserting into document.head,
// waiting for load/error/timeout, deduping against the live document) is deliberately NOT covered
// in THIS file, to keep this suite itself DOM-free — see `ensure-stylesheets-loaded.test.ts` for
// that half, against a real `happy-dom` document.

Deno.test(
  "extractStylesheetLinks: a destination page's own CSS link is extracted, and stripped from the body",
  () => {
    const html = '<link rel="stylesheet" href="/assets/product-abc.css"/><div>content</div>'
    const { refs, body } = extractStylesheetLinks(html)

    assertEquals(refs, [{ href: '/assets/product-abc.css' }])
    assertEquals(body, '<div>content</div>')
  },
)

Deno.test(
  "extractStylesheetLinks: a Comet's own inline CSS link (identical shape) is extracted the same " +
    'way — no special-casing between page CSS and Comet CSS',
  () => {
    const html = '<link rel="stylesheet" href="/assets/widget-hash.css" data-precedence="space"/>' +
      '<div data-comet="...">widget</div>'
    const { refs, body } = extractStylesheetLinks(html)

    assertEquals(refs, [{ href: '/assets/widget-hash.css' }])
    assertEquals(body, '<div data-comet="...">widget</div>')
  },
)

Deno.test(
  'extractStylesheetLinks: page CSS and Comet CSS together — both extracted, in declaration order',
  () => {
    const html = '<link rel="stylesheet" href="/assets/product.css"/>' +
      '<link rel="stylesheet" href="/assets/widget.css" data-precedence="space"/>' +
      '<div data-space-outlet>content</div>'
    const { refs, body } = extractStylesheetLinks(html)

    assertEquals(refs, [
      { href: '/assets/product.css' },
      { href: '/assets/widget.css' },
    ])
    assertEquals(body, '<div data-space-outlet>content</div>')
  },
)

Deno.test(
  'extractStylesheetLinks: two links sharing the SAME href collapse to a single entry',
  () => {
    const html = '<link rel="stylesheet" href="/assets/shared.css"/>' +
      '<link rel="stylesheet" href="/assets/shared.css"/>' +
      '<div>content</div>'
    const { refs, body } = extractStylesheetLinks(html)

    assertEquals(refs, [{ href: '/assets/shared.css' }])
    assertEquals(body, '<div>content</div>')
  },
)

Deno.test("extractStylesheetLinks: a link's own media is preserved", () => {
  const html = '<link rel="stylesheet" href="/assets/mobile.css" media="(max-width: 599px)"/>'
  const { refs } = extractStylesheetLinks(html)

  assertEquals(refs, [{ href: '/assets/mobile.css', media: '(max-width: 599px)' }])
})

Deno.test('extractStylesheetLinks: a link with no media attribute omits it entirely', () => {
  const html = '<link rel="stylesheet" href="/assets/base.css"/>'
  const { refs } = extractStylesheetLinks(html)

  assertEquals(refs, [{ href: '/assets/base.css' }])
  assertFalse('media' in refs[0])
})

Deno.test(
  'extractStylesheetLinks: declaration order is preserved across multiple distinct links',
  () => {
    const html = '<link rel="stylesheet" href="/assets/a.css"/>' +
      '<link rel="stylesheet" href="/assets/b.css"/>' +
      '<link rel="stylesheet" href="/assets/c.css"/>'
    const { refs } = extractStylesheetLinks(html)

    assertEquals(refs.map((ref) => ref.href), [
      '/assets/a.css',
      '/assets/b.css',
      '/assets/c.css',
    ])
  },
)

Deno.test('extractStylesheetLinks: no stylesheet links at all — empty refs, body unchanged', () => {
  const html = '<div data-space-outlet>plain content, no CSS</div>'
  const { refs, body } = extractStylesheetLinks(html)

  assertEquals(refs, [])
  assertEquals(body, html)
})

Deno.test(
  "extractStylesheetLinks: robust to attribute order — rel doesn't have to come first",
  () => {
    const html = '<link href="/assets/reordered.css" media="print" rel="stylesheet"/>'
    const { refs } = extractStylesheetLinks(html)

    assertEquals(refs, [{ href: '/assets/reordered.css', media: 'print' }])
  },
)

Deno.test(
  'extractStylesheetLinks: matches both self-closing and non-self-closing void-element shapes ' +
    '(React and Preact do not necessarily agree on this)',
  () => {
    const selfClosing = extractStylesheetLinks(
      '<link rel="stylesheet" href="/assets/a.css"/>',
    )
    const notSelfClosing = extractStylesheetLinks(
      '<link rel="stylesheet" href="/assets/b.css">',
    )
    assertEquals(selfClosing.refs, [{ href: '/assets/a.css' }])
    assertEquals(notSelfClosing.refs, [{ href: '/assets/b.css' }])
  },
)

Deno.test(
  'extractStylesheetLinks: a link with no href at all is skipped, never a broken/empty ref',
  () => {
    const html = '<link rel="stylesheet"/>'
    const { refs, body } = extractStylesheetLinks(html)

    assertEquals(refs, [])
    assertEquals(body, '')
  },
)
