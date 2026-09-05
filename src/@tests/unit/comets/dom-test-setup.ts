// deno-coverage-ignore-file

// Real-DOM bootstrap for the `modules/comets/*` primitives this directory's own tests exercise —
// real `<form>` element/field construction, `FormData` extraction, `sessionStorage`/
// `localStorage` read/write, and (for `scroll-restoration.ts`) real window/element scroll-position
// tracking, none of which a plain string/object fixture can stand in for. Side-effecting on
// import: importing this module once installs a single `happy-dom` window for the whole
// `deno test` process (ES modules are evaluated once and cached, so every test file importing
// this — directly or transitively — shares the same instance).
//
// Deliberately narrow — `document`, `Event`, `FormData`, the four element constructors
// `form-draft-persistence.ts`'s own `instanceof` checks need (`HTMLFormElement`/
// `HTMLInputElement`/`HTMLTextAreaElement`/`HTMLSelectElement`), `sessionStorage`/`localStorage`,
// and (for `scroll-restoration.ts`) `location`/`scrollTo`/`scrollX`/`scrollY`/
// `addEventListener`/`removeEventListener` at the window level. Nothing about
// navigation/focus/keyboard is bridged beyond that — this surface never touches any of that. Not
// reusable from `../client/dom-test-setup.ts`: that file deliberately bridges only
// `document`/`Event` for `ensureStylesheetsLoaded`'s own narrower surface, and widening it for
// this directory's own concerns would widen a shared fixture other tests depend on staying narrow.
import { Window } from 'happy-dom'

// `navigation.disableMainFrameNavigation` — off by default in happy-dom itself, but a real
// `<form>`'s `submit` event, dispatched with no `preventDefault()` call anywhere in the code under
// test (this module deliberately never intercepts the actual submission, only reacts to it), would
// otherwise let happy-dom attempt its OWN internal async navigation — the same class of `deno test`
// crash `../client/dom-test-setup.ts`'s own identical setting already guards against for a real
// `<a href>` click, confirmed there first.
const dom = new Window({
  url: 'https://example.com/en/products',
  settings: { navigation: { disableMainFrameNavigation: true } },
})
// deno-lint-ignore no-explicit-any
const globals = globalThis as any
globals.document = dom.document
globals.Event = dom.Event
globals.FormData = dom.FormData
globals.HTMLFormElement = dom.HTMLFormElement
globals.HTMLInputElement = dom.HTMLInputElement
globals.HTMLTextAreaElement = dom.HTMLTextAreaElement
globals.HTMLSelectElement = dom.HTMLSelectElement
// Live getters, not a one-time copy — confirmed empirically that `dom.sessionStorage`/
// `dom.localStorage` accessed once at this module's own top-level evaluation is NOT the same
// object `dom.sessionStorage` returns once a `Deno.test()` callback actually runs (happy-dom's own
// Storage getter isn't stable until some internal setup settles between module evaluation and the
// first test callback) — a one-time `globals.sessionStorage = dom.sessionStorage` assignment here
// silently pins every test to a STALE, pre-settlement instance, so `.clear()` called later via
// `dom.sessionStorage` (inside `resetDom`) operates on a DIFFERENT object than what
// `globals.sessionStorage.getItem(...)` reads back in a test, letting one test's writes leak into
// every test after it. Reading `dom.sessionStorage`/`dom.localStorage` fresh, every access, is
// what actually keeps `resetDom`'s own `.clear()` visible to every test.
Object.defineProperty(globals, 'sessionStorage', {
  configurable: true,
  get: () => dom.sessionStorage,
})
Object.defineProperty(globals, 'localStorage', { configurable: true, get: () => dom.localStorage })
// Same live-getter reasoning as sessionStorage/localStorage above — `location`/`navigator` too
// (network-status.ts reads `navigator.onLine`).
Object.defineProperty(globals, 'location', { configurable: true, get: () => dom.location })
Object.defineProperty(globals, 'navigator', { configurable: true, get: () => dom.navigator })
globals.scrollTo = dom.scrollTo.bind(dom)
globals.addEventListener = dom.addEventListener.bind(dom)
globals.removeEventListener = dom.removeEventListener.bind(dom)
// Deliberately NOT `dispatchEvent` — dispatching directly on the window object triggers an
// internal happy-dom follow-up that ends up calling DENO'S OWN native `dispatchEvent` with a
// happy-dom `Event` instance, an uncaught, un-catchable `TypeError` that crashes the whole test
// file — the same class of real, confirmed `deno test` crash `../client/dom-test-setup.ts`'s own
// `disableMainFrameNavigation` setting already guards against for a different trigger (`<a href>`
// clicks). `scroll-restoration.test.ts` never needs to fire a real window-level event because of
// it: its own save/debounce behavior is exercised through a container element's `dispatchEvent`
// instead (proven safe — the same call shape `form-draft-persistence.test.ts`/
// `submit-guard.test.ts` already use successfully), which is the exact same code path
// `attachScrollRestoration` runs for the window case, just a different `scrollEventTarget` value.
// Live getters, not a one-time copy — `attachScrollRestoration`'s own save step reads the CURRENT
// position after a real `scrollTo()` call already updated happy-dom's own internal state.
Object.defineProperty(globals, 'scrollX', { configurable: true, get: () => dom.scrollX })
Object.defineProperty(globals, 'scrollY', { configurable: true, get: () => dom.scrollY })

/** Removes every node `document.body` accumulated during a test, clears both storage backends,
 * and resets the window's own scroll position and URL hash — called between tests so one test's
 * form/draft/scroll state never leaks into the next. */
export function resetDom(): void {
  dom.document.body.innerHTML = ''
  // Hash reset BEFORE clearing storage, not after: happy-dom's `sessionStorage`/`localStorage`
  // partition by the CURRENT full URL (hash included) at the moment `.clear()` runs — clearing
  // while a PREVIOUS test's `#fragment` is still set leaves an entry written under the bare
  // pathname (no hash) untouched, exactly the kind of one-test-leaks-into-the-next bug this
  // function exists to prevent. Confirmed empirically, not assumed.
  dom.location.hash = ''
  dom.sessionStorage.clear()
  dom.localStorage.clear()
  dom.scrollTo(0, 0)
}

/**
 * A deterministic replacement for `setTimeout`/`clearTimeout` — a fake clock a test advances by an
 * exact number of milliseconds, firing exactly the timeouts that would have fired by then, instead
 * of racing `DEFAULT_DRAFT_DEBOUNCE_MS`'s real 500ms. Same shape and reasoning as
 * `../client/dom-test-setup.ts`'s own `installTimerMock`, reimplemented locally rather than
 * imported — see this file's own module doc for why sharing isn't viable across these two
 * directories' own `globals` bindings.
 */
export function installTimerMock() {
  const previousSetTimeout = globals.setTimeout
  const previousClearTimeout = globals.clearTimeout

  let now = 0
  let nextId = 1
  const pending = new Map<number, { callback: () => void; fireAt: number }>()

  globals.setTimeout = (callback: () => void, delay = 0) => {
    const id = nextId++
    pending.set(id, { callback, fireAt: now + delay })
    return id
  }
  globals.clearTimeout = (id: number) => {
    pending.delete(id)
  }

  return {
    /** Advances the fake clock and runs every timeout callback due by that point — a callback that
     * schedules another timeout during this flush is NOT run again in the same call. */
    advance(ms: number) {
      now += ms
      const due = [...pending.entries()].filter(([, timer]) => timer.fireAt <= now)
      for (const [id] of due) pending.delete(id)
      for (const [, timer] of due) timer.callback()
    },
    restore() {
      globals.setTimeout = previousSetTimeout
      globals.clearTimeout = previousClearTimeout
    },
  }
}
