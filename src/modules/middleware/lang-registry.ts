/**
 * What `langPreHandler` knows about an app's own i18n routing, captured eagerly so something
 * outside its own request-handling closure can read it back — specifically
 * `deriveAutoSitemapEntries` (`modules/bundler/auto-sitemap.ts`), which needs `availableLangs` to
 * treat a `:lang`-only dynamic route as an enumerable, expandable one rather than excluding it the
 * way a database-backed dynamic segment (`:id`) always is.
 *
 * Internal to this package — nothing outside `@zanix/space` reads or writes this directly, unlike
 * `getSitemapDeclaration` (which `@zanix/cli`'s own build/dev validation needs). Not exported from
 * this package's public entry points.
 *
 * @module
 */

/** What `langPreHandler(options)` captures about itself, at construction time. */
export type LangRegistration = {
  /** Same `availableLangs` the app's own `langPreHandler({ availableLangs })` call declared. */
  availableLangs: string[]
  /** Same `paramName` `langPreHandler({ paramName })` resolved to (its own `'lang'` default,
   * already applied by the caller — this registry never re-applies a default of its own). */
  paramName: string
  /** Same `defaultLang` the app's own `langPreHandler({ defaultLang })` call declared — read by
   * `resolveRequestLang` (`lang-pre-handler.ts`) to resolve a language for a request with NO
   * matched route at all (a genuine 404), the one case that can't fall back to a route param the
   * way `error.tsx`'s `ErrorBoundaryProps.params` already can. */
  defaultLang: string
  /** Same `cookieName` the app's own `langPreHandler({ cookieName })` resolved to (its own
   * `'X-Znx-Lang'` default, already applied by the caller) — read by `resolveRequestLang` for the
   * same reason as `defaultLang` above. */
  cookieName: string
}

let registration: LangRegistration | undefined

/** Called once, by `langPreHandler` itself, the moment it's invoked — the same eager timing
 * `setSitemapDeclaration`/`setValidationConfig` already use for a value `zanix space build`/
 * `zanix space dev` need before `activateApps()`/`setup()` ever runs. */
export function setLangRegistration(value: LangRegistration | undefined): void {
  registration = value
}

/** The current registration, or `undefined` when no `langPreHandler(...)` call has run yet in
 * this process — the common case for an app with no i18n routing at all. */
export function getLangRegistration(): LangRegistration | undefined {
  return registration
}
