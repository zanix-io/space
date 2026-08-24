import { assert, assertEquals, assertFalse } from '@std/assert'
import { installTimerMock, resetDom } from './dom-test-setup.ts'
import { ensureStylesheetsLoaded } from 'modules/client/orbit.ts'

// The DOM-touching half of P2-12d — real `document.head` mutation, real `load`/`error`/timeout
// event timing, dedup against the live document — deliberately kept out of `orbit.test.ts` (see
// that file's own doc) so THAT suite stays entirely DOM-free. `extractStylesheetLinks`'s own
// behavior (which stylesheets a fragment asks for, in what order, with what `media`) is already
// covered there and never re-asserted here — every case below starts from a fragment whose links
// `extractStylesheetLinks` has already been proven to parse correctly, and only exercises what
// happens to them once real APIs get involved.

function fragment(...links: string[]): string {
  return `<div>${links.join('')}<p>content</p></div>`
}

Deno.test(
  'ensureStylesheetsLoaded: a fragment with no stylesheet link touches nothing',
  async () => {
    resetDom()
    const html = fragment()
    const result = await ensureStylesheetsLoaded(html)
    assertEquals(result, html)
    assertEquals(document.head.querySelectorAll('link').length, 0)
  },
)

Deno.test(
  'ensureStylesheetsLoaded: a missing stylesheet is inserted into document.head, and resolves ' +
    'once it fires "load"',
  async () => {
    resetDom()
    const html = fragment('<link rel="stylesheet" href="/product.css">')

    const pending = ensureStylesheetsLoaded(html)
    // Synchronous by design (see orbit.ts's own doc: insertion happens before the function's own
    // first `await`) — the link is already in the document the instant this call returns control.
    const link = document.head.querySelector('link[href="/product.css"]')
    assert(link, 'expected the stylesheet to already be in document.head')
    assertEquals(link.getAttribute('rel'), 'stylesheet')

    link.dispatchEvent(new Event('load'))
    const body = await pending

    assertFalse(body.includes('<link'), 'the resolved body must have the link tag stripped')
    assertEquals(document.head.querySelectorAll('link').length, 1, 'never duplicated')
  },
)

Deno.test(
  "ensureStylesheetsLoaded: a stylesheet's own media attribute survives onto the real <link>",
  async () => {
    resetDom()
    const html = fragment(
      '<link rel="stylesheet" href="/mobile.css" media="(max-width: 599px)">',
    )
    const pending = ensureStylesheetsLoaded(html)
    const link = document.head.querySelector('link[href="/mobile.css"]')
    assert(link, 'expected the stylesheet to already be in document.head')
    assertEquals(link.getAttribute('media'), '(max-width: 599px)')

    link.dispatchEvent(new Event('load'))
    await pending
  },
)

Deno.test(
  'ensureStylesheetsLoaded: a stylesheet with no media carries none onto the real <link>',
  async () => {
    resetDom()
    const html = fragment('<link rel="stylesheet" href="/base.css">')
    const pending = ensureStylesheetsLoaded(html)
    const link = document.head.querySelector('link[href="/base.css"]')
    assert(link, 'expected the stylesheet to already be in document.head')
    assertFalse(link.hasAttribute('media'))

    link.dispatchEvent(new Event('load'))
    await pending
  },
)

Deno.test(
  'ensureStylesheetsLoaded: two missing stylesheets are inserted in declaration order, both ' +
    'awaited before resolving',
  async () => {
    resetDom()
    const html = fragment(
      '<link rel="stylesheet" href="/a.css">',
      '<link rel="stylesheet" href="/b.css">',
    )
    const pending = ensureStylesheetsLoaded(html)
    const links = [...document.head.querySelectorAll('link')]
    assertEquals(links.map((link) => link.getAttribute('href')), ['/a.css', '/b.css'])

    // Resolve out of insertion order — the PROMISE only cares that both settle, not which first;
    // insertion order (already asserted above) is what carries the real cascade guarantee.
    links[1].dispatchEvent(new Event('load'))
    links[0].dispatchEvent(new Event('load'))
    await pending
  },
)

Deno.test(
  'ensureStylesheetsLoaded: a stylesheet already present anywhere in the document (not just ' +
    'head) is never re-inserted, and needs no load event to resolve',
  async () => {
    resetDom()
    // Simulates a Comet's own CSS `<link>` left inline in `<body>` on a Preact full-document load
    // (see orbit.ts's own doc for why `document.body`, not just `document.head`, is checked) —
    // already delivered by the initial SSR response, never by this function.
    const already = document.createElement('link')
    already.rel = 'stylesheet'
    already.href = '/already-loaded.css'
    document.body.appendChild(already)

    const html = fragment('<link rel="stylesheet" href="/already-loaded.css">')
    const body = await ensureStylesheetsLoaded(html)

    assertFalse(body.includes('<link'))
    assertEquals(document.querySelectorAll('link[rel="stylesheet"]').length, 1, 'no duplicate')
  },
)

Deno.test(
  'ensureStylesheetsLoaded: "error" resolves the swap too, exactly like "load" — never throws, ' +
    'never hangs',
  async () => {
    resetDom()
    const html = fragment('<link rel="stylesheet" href="/broken.css">')
    const pending = ensureStylesheetsLoaded(html)
    const link = document.head.querySelector('link[href="/broken.css"]')
    assert(link, 'expected the stylesheet to already be in document.head')

    link.dispatchEvent(new Event('error'))
    const body = await pending // would hang forever if `error` didn't resolve the same as `load`
    assertFalse(body.includes('<link'))
  },
)

Deno.test(
  'ensureStylesheetsLoaded: a stylesheet that never fires load or error still resolves, via the ' +
    '4s timeout ceiling',
  async () => {
    resetDom()
    const timers = installTimerMock()
    try {
      const html = fragment('<link rel="stylesheet" href="/hung.css">')
      const pending = ensureStylesheetsLoaded(html)

      let settled = false
      pending.then(() => {
        settled = true
      })

      // Neither `load` nor `error` ever fires on this link — only the timeout can resolve it.
      timers.advance(3999)
      await Promise.resolve() // let any microtask from a (wrongly) fired resolution flush
      assertFalse(settled, 'must not resolve before the 4s ceiling')

      timers.advance(1)
      const body = await pending
      assert(settled)
      assertFalse(body.includes('<link'))
    } finally {
      timers.restore()
    }
  },
)

Deno.test(
  'ensureStylesheetsLoaded: a second, overlapping request for the same href never inserts a ' +
    'duplicate <link>, and resolves once the one real link settles',
  async () => {
    resetDom()
    const html = fragment('<link rel="stylesheet" href="/shared.css">')

    // Two "navigations" both needing the exact same missing stylesheet, back to back — the
    // concurrency case orbit.ts's own doc describes (`pendingStylesheetLoads`), and/or the plain
    // `existingHrefs` re-scan on the second call; either mechanism must produce the same observable
    // contract: never two `<link>`s for the same href, and both callers eventually resolve.
    const first = ensureStylesheetsLoaded(html)
    const second = ensureStylesheetsLoaded(html)

    const links = document.head.querySelectorAll('link[href="/shared.css"]')
    assertEquals(links.length, 1, 'only one real <link> ever gets inserted for a shared href')

    links[0].dispatchEvent(new Event('load'))
    await Promise.all([first, second])
  },
)
