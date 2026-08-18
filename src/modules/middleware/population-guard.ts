import type { GuardContext, MiddlewareGuard } from '@zanix/server'

/** The `ctx.locals` key {@linkcode populationGuard} stashes the resolved population id under —
 * `SpacePageController` reads this back into `PageContext.population` automatically. */
export const POPULATION_LOCALS_KEY = 'population'

/** Options for {@linkcode populationGuard}. */
export type PopulationGuardOptions = {
  /** Route param / query string key. @default 'population' */
  paramName?: string
  /**
   * Name of the cookie the resolved population persists to, so a later visit with neither the
   * route param nor the query string still gets the right population from the very first SSR
   * response. **Must start with `X-Znx-`** — `@zanix/server`'s own `cookiesGuard` populates
   * `ctx.cookies` with only cookies matching that prefix, filtering everything else out before any
   * guard (this one included) ever runs; a cookie name outside that prefix would silently never be
   * visible to `ctx.cookies`, no matter what's actually on the wire. Deliberately NOT `HttpOnly`,
   * unlike `csrfGuard`'s own cookie — client-side code is expected to read this one too (e.g. to
   * lazily re-fetch population-specific content after hydration without a full navigation).
   * @default 'X-Znx-Population'
   */
  cookieName?: string
}

/**
 * Builds a `MiddlewareGuard` that resolves which population (segment/tenant variant) the current
 * request is for — route param, then query string, then the persisted cookie, in that order — and
 * stashes it in `ctx.locals[POPULATION_LOCALS_KEY]`. `SpacePageController` reads this back
 * automatically into `PageContext.population`, so a page's `loader` can use it to pick the right
 * content override.
 *
 * Read on the server, unlike the legacy component this replaces (whose cookie fallback only ever
 * ran client-side): `@zanix/space` is SSR-first specifically to avoid a client-side-only
 * personalization step causing a flash of the wrong content after hydration, so leaving population
 * resolution to the client would defeat the entire point of persisting it in a cookie at all. This
 * does mean a population-aware page's SSR response varies per visitor cookie — if a shared HTTP
 * cache ever sits in front of `@zanix/space`, that layer needs `Vary` on this cookie; nothing in
 * `@zanix/space` itself assumes a shared cache exists today.
 *
 * When the resolved value came from the route param or query string and doesn't already match the
 * cookie, the response also sets that cookie (`Set-Cookie`) — closing a gap the legacy version of
 * this left open (there, nothing in that repo ever wrote the cookie its own read side depended on;
 * confirmed by inspection, not assumed).
 *
 * Purely additive — never rejects a request, unlike `csrfGuard`. Not applied by default by
 * `Page()`; opt in via `@Guard(populationGuard())` on a page, or `defineMiddleware([populationGuard()])`
 * for every page at once.
 *
 * @example
 * ```tsx
 * loader = (ctx) => ({ population: ctx.population })
 * ```
 */
export function populationGuard(options: PopulationGuardOptions = {}): MiddlewareGuard {
  const paramName = options.paramName ?? 'population'
  const cookieName = options.cookieName ?? 'X-Znx-Population'

  return (ctx: GuardContext) => {
    const params = ctx.payload.params as Record<string, string> | undefined
    const fromParam = params?.[paramName]
    const fromQuery = ctx.url.searchParams.get(paramName) ?? undefined
    const fromCookie = ctx.cookies[cookieName]

    const resolved = fromParam || fromQuery || fromCookie
    if (!resolved) return {}

    ctx.locals[POPULATION_LOCALS_KEY] = resolved

    const resolvedFromRequest = Boolean(fromParam || fromQuery)
    if (!resolvedFromRequest || fromCookie === resolved) return {}

    return {
      headers: {
        'Set-Cookie': `${cookieName}=${resolved}; Path=/; SameSite=Lax`,
      },
    }
  }
}
