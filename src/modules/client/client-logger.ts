/// <reference lib="dom" />
/**
 * The one shared, browser-safe `Logger` instance every client-bundled module in this package logs
 * through — the React and Preact hydrate-comets modules (`comet-persistence.ts` too) all import
 * THIS module instead of `@zanix/logger` (the server package) directly. Importing `@zanix/logger` from
 * a browser bundle used to pull in `WorkerManager`/`Deno.readTextFile` — exactly the defect
 * `@zanix/utils@3.1.0`'s `createClientLogger` fixes, by giving a browser client its own entry
 * point (`@zanix/logger/client`, i.e. `@zanix/utils/logger/client`) that never reaches that file —
 * see that function's own doc for the mechanism.
 *
 * A SINGLE shared instance, not one `createClientLogger()` call per importing file — each call
 * constructs a fresh `Logger`, and its constructor does `Object.assign(globalThis, { logger: this
 * })` by default; three independent instances racing to own `globalThis.logger` would be wasteful
 * and would leave whichever ran last as the "real" `globalThis.logger`, silently orphaning the
 * calls already made through either of the other two.
 *
 * Every formatted log entry is POSTed to this app's own `POST /api/log` route (registered by
 * `modules/log-api/controllers/log.controller.ts`), which relays it into the server's own
 * `Logger#ingest` — see that module's own doc for the exact request/response contract this
 * fetcher and that route agree on. Doesn't tag the request with an `origin` itself: this module
 * IS always the browser client, so `Logger#ingest`'s own `'client'` default already covers it —
 * asserting the same fact again here would just duplicate that default in a second place.
 *
 * Deliberately NOT re-exported from `modules/client/mod.ts`/`mod-preact.ts` — an internal
 * implementation detail these three files share, not a public API of its own.
 *
 * @module
 */
import { createClientLogger } from '@zanix/logger/client'
import type { BaseFormattedLog, Logger } from '@zanix/logger/client'

/**
 * POSTs one already-formatted log entry to this app's own `/api/log` relay route as-is — no
 * `origin` tagging here (see this module's own top-level doc for why: `Logger#ingest`'s own
 * `'client'` default already covers it). Never throws — a logging call must never be what breaks
 * the page — a failed request (offline, the route not registered, ...) is swallowed silently; a
 * client-side observability gap in that case is an accepted trade-off, not a defect this function
 * tries to solve.
 */
function postLog(fmtLog: BaseFormattedLog): void {
  fetch('/api/log', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fmtLog),
  }).catch(() => {})
}

/** The shared browser-safe logger every client-bundled module in this package imports instead of
 * `@zanix/logger` directly. See this module's own top-level doc. */
const logger: Logger = createClientLogger(postLog)

export default logger
