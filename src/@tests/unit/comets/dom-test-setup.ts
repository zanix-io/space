// deno-coverage-ignore-file

// Real-DOM bootstrap for `attachFormDraftPersistence`/`restoreDraftValue`/`persistDraftValue`
// (`modules/comets/form-draft-persistence.ts`) — real `<form>` element/field construction,
// `FormData` extraction, and `sessionStorage`/`localStorage` read/write, none of which a plain
// string/object fixture can stand in for. Side-effecting on import: importing this module once
// installs a single `happy-dom` document for the whole `deno test` process (ES modules are
// evaluated once and cached, so every test file importing this — directly or transitively —
// shares the same instance).
//
// Deliberately narrow — `document`, `Event`, `FormData`, and the four element constructors this
// module's own `instanceof` checks need (`HTMLFormElement`/`HTMLInputElement`/
// `HTMLTextAreaElement`/`HTMLSelectElement`), plus `sessionStorage`/`localStorage`. Nothing about
// navigation/focus/keyboard is bridged — this surface never touches any of that. Not reusable from
// `../client/dom-test-setup.ts`: that file deliberately bridges only `document`/`Event` for
// `ensureStylesheetsLoaded`'s own narrower surface, and adding `FormData`/Storage there for this
// file's sake would widen a shared fixture for a concern only this directory's tests have.
import { Window } from 'happy-dom'

// `navigation.disableMainFrameNavigation` — off by default in happy-dom itself, but a real
// `<form>`'s `submit` event, dispatched with no `preventDefault()` call anywhere in the code under
// test (this module deliberately never intercepts the actual submission, only reacts to it), would
// otherwise let happy-dom attempt its OWN internal async navigation — the same class of `deno test`
// crash `../client/dom-test-setup.ts`'s own identical setting already guards against for a real
// `<a href>` click, confirmed there first.
const dom = new Window({ settings: { navigation: { disableMainFrameNavigation: true } } })
// deno-lint-ignore no-explicit-any
const globals = globalThis as any
globals.document = dom.document
globals.Event = dom.Event
globals.FormData = dom.FormData
globals.HTMLFormElement = dom.HTMLFormElement
globals.HTMLInputElement = dom.HTMLInputElement
globals.HTMLTextAreaElement = dom.HTMLTextAreaElement
globals.HTMLSelectElement = dom.HTMLSelectElement
globals.sessionStorage = dom.sessionStorage
globals.localStorage = dom.localStorage

/** Removes every node `document.body` accumulated during a test and clears both storage backends
 * — called between tests so one test's form/draft never leaks into the next. */
export function resetDom(): void {
  dom.document.body.innerHTML = ''
  dom.sessionStorage.clear()
  dom.localStorage.clear()
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
