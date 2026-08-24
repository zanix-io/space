// deno-coverage-ignore-file

// Real-DOM bootstrap for `ensureStylesheetsLoaded` (`modules/client/orbit.ts`) — the one function
// in this package whose contract is genuine `document.head` mutation plus `load`/`error`/timeout
// event timing on a real `<link>`, not a plain string/object fixture the way every other DOM-free
// function in this package (`shouldInterceptNavigation`, `extractStylesheetLinks`, `resolveLinkInfo`
// — see `orbit.test.ts`'s own doc) already is. Side-effecting on import: importing this module once
// installs a single `happy-dom` document for the whole `deno test` process (ES modules are
// evaluated once and cached, so every test file importing this — directly or transitively — shares
// the same instance).
//
// Deliberately narrow — only `document`, `HTMLLinkElement` (implicitly, via `document.createElement`)
// and `Event` are bridged. `ensureStylesheetsLoaded` never reads `window`/`navigator`/`location`/
// focus or keyboard events, so nothing beyond what it actually touches is installed here — the same
// "duck-type exactly the surface used" discipline this package's own `comet-persistence.test.ts`
// (`MockElement`) and `link-info.test.ts` (`FakeLocation`) already apply, just backed by a real DOM
// engine instead of a hand-rolled object, because `document.head.appendChild`/a real `<link>`'s own
// `load`/`error` event firing aren't reproducible any other way. `@zanix/space-ui` already
// established `happy-dom` (over `jsdom`) as this monorepo's answer to the identical class of
// problem — see that package's own `dom-test-setup.ts` — but its copy isn't reusable here: `space-ui`
// depends on `@zanix/space`, so importing it back would be circular, and its surface (focus/keyboard/
// resize, for Menu/Slider/Modal) doesn't overlap with what this file needs.
import { Window } from 'happy-dom'

// `navigation.disableMainFrameNavigation` — off by default in happy-dom itself, but a real
// `<a href>`'s click ever reaching this document (e.g. `orbit-navigation.test.ts`'s own real
// `click`/`popstate` dispatches, exercising `onClick`'s actual DOM-target resolution) would
// otherwise let happy-dom attempt its OWN internal async navigation, independent of whatever
// `preventDefault()` the code under test already called — a real, confirmed `deno test` crash
// ("Failed to execute 'dispatchEvent'... parameter 1 is not of type 'Event'"), not something any
// test here has any interest in exercising. Harmless for `ensureStylesheetsLoaded`'s own use,
// which never navigates at all.
const dom = new Window({ settings: { navigation: { disableMainFrameNavigation: true } } })
// deno-lint-ignore no-explicit-any
const globals = globalThis as any
globals.document = dom.document
globals.Event = dom.Event

/**
 * A deterministic replacement for `setTimeout`/`clearTimeout` — a fake clock a test advances by an
 * exact number of milliseconds, firing exactly the timeouts that would have fired by then, instead
 * of waiting on `STYLESHEET_LOAD_TIMEOUT_MS`'s real 4 real seconds. Same shape and reasoning as
 * `@zanix/space-ui`'s own `installTimerMock` (`dom-test-setup.ts`), reimplemented locally rather
 * than imported — see this file's own module doc for why sharing isn't viable.
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

/** Removes every node `document.head`/`document.body` accumulated during a test, and resets
 * `pendingStylesheetLoads`' own effect (nothing to reset there directly — it self-clears via
 * `.finally()` once each load settles; this only clears the DOM side) — called between tests so one
 * test's inserted `<link>`s never leak into the next. */
export function resetDom(): void {
  dom.document.head.innerHTML = ''
  dom.document.body.innerHTML = ''
}
