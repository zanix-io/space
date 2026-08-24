import { assert, assertEquals, assertFalse } from '@std/assert'
import { installTimerMock, resetDom } from './dom-test-setup.ts'
import { initOrbit } from 'modules/client/orbit.ts'
import { ORBIT_FRAGMENT_HEADER, ORBIT_OUTLET_ATTR } from 'modules/router/orbit-protocol.ts'

// `swapOutlet`/`onClick`/`onPopState` — the orchestration half of this module `orbit.test.ts`
// deliberately leaves out (see that file's own doc): a real click/popstate, a real fetch, a real
// outlet swap, a real history update. This is exactly the class of function `dom-test-setup.ts`'s
// own `happy-dom` document already exists for (see `ensure-stylesheets-loaded.test.ts`), extended
// here with the rest of the BOM surface these three functions actually touch — `location`/
// `history`/global `addEventListener`/`fetch` — none of which `ensureStylesheetsLoaded` itself
// needed. `Element`/`MouseEvent` are bridged from the SAME happy-dom instance `dom-test-setup.ts`
// already installed (via `document.defaultView`), not a second one — importing `dom-test-setup.ts`
// for its side effect guarantees this file shares that one document, per its own module doc. The
// global `addEventListener`/`dispatchEvent` pair (`popstate`) is its own hand-rolled stand-in
// instead — see its own doc below for why.
//
// `swapOutlet` itself is not exported (see `orbit.ts`'s own doc on why) — every scenario below
// drives it indirectly through `onClick`'s real `click` handling or `onPopState`'s real `popstate`
// handling, the same way a real page actually triggers it.

// deno-lint-ignore no-explicit-any
const globals = globalThis as any
// deno-lint-ignore no-explicit-any
let view: any

type FakeLocation = { href: string; origin: string; pathname: string; search: string }

const CURRENT: FakeLocation = {
  href: 'https://example.com/products',
  origin: 'https://example.com',
  pathname: '/products',
  search: '',
}

// A hand-rolled global event bus for `popstate` — deliberately NOT happy-dom's own Window-level
// `addEventListener`/`dispatchEvent`. `onPopState` (`orbit.ts`) reads no field off the event object
// at all, so nothing beyond "call every registered `popstate` listener" is needed, and happy-dom's
// own dispatch machinery for a real, bubbling browser event type triggers its own internal
// navigation handling independent of anything this suite does — a real, confirmed `deno test` crash
// ("Failed to execute 'dispatchEvent'... parameter 1 is not of type 'Event'"), not something any
// test here has any interest in exercising (`dom-test-setup.ts`'s own `disableMainFrameNavigation`
// setting only covers a real `<a>` click's default action, a narrower happy-dom mechanism than
// this one).
const globalListeners = new Map<string, Set<() => void>>()

const historyCalls: Array<{ method: 'pushState' | 'replaceState'; url: string }> = []

type FetchStub = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
const fetchCalls: Array<{ url: string; headers: Headers }> = []
let fetchImpl: FetchStub = () => Promise.reject(new Error('fetchImpl not configured for this test'))

// A fragment response's own body is exactly what `swapOutlet` replaces the EXISTING, already-live
// outlet's children with (`outlet.replaceChildren(template.content)`) — it never carries its own
// `[data-space-outlet]` wrapper, unlike a full-document response.
function outletHtml(bodyHtml: string, title?: string): string {
  return `${title ? `<title>${title}</title>` : ''}${bodyHtml}`
}

function okResponse(html: string): Response {
  return new Response(html, { status: 200 })
}

// Reading `document.defaultView`/bridging BOM globals only ever happens from INSIDE a `Deno.test`
// body (via `setUp()`), never at this module's own top level — matching the same discipline
// `ensure-stylesheets-loaded.test.ts` already established for touching `document` at all. Doing
// this at top level instead (reading `document` right after importing `dom-test-setup.ts`,
// alongside importing `orbit.ts`) throws `Cannot read properties of undefined (reading
// 'defaultView')` — `deno test`'s own collection pass evaluates a test file's top-level code in a
// context where `dom-test-setup.ts`'s side effect hasn't landed on `globalThis` yet whenever
// anything with a `/// <reference lib="dom" />` (like `orbit.ts`, transitively) is also imported;
// every `Deno.test` callback body runs later, once that side effect has genuinely applied.
function bridgeGlobals(): void {
  view = globals.document.defaultView
  globals.Element = view.Element
  globals.HTMLAnchorElement = view.HTMLAnchorElement
  globals.MouseEvent = view.MouseEvent
  globals.addEventListener = (type: string, listener: () => void) => {
    const listeners = globalListeners.get(type) ?? new Set()
    listeners.add(listener)
    globalListeners.set(type, listeners)
  }
  globals.dispatchEvent = (event: { type: string }) => {
    for (const listener of globalListeners.get(event.type) ?? []) listener()
  }
  globals.location = { ...CURRENT }
  globals.history = {
    pushState: (_state: unknown, _title: string, url: string) => {
      historyCalls.push({ method: 'pushState', url })
    },
    replaceState: (_state: unknown, _title: string, url: string) => {
      historyCalls.push({ method: 'replaceState', url })
    },
  }
  globals.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), headers: new Headers(init?.headers) })
    return fetchImpl(input, init)
  }
}

function setUp(): { anchor: HTMLAnchorElement; outlet: Element } {
  resetDom()
  bridgeGlobals()
  historyCalls.length = 0
  fetchCalls.length = 0
  fetchImpl = () => Promise.reject(new Error('fetchImpl not configured for this test'))

  const outlet = view.document.createElement('div')
  outlet.setAttribute(ORBIT_OUTLET_ATTR, '')
  outlet.innerHTML = '<p>old content</p>'
  view.document.body.appendChild(outlet)

  const anchor = view.document.createElement('a')
  anchor.setAttribute('href', '/checkout')
  view.document.body.appendChild(anchor)

  // Idempotent: `addEventListener` never registers the same function reference twice, so calling
  // this once per test just re-confirms the listeners are in place rather than stacking duplicates.
  initOrbit({ prefetch: false })

  return { anchor, outlet }
}

// Dispatched on `document` (never on `anchor` itself, even though a real click always bubbles
// there) with `target` overridden to the anchor: `onClick` only ever reads `event.target`, so this
// reaches it identically to a real bubbled click — but going through the anchor's own
// `dispatchEvent` triggers happy-dom's own default click-navigation behavior for a real `<a href>`,
// an unrelated async failure this suite has no interest in reproducing (Orbit's `onClick` already
// calls `event.preventDefault()` on every path this file cares about; happy-dom's own navigation
// stack is not what's under test here).
function click(anchor: HTMLAnchorElement, init: MouseEventInit = {}): MouseEvent {
  const event = new view.MouseEvent('click', { bubbles: true, cancelable: true, ...init })
  Object.defineProperty(event, 'target', { value: anchor, enumerable: true, configurable: true })
  view.document.dispatchEvent(event)
  return event
}

async function flush(): Promise<void> {
  // Lets every microtask `onClick`'s fire-and-forget `swapOutlet(...)` call already scheduled
  // actually settle before a test asserts on its effects — `onClick` itself is synchronous (it
  // never awaits the navigation it kicks off, so a real click never blocks the event loop).
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

Deno.test(
  'onClick: a plain same-origin click is intercepted — fetch carries the Orbit header, ' +
    'the outlet is swapped, and history is pushed (not replaced)',
  async () => {
    const { anchor, outlet } = setUp()
    fetchImpl = () => Promise.resolve(okResponse(outletHtml('<p>new content</p>', 'New title')))

    const event = click(anchor)
    await flush()

    assert(event.defaultPrevented, 'a real, intercepted click must call preventDefault()')
    assertEquals(fetchCalls.length, 1)
    assertEquals(fetchCalls[0].url, 'https://example.com/checkout')
    assertEquals(fetchCalls[0].headers.get(ORBIT_FRAGMENT_HEADER), '1')
    assertEquals(outlet.innerHTML, '<p>new content</p>')
    assertEquals(view.document.title, 'New title')
    assertEquals(historyCalls, [{ method: 'pushState', url: 'https://example.com/checkout' }])
  },
)

Deno.test(
  'onClick: data-orbit-hard escapes interception — no fetch, no preventDefault',
  async () => {
    const { anchor } = setUp()
    anchor.setAttribute('data-orbit-hard', '')

    const event = click(anchor)
    await flush()

    assertFalse(event.defaultPrevented)
    assertEquals(fetchCalls.length, 0)
    assertEquals(historyCalls.length, 0)
  },
)

Deno.test(
  'onClick: a modified click (e.g. cmd/ctrl-click for a new tab) is never intercepted',
  async () => {
    const { anchor } = setUp()

    const event = click(anchor, { metaKey: true })
    await flush()

    assertFalse(event.defaultPrevented)
    assertEquals(fetchCalls.length, 0)
  },
)

Deno.test('onClick: a cross-origin link is never intercepted', async () => {
  const { anchor } = setUp()
  anchor.setAttribute('href', 'https://other.example/checkout')

  const event = click(anchor)
  await flush()

  assertFalse(event.defaultPrevented)
  assertEquals(fetchCalls.length, 0)
})

Deno.test('onClick: a click on a descendant of the anchor resolves via findAnchor', async () => {
  const { anchor, outlet } = setUp()
  const span = view.document.createElement('span')
  span.textContent = 'Checkout'
  anchor.appendChild(span)
  fetchImpl = () => Promise.resolve(okResponse(outletHtml('<p>new content</p>')))

  const event = new view.MouseEvent('click', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'target', { value: span, enumerable: true, configurable: true })
  view.document.dispatchEvent(event)
  await flush()

  assert(event.defaultPrevented)
  assertEquals(outlet.innerHTML, '<p>new content</p>')
})

Deno.test(
  'onClick: a non-ok fragment response degrades to a real navigation (location.href), ' +
    'never a broken swap',
  async () => {
    const { anchor, outlet } = setUp()
    fetchImpl = () => Promise.resolve(new Response('Internal Server Error', { status: 500 }))

    click(anchor)
    await flush()

    assertEquals(globals.location.href, 'https://example.com/checkout')
    assertEquals(outlet.innerHTML, '<p>old content</p>', 'the outlet must be left untouched')
    assertEquals(historyCalls.length, 0)
  },
)

Deno.test(
  'onClick: a rejected fetch (network failure) degrades to a real navigation too',
  async () => {
    const { anchor } = setUp()
    fetchImpl = () => Promise.reject(new Error('network down'))

    click(anchor)
    await flush()

    assertEquals(globals.location.href, 'https://example.com/checkout')
  },
)

Deno.test(
  'onClick: a missing outlet in the document degrades to a real navigation too',
  async () => {
    const { anchor } = setUp()
    view.document.querySelector(`[${ORBIT_OUTLET_ATTR}]`)?.remove()
    fetchImpl = () => Promise.resolve(okResponse(outletHtml('<p>new content</p>')))

    click(anchor)
    await flush()

    assertEquals(globals.location.href, 'https://example.com/checkout')
  },
)

Deno.test('onClick: startViewTransition is used when the browser supports it', async () => {
  const { anchor, outlet } = setUp()
  fetchImpl = () => Promise.resolve(okResponse(outletHtml('<p>new content</p>')))
  let transitionRan = false
  view.document.startViewTransition = (callback: () => void) => {
    transitionRan = true
    callback()
  }

  try {
    click(anchor)
    await flush()

    assert(transitionRan, 'startViewTransition must be used when the browser exposes it')
    assertEquals(outlet.innerHTML, '<p>new content</p>')
  } finally {
    delete view.document.startViewTransition
  }
})

Deno.test(
  'onPopState: back/forward swaps the outlet and REPLACES history, never pushes',
  async () => {
    setUp()
    globals.location.href = 'https://example.com/cart'
    fetchImpl = () => Promise.resolve(okResponse(outletHtml('<p>cart content</p>')))

    globals.dispatchEvent({ type: 'popstate' })
    await flush()

    assertEquals(fetchCalls[0]?.url, 'https://example.com/cart')
    assertEquals(historyCalls, [{ method: 'replaceState', url: 'https://example.com/cart' }])
  },
)

Deno.test(
  'initOrbit: calling it twice never double-fires a click (idempotent listener)',
  async () => {
    const { anchor } = setUp()
    fetchImpl = () => Promise.resolve(okResponse(outletHtml('<p>new content</p>')))

    initOrbit({ prefetch: false })
    initOrbit({ prefetch: false })

    click(anchor)
    await flush()

    assertEquals(fetchCalls.length, 1, 'the same click must only ever be handled once')
  },
)

installTimerMock // referenced so the import is never flagged unused if a future edit stops calling it
