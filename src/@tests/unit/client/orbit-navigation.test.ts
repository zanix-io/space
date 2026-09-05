import { assert, assertEquals, assertFalse, assertStrictEquals } from '@std/assert'
import { installTimerMock, resetDom } from './dom-test-setup.ts'
import { getActiveCspSignature, initOrbit, navigate, retryOutlet } from 'modules/client/orbit.ts'
import { ORBIT_FRAGMENT_HEADER, ORBIT_OUTLET_ATTR } from 'modules/router/orbit-protocol.ts'
import { CSP_SIGNATURE_META_NAME, CSP_SIGNATURE_NONE } from 'modules/router/csp-signature.ts'
import { setCometHydrator, setErrorBoundaryHydrator } from 'modules/client/hydrator-registry.ts'
import { registerPersistHandle } from 'modules/client/comet-persistence.ts'
import {
  COMET_EXPORT_ATTR,
  COMET_MODULE_ATTR,
  COMET_PERSIST_ATTR,
  COMET_PERSIST_VT_ATTR,
  COMET_PROPS_ATTR,
} from 'modules/comets/marker.ts'

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

/** Same as {@linkcode okResponse}, plus a `Content-Security-Policy` header — the shape
 * `applySecurityGuards` actually produces server-side, needed for every CSP-mismatch scenario
 * below. */
function okResponseWithCsp(html: string, csp: string): Response {
  return new Response(html, { status: 200, headers: { 'content-security-policy': csp } })
}

/** Embeds the CURRENTLY ACTIVE document's own CSP signature — the same `<meta>` a real
 * full-document render leaves behind (`csp-signature.ts`'s own module doc) — so
 * `getActiveCspSignature()`/`swapOutlet`'s own mismatch check has something real to compare
 * against. Never called at all in a scenario that doesn't care about CSP — `getActiveCspSignature()`
 * already reports {@linkcode CSP_SIGNATURE_NONE} for a document with no such meta tag, which is
 * exactly what every OTHER test in this file (none of which sets one) relies on implicitly. */
function setActiveCspSignature(signature: string): void {
  const meta = view.document.createElement('meta')
  meta.setAttribute('name', CSP_SIGNATURE_META_NAME)
  meta.setAttribute('content', signature)
  view.document.head.appendChild(meta)
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

Deno.test(
  'onClick: a fragment whose own CSP differs from the currently active document degrades to a ' +
    'real navigation instead of swapping it in under the WRONG, still-active policy — the real ' +
    "bug this exists to fix: a document's active CSP is fixed at the navigation that created it, " +
    "so applying the destination's own (correct) header via a client-side swap was never possible " +
    'in the first place',
  async () => {
    const { anchor, outlet } = setUp()
    setActiveCspSignature("default-src 'self'")
    fetchImpl = () =>
      Promise.resolve(
        okResponseWithCsp(
          outletHtml('<p>new content</p>'),
          "default-src 'self'; script-src 'self' 'unsafe-eval'",
        ),
      )

    click(anchor)
    await flush()

    assertEquals(globals.location.href, 'https://example.com/checkout')
    assertEquals(outlet.innerHTML, '<p>old content</p>', 'the outlet must be left untouched')
    assertEquals(historyCalls.length, 0)
  },
)

Deno.test(
  'onClick: a fragment whose CSP matches the active document — MODULO its own per-request nonce ' +
    '— swaps in normally, the overwhelming common case',
  async () => {
    const { anchor, outlet } = setUp()
    // Set to the ALREADY-NORMALIZED form — exactly what a real full-document render's own
    // `<meta>` carries (`applySecurityGuards` normalizes before embedding it), never a literal
    // nonce value.
    setActiveCspSignature("default-src 'self'; script-src 'self' 'nonce-*'")
    // A real destination request always mints its own, fresh nonce — this must normalize to the
    // SAME `'nonce-*'` placeholder above, never be read as "a different policy".
    fetchImpl = () =>
      Promise.resolve(
        okResponseWithCsp(
          outletHtml('<p>new content</p>'),
          "default-src 'self'; script-src 'self' 'nonce-ZZZZZZZZZZZZZZZZZZZZZZ=='",
        ),
      )

    click(anchor)
    await flush()

    assertEquals(outlet.innerHTML, '<p>new content</p>')
    assertEquals(historyCalls, [{ method: 'pushState', url: 'https://example.com/checkout' }])
  },
)

Deno.test(
  'onClick: a fragment response with no Content-Security-Policy header at all, swapped into a ' +
    'page that ALSO has none, is never treated as a mismatch',
  async () => {
    const { anchor, outlet } = setUp()
    // No setActiveCspSignature() call — getActiveCspSignature() already reports CSP_SIGNATURE_NONE
    // for a document with no such meta tag, exactly like every other, CSP-agnostic test in this file.
    fetchImpl = () => Promise.resolve(okResponse(outletHtml('<p>new content</p>')))

    click(anchor)
    await flush()

    assertEquals(outlet.innerHTML, '<p>new content</p>')
  },
)

Deno.test(
  'getActiveCspSignature: CSP_SIGNATURE_NONE for a document with no signature meta tag at all',
  () => {
    setUp()
    assertEquals(getActiveCspSignature(), CSP_SIGNATURE_NONE)
  },
)

Deno.test(
  "getActiveCspSignature: reads back exactly whatever a full-document render's own meta tag " +
    'carries',
  () => {
    setUp()
    setActiveCspSignature("default-src 'self'")
    assertEquals(getActiveCspSignature(), "default-src 'self'")
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
  'onClick: a persist-tagged boundary reused across the swap carries its own ' +
    'view-transition-name attribute already, BEFORE startViewTransition even mutates the DOM — ' +
    'the real bug this fix closes: detachPersistedComets used to run before startViewTransition ' +
    'was ever called, so the transition\'s "old state" snapshot never saw the boundary at all by ' +
    'the time it was captured, and a persisted Comet visibly flashed/crossfaded with the rest of ' +
    'the outlet even though its own state genuinely survived',
  async () => {
    const { anchor, outlet } = setUp()

    // A persist-tagged boundary already live in the CURRENT outlet, with a registered handle —
    // exactly what `detachPersistedComets` needs to actually retain it instead of discarding it
    // (see comet-persistence.ts's own doc: a boundary with no registered handle is left in place,
    // never retained).
    const boundary = view.document.createElement('div')
    boundary.setAttribute(COMET_PERSIST_ATTR, 'sidebar')
    boundary.setAttribute(COMET_MODULE_ATTR, '/comets/sidebar.tsx')
    boundary.setAttribute(COMET_EXPORT_ATTR, 'Sidebar')
    outlet.appendChild(boundary)
    let disposed = false
    registerPersistHandle(boundary, { reuse: () => {}, dispose: () => void (disposed = true) })

    // The destination fragment's own placeholder for the SAME persist key/module/export — what
    // makes `reuseRetainedComets` splice the RETAINED node back in, rather than leaving a fresh
    // placeholder to hydrate from scratch.
    fetchImpl = () =>
      Promise.resolve(
        okResponse(
          outletHtml(
            `<div ${COMET_PERSIST_ATTR}="sidebar" ${COMET_MODULE_ATTR}="/comets/sidebar.tsx" ` +
              `${COMET_EXPORT_ATTR}="Sidebar" ${COMET_PROPS_ATTR}="{}"></div><p>new content</p>`,
          ),
        ),
      )

    let nameAtOldSnapshot: string | null | undefined
    let attachedAtOldSnapshot = false
    view.document.startViewTransition = (callback: () => void) => {
      // This runs the instant `startViewTransition` is called — BEFORE `callback` (`swap`) has
      // mutated anything. A real browser's own "old state" snapshot is captured at this exact
      // point, synchronously, before `callback` ever runs — so whatever the boundary's own
      // view-transition-name attribute reads as RIGHT HERE is exactly what the real transition
      // would (or wouldn't) have captured for it. Attachment matters just as much as the
      // attribute's own value: a DETACHED node contributes nothing to a real old-state snapshot
      // even if it already carries a `view-transition-name` — only checking the attribute's
      // value here would pass even for a boundary already ripped out of the outlet before this
      // point (`registerPersistTransitionNames` running AFTER `detachPersistedComets` would still
      // leave the name attribute set on the very same JS object, detached or not).
      nameAtOldSnapshot = boundary.getAttribute(COMET_PERSIST_VT_ATTR)
      attachedAtOldSnapshot = boundary.parentNode === outlet
      callback()
      return {
        finished: Promise.resolve(),
        ready: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
      }
    }

    try {
      click(anchor)
      await flush()

      assert(
        nameAtOldSnapshot,
        'the boundary must already carry its own view-transition-name BEFORE startViewTransition ' +
          'mutates the DOM — a name assigned any later contributes nothing to the old-state snapshot',
      )
      assert(
        attachedAtOldSnapshot,
        'the boundary must still be ATTACHED to the outlet at old-snapshot time — detaching it ' +
          '(even with its view-transition-name already set) means a real browser captures nothing ' +
          'for it at all, the exact bug this fix closes',
      )
      assertFalse(disposed, 'a boundary reused on the destination page must never be disposed')

      const reused = outlet.querySelector(`[${COMET_PERSIST_ATTR}="sidebar"]`)
      assertStrictEquals(
        reused,
        boundary,
        'the exact SAME node must be spliced back in — a real morph needs identity, not just a ' +
          'matching selector',
      )
      assertEquals(
        reused?.getAttribute(COMET_PERSIST_VT_ATTR),
        nameAtOldSnapshot,
        "the SAME view-transition-name must still be present once the transition's new-state " +
          'snapshot is captured — proving it survives the detach-then-reattach round trip intact',
      )
    } finally {
      delete view.document.startViewTransition
    }
  },
)

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

Deno.test(
  'swapOutlet: BOTH the comet hydrator and the error-boundary hydrator are called with the fresh ' +
    'outlet after every swap, not just the comet one — hydrator-registry.ts registers them ' +
    'independently, and orbit.ts must call both',
  async () => {
    const { anchor, outlet } = setUp()
    fetchImpl = () => Promise.resolve(okResponse(outletHtml('<p>new content</p>')))

    const cometCalls: ParentNode[] = []
    const errorBoundaryCalls: ParentNode[] = []
    setCometHydrator((root = view.document) => void cometCalls.push(root))
    setErrorBoundaryHydrator((root = view.document) => void errorBoundaryCalls.push(root))

    try {
      click(anchor)
      await flush()

      assertEquals(cometCalls, [outlet])
      assertEquals(errorBoundaryCalls, [outlet])
    } finally {
      // Module-level registry state — never leaked into a later, unrelated test in this same file.
      setCometHydrator(() => {})
      setErrorBoundaryHydrator(() => {})
    }
  },
)

Deno.test(
  'retryOutlet: a segment whose error PERSISTS across a retry still gets hydrateErrorBoundaries ' +
    'called again on the freshly swapped outlet — the real regression this covers: a failing ' +
    "segment's own 'reset' (retryOutlet) swaps in a BRAND NEW, un-recovered failure marker, which " +
    'would otherwise sit there inert forever (hydrateErrorBoundaries only ever runs once, from the ' +
    'client entry, at the very first page load) instead of recovering a second time',
  async () => {
    setUp()
    fetchImpl = () => Promise.resolve(okResponse(outletHtml('<p>still failing</p>')))

    const errorBoundaryCalls: ParentNode[] = []
    setErrorBoundaryHydrator((root = view.document) => void errorBoundaryCalls.push(root))

    try {
      await retryOutlet()

      assertEquals(
        errorBoundaryCalls.length,
        1,
        'hydrateErrorBoundaries must run again after the retry',
      )
      assertEquals(
        historyCalls,
        [{ method: 'replaceState', url: CURRENT.href }],
        'a retry of the SAME url is never a new history entry',
      )
    } finally {
      setErrorBoundaryHydrator(() => {})
    }
  },
)

Deno.test(
  'navigate: a same-origin destination runs through the same swap a real click uses — fetch ' +
    'carries the Orbit header, the outlet is swapped, and history is pushed (not replaced) by ' +
    'default',
  async () => {
    const { outlet } = setUp()
    fetchImpl = () => Promise.resolve(okResponse(outletHtml('<p>new content</p>', 'New title')))

    await navigate('/checkout')

    assertEquals(fetchCalls.length, 1)
    assertEquals(fetchCalls[0].url, 'https://example.com/checkout')
    assertEquals(fetchCalls[0].headers.get(ORBIT_FRAGMENT_HEADER), '1')
    assertEquals(outlet.innerHTML, '<p>new content</p>')
    assertEquals(view.document.title, 'New title')
    assertEquals(historyCalls, [{ method: 'pushState', url: 'https://example.com/checkout' }])
  },
)

Deno.test(
  'navigate: options.replace runs the same swap but REPLACES history instead of pushing',
  async () => {
    setUp()
    fetchImpl = () => Promise.resolve(okResponse(outletHtml('<p>new content</p>')))

    await navigate('/checkout', { replace: true })

    assertEquals(historyCalls, [{ method: 'replaceState', url: 'https://example.com/checkout' }])
  },
)

Deno.test(
  'navigate: a cross-origin destination is never swapped — it gets a real navigation, exactly ' +
    'like a cross-origin link click already does',
  async () => {
    setUp()

    await navigate('https://other.example/checkout')

    assertEquals(fetchCalls.length, 0)
    assertEquals(historyCalls.length, 0)
    assertEquals(globals.location.href, 'https://other.example/checkout')
  },
)

Deno.test(
  'navigate: a same-document hash-only link is never swapped either — a real navigation lets the ' +
    "browser's own native scroll-to-element behavior run, the same escape hatch onClick already " +
    'has for this exact case',
  async () => {
    setUp()
    globals.location.href = 'https://example.com/products'
    globals.location.pathname = '/products'
    globals.location.search = ''

    await navigate('#details')

    assertEquals(fetchCalls.length, 0)
    assertEquals(historyCalls.length, 0)
    assertEquals(globals.location.href, 'https://example.com/products#details')
  },
)

Deno.test(
  'navigate: a non-ok fragment response degrades to a real navigation too, same as a real click',
  async () => {
    const { outlet } = setUp()
    fetchImpl = () => Promise.resolve(new Response('Internal Server Error', { status: 500 }))

    await navigate('/checkout')

    assertEquals(globals.location.href, 'https://example.com/checkout')
    assertEquals(outlet.innerHTML, '<p>old content</p>', 'the outlet must be left untouched')
    assertEquals(historyCalls.length, 0)
  },
)

Deno.test(
  'navigate: two overlapping navigations are serialized — the second never starts its own fetch ' +
    "until the first has fully settled, so neither races the other's DOM mutation",
  async () => {
    const { outlet } = setUp()
    const deferred: Array<(response: Response) => void> = []
    fetchImpl = () =>
      new Promise<Response>((resolve) => {
        deferred.push(resolve)
      })

    const first = navigate('/checkout')
    const second = navigate('/cart')
    await Promise.resolve()
    await Promise.resolve()

    // The second navigation's own fetch has NOT started yet — only the first one has, even
    // though both `navigate()` calls already ran, synchronously, one after the other.
    assertEquals(fetchCalls.length, 1)
    assertEquals(fetchCalls[0].url, 'https://example.com/checkout')

    deferred[0](okResponse(outletHtml('<p>first</p>')))
    await first
    await flush()

    // Only once the first has FULLY settled does the second's own fetch fire.
    assertEquals(fetchCalls.length, 2)
    assertEquals(fetchCalls[1].url, 'https://example.com/cart')
    assertEquals(
      outlet.innerHTML,
      '<p>first</p>',
      "the first destination's own content lands first, briefly, rather than being skipped",
    )

    deferred[1](okResponse(outletHtml('<p>second</p>')))
    await second

    // The outlet ends up with the SECOND (later-triggered) destination's content — never blank,
    // never a mix of both, the real failure mode this fix closes.
    assertEquals(outlet.innerHTML, '<p>second</p>')
    assertEquals(historyCalls, [
      { method: 'pushState', url: 'https://example.com/checkout' },
      { method: 'pushState', url: 'https://example.com/cart' },
    ])
  },
)

installTimerMock // referenced so the import is never flagged unused if a future edit stops calling it
