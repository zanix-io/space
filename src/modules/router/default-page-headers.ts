import type { PageHeaderOptions } from './space-page-controller.tsx'

let defaultHeaders: PageHeaderOptions | false | undefined = undefined

/**
 * Sets the app-wide default for every page's `headers` (CSP + security headers) — used only when a
 * specific page never sets its own (`Page({ headers })`, or a `static headers` on the class, both
 * still take priority over this). Typically called once via `defineSpaceApp({ headers })`, not
 * directly — the same "global default, resolved from whichever setup call configured it" shape
 * `@zanix/utils`'s `setDefaultRedactOptions` already uses for the ecosystem's other cross-cutting
 * default (wired through `@zanix/core`'s `setup.ts`; this one is wired through `defineSpaceApp`
 * instead, since it's specific to `@zanix/space` pages, not a `@zanix/core`-level concern).
 *
 * `false` disables headers app-wide, for every page that doesn't explicitly opt back in with its
 * own `headers`. Never called at all (the default) falls through to `SpacePageController`'s own
 * built-in default — nonce-based CSP plus `securityHeadersGuard`'s own defaults.
 *
 * @example
 * ```ts
 * // space.app.ts
 * import { defineSpaceApp } from '@zanix/space'
 *
 * export default defineSpaceApp({
 *   name: 'storefront',
 *   headers: {
 *     frameOptions: 'DENY',
 *     csp: { 'default-src': ["'self'"], 'img-src': ["'self'", 'https://cdn.example.com'] },
 *   },
 * })
 * // every page now gets this policy unless it sets its own `headers`
 * ```
 */
export function setDefaultPageHeaders(options: PageHeaderOptions | false): void {
  defaultHeaders = options
}

/** Reads the app-wide default currently in effect — `undefined` if `setDefaultPageHeaders` was
 * never called (or `resetDefaultPageHeaders` ran since). Exposed mainly for {@linkcode resolvePageHeaders}
 * — not meant to be read directly by app code. */
export function getDefaultPageHeaders(): PageHeaderOptions | false | undefined {
  return defaultHeaders
}

/** Clears the app-wide default back to unset — test-only. */
export function resetDefaultPageHeaders(): void {
  defaultHeaders = undefined
}

/**
 * Combines a page's own `headers` with the app-wide default, **field by field** — a page
 * overriding just one field (e.g. `static headers = { noSniff: false }`) keeps every OTHER field
 * from the app-wide default, rather than losing them. Without this, resolving the two levels as a
 * plain `pageHeaders ?? appDefault` would silently fall back to `securityHeadersGuard`'s own
 * built-in defaults for every field the page's own object doesn't mention — even ones the app
 * explicitly configured — the moment a page sets *any* field of its own. Confirmed as a real bug
 * during development, not a hypothetical: `{ noSniff: false }` at the page level was making
 * `frameOptions` silently revert to the framework default instead of the app's own `'DENY'`.
 *
 * `false` at the page level always wins outright — that page wants no headers at all, full stop,
 * regardless of what the app configured. `false` at the app level is treated as an empty base when
 * the page still sets its own object (so that page's fields apply on top of nothing, falling back
 * to `securityHeadersGuard`'s own built-in defaults for anything it doesn't mention itself).
 *
 * `csp` is merged as a single field, not merged directive-by-directive within itself — a page that
 * sets its own `csp` replaces the app-wide one entirely; only fields the page's object doesn't
 * mention at all fall through to the app-wide value.
 */
export function resolvePageHeaders(
  pageHeaders: PageHeaderOptions | false | undefined,
): PageHeaderOptions | false | undefined {
  if (pageHeaders === false) return false
  if (pageHeaders === undefined) return defaultHeaders

  const base = typeof defaultHeaders === 'object' ? defaultHeaders : undefined
  return { ...base, ...pageHeaders }
}
