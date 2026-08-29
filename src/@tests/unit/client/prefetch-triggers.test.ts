import { assert, assertEquals } from '@std/assert'
import { resetDom } from './dom-test-setup.ts'
import { initPrefetch, rescanPrefetchTargets, resetPrefetchState } from 'modules/client/prefetch.ts'

// The DOM-triggered half of `prefetch.ts` — hover/focus debouncing, viewport observation, and
// `considerPrefetch`'s own real-anchor reading — deliberately kept out of `prefetch.test.ts` (see
// that file's own scope: pure, DOM-free decision functions only). This is exactly the class of
// problem `dom-test-setup.ts`'s own `happy-dom` document already exists for (see
// `orbit-navigation.test.ts`), extended here with the small extra bit of BOM surface `prefetch.ts`
// itself actually touches (`location`, plus a real or stubbed `IntersectionObserver`) — none of
// which `ensureStylesheetsLoaded` needed. `initPrefetch`/`rescanPrefetchTargets` are the only two
// exports; everything else below (`considerPrefetch`, hover start/cancel, `onIntersect`,
// `scanViewportTargets`) is reached only through them, the same way a real page actually triggers
// them — none of it is called directly.

// deno-lint-ignore no-explicit-any
const globals = globalThis as any

type FakeLocation = { href: string; origin: string; pathname: string; search: string }
const CURRENT: FakeLocation = {
  href: 'https://example.com/products',
  origin: 'https://example.com',
  pathname: '/products',
  search: '',
}

const fetchCalls: string[] = []
let fetchImpl: () => Promise<Response> = () => Promise.resolve(new Response('ok'))

// A one-shot, hand-rolled `IntersectionObserver` stand-in — `initPrefetch`/`onIntersect`
// (`prefetch.ts`) read the bare global constructor directly, with no injection point of their
// own (unlike `scheduleCometHydration`'s own `IntersectionObserverCtor` override), so the real
// primitive itself is stubbed here instead, same as `fetch`/`location` below.
class FakeIntersectionObserver {
  public static instances: FakeIntersectionObserver[] = []
  public observed: Element[] = []
  public unobserved: Element[] = []
  public callback: (entries: { isIntersecting: boolean; target: Element }[]) => void
  public constructor(callback: (entries: { isIntersecting: boolean; target: Element }[]) => void) {
    this.callback = callback
    FakeIntersectionObserver.instances.push(this)
  }
  public observe(el: Element): void {
    this.observed.push(el)
  }
  public unobserve(el: Element): void {
    this.unobserved.push(el)
  }
  public disconnect(): void {}
}

function bridgeGlobals(): void {
  const view = document.defaultView as unknown as { Element: unknown; HTMLAnchorElement: unknown }
  globals.Element = view.Element
  globals.HTMLAnchorElement = view.HTMLAnchorElement
  globals.location = { ...CURRENT }
  globals.fetch = (input: RequestInfo | URL) => {
    fetchCalls.push(String(input))
    return fetchImpl()
  }
}

function setUp(): void {
  resetDom()
  bridgeGlobals()
  resetPrefetchState()
  fetchCalls.length = 0
  fetchImpl = () => Promise.resolve(new Response('ok'))
}

function anchor(href: string, attrs: Record<string, string> = {}): HTMLAnchorElement {
  const el = document.createElement('a')
  el.setAttribute('href', href)
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value)
  document.body.appendChild(el)
  return el
}

function dispatch(el: Element, type: string): void {
  el.dispatchEvent(new Event(type))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// HOVER_DEBOUNCE_MS is 120ms in the source (not exported) — every wait below clears it with margin.

function withFakeIntersectionObserver(run: () => void): void {
  const previous = globals.IntersectionObserver
  FakeIntersectionObserver.instances = []
  globals.IntersectionObserver = FakeIntersectionObserver
  try {
    run()
  } finally {
    globals.IntersectionObserver = previous
  }
}

// -- Hover/focus trigger --------------------------------------------------------------------

Deno.test(
  'initPrefetch (onHover, default on): hovering an eligible link past the debounce schedules a real prefetch',
  async () => {
    setUp()
    const link = anchor('/checkout')
    initPrefetch(document, {})

    dispatch(link, 'mouseenter')
    assertEquals(fetchCalls.length, 0, 'must be debounced, not immediate')

    await sleep(160)
    assertEquals(fetchCalls, ['https://example.com/checkout'])
  },
)

Deno.test(
  'initPrefetch (onHover): a mouseleave before the debounce elapses cancels the pending prefetch (cancelHover)',
  async () => {
    setUp()
    const link = anchor('/checkout')
    initPrefetch(document, {})

    dispatch(link, 'mouseenter')
    dispatch(link, 'mouseleave')
    await sleep(160)

    assertEquals(fetchCalls.length, 0, 'a cancelled hover must never schedule a prefetch')
  },
)

Deno.test(
  'startHover: a second mouseenter on the same anchor before its own debounce elapses is a no-op — still exactly one prefetch',
  async () => {
    setUp()
    const link = anchor('/checkout')
    initPrefetch(document, {})

    dispatch(link, 'mouseenter')
    await sleep(60) // still inside the 120ms debounce window
    dispatch(link, 'mouseenter') // must not reset or duplicate the already-pending timer

    await sleep(160)
    assertEquals(fetchCalls.length, 1)
  },
)

Deno.test(
  'onHoverStart/onHoverEnd: an event target with no anchor ancestor is a no-op for both',
  async () => {
    setUp()
    const div = document.createElement('div')
    document.body.appendChild(div)
    initPrefetch(document, {})

    dispatch(div, 'mouseenter')
    dispatch(div, 'mouseleave')
    await sleep(160)

    assertEquals(fetchCalls.length, 0)
  },
)

Deno.test(
  'cancelHover: a mouseleave on an anchor that was never hovered is a no-op — nothing to clear',
  () => {
    setUp()
    const link = anchor('/checkout')
    initPrefetch(document, {})

    dispatch(link, 'mouseleave') // no prior mouseenter at all — must not throw
    assertEquals(fetchCalls.length, 0)
  },
)

Deno.test(
  'considerPrefetch (via hover): the data-orbit-hard opt-out is respected — never scheduled, even past the debounce',
  async () => {
    setUp()
    const link = anchor('/checkout', { 'data-orbit-hard': '' })
    initPrefetch(document, {})

    dispatch(link, 'mouseenter')
    await sleep(160)

    assertEquals(fetchCalls.length, 0)
  },
)

// -- Viewport trigger -------------------------------------------------------------------------

Deno.test(
  'initPrefetch (onViewport): installs an IntersectionObserver and immediately observes every eligible anchor already in the DOM',
  () => {
    setUp()
    const link = anchor('/checkout')

    withFakeIntersectionObserver(() => {
      initPrefetch(document, { onHover: false, onViewport: true })

      assertEquals(FakeIntersectionObserver.instances.length, 1)
      assertEquals(FakeIntersectionObserver.instances[0].observed, [link])
    })
  },
)

Deno.test(
  'onIntersect: a non-intersecting entry is ignored; an intersecting one unobserves the target (one-shot) and schedules a prefetch',
  () => {
    setUp()
    const link = anchor('/checkout')

    withFakeIntersectionObserver(() => {
      initPrefetch(document, { onHover: false, onViewport: true })
      const observer = FakeIntersectionObserver.instances[0]

      observer.callback([{ isIntersecting: false, target: link }])
      assertEquals(fetchCalls.length, 0, 'a non-intersecting entry must never schedule a prefetch')
      assertEquals(observer.unobserved.length, 0)

      observer.callback([{ isIntersecting: true, target: link }])
      assertEquals(observer.unobserved, [link], 'an intersecting link is unobserved — one-shot')
      assertEquals(fetchCalls, ['https://example.com/checkout'])
    })
  },
)

Deno.test(
  'onIntersect: an intersecting entry whose target is not an anchor element is safely ignored',
  () => {
    setUp()
    const div = document.createElement('div')
    document.body.appendChild(div)

    withFakeIntersectionObserver(() => {
      initPrefetch(document, { onHover: false, onViewport: true })
      const observer = FakeIntersectionObserver.instances[0]

      observer.callback([{ isIntersecting: true, target: div }])
      assertEquals(fetchCalls.length, 0)
    })
  },
)

Deno.test(
  'rescanPrefetchTargets: observes anchors inserted after initPrefetch, when viewport prefetch is enabled',
  () => {
    setUp()

    withFakeIntersectionObserver(() => {
      initPrefetch(document, { onHover: false, onViewport: true })
      const observer = FakeIntersectionObserver.instances[0]
      assert(observer.observed.length === 0, 'nothing eligible existed at initPrefetch time')

      const link = anchor('/late')
      rescanPrefetchTargets(document)

      assertEquals(observer.observed, [link])
    })
  },
)
