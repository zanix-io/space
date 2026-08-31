/**
 * Whether this app's own BUILT-IN fallback (`DefaultErrorView`/`DefaultNotFoundView`) — reached
 * only when a route declares no `error.tsx`/`not-found.tsx` of its own — renders a real HTML
 * document or a plain JSON body instead. `defineSpaceApp({ errorResponse })`'s own value.
 *
 * Deliberately its own tiny, zero-dependency module, same reasoning `active-renderer.ts`'s own
 * doc gives for keeping THAT flag isolated too.
 *
 * Never touches an app's OWN `error.tsx`/`not-found.tsx` — a route that declares one has already
 * made an explicit choice to render a real page, regardless of this flag: this only decides what
 * happens when it declared none at all.
 *
 * @module
 */

/** `'view'` (the default, unchanged behavior) renders the built-in HTML fallback view. `'json'`
 * returns a plain JSON body instead — for an app that never wants to serve a rendered HTML page
 * at all (a pure API/backend built on `@zanix/space` for its routing, never its own document
 * shell). */
export type ErrorResponseFormat = 'view' | 'json'

let errorResponseFormat: ErrorResponseFormat = 'view'

/** Set once by `defineSpaceApp({ errorResponse })`'s own eager assignment — never by a page
 * author, and never per-request: this is a whole-app decision, not something one route can
 * override for itself (an app wanting per-route control writes its own `error.tsx`/
 * `not-found.tsx` instead, which always wins over either format here). */
export function setErrorResponseFormat(format: ErrorResponseFormat | undefined): void {
  errorResponseFormat = format ?? 'view'
}

/**
 * Read by `loader-error-handler.ts`/`not-found-handler.ts` — the data-phase (`loader`) error
 * fallback and the not-found fallback, the only two places this package's own built-in view is
 * reached with a real chance to decide the response BEFORE anything is sent: neither has started
 * rendering yet when this is checked.
 *
 * Deliberately NOT read by `render-page-react.tsx`'s/`render-page-preact.ts`'s own render-phase
 * "no error.tsx anywhere" fallback (`DefaultErrorView`, wrapped in proactively, before any
 * particular request is known to fail) — React's own response has typically already started
 * streaming as `text/html` by the time a component actually throws, with no way to retroactively
 * become a JSON response instead; keeping the render-phase fallback format-independent (always
 * HTML) is what keeps its behavior identical and predictable across both renderers, rather than
 * working for one and silently not for the other.
 */
export function getErrorResponseFormat(): ErrorResponseFormat {
  return errorResponseFormat
}
