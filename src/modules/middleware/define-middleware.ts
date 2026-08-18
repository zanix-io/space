import type { MiddlewareGlobalGuard, MiddlewareGuard } from '@zanix/server'
import { registerGlobalGuard } from '@zanix/server'

/**
 * Registers one or more guards for every SSR page route in this process — each guard runs after
 * `@zanix/server`'s own CORS/cookie guards and before any page's `loader`/`component` (the exact
 * same guard pipeline REST controllers use, since `@zanix/space` routes are `'ssr'`-type routes
 * over that same mechanism — see `SpacePageController`'s own doc). Reuses `@zanix/server`'s
 * `registerGlobalGuard` as-is, scoped to `server: ['ssr']` — no new guard mechanism of its own.
 *
 * There is no per-`Application` scoping: `@zanix/server`'s guard pipeline is keyed by server type
 * (`'ssr'`, `'rest'`, ...), never by which `Application` registered a route. A guard passed here
 * applies to every `'ssr'` route in the process, regardless of which `Application` owns it. A page
 * that needs a *different* guard than the rest of the app declares its own directly via `@Guard`
 * (or `@zanix/auth`'s `@RateLimitGuard`) on its `SpacePageController` subclass — the same decorators
 * `@zanix/server`/`@zanix/auth` already ship, reused as-is; no `@zanix/space`-specific equivalent.
 *
 * Default is no guard at all — never a guard that silently allows everything, since that would be
 * indistinguishable from "no guard" while giving a false sense of protection. Call this once per
 * guard set (e.g. from the same file as `defineSpaceApp`), not per request.
 *
 * **A `cspGuard()` registered here acts as the app-wide base/default CSP — a page's own
 * `Page({ headers: { csp } })` (including `csp: false`) always wins over it** when configured —
 * see `PageOptions.headers`'s own doc (`page-decorator.ts`) for the full three-tier precedence
 * rule (page's own explicit `csp` > this guard > a page's own zero-config default).
 *
 * @example
 * ```ts
 * import { cspGuard, defineMiddleware } from '@zanix/space'
 * import { rateLimitGuard } from '@zanix/auth'
 *
 * defineMiddleware([
 *   cspGuard({ 'default-src': ["'self'"], 'img-src': ["'self'", 'data:'] }),
 *   rateLimitGuard({ windowSeconds: 60, anonymousLimit: 100 }),
 * ])
 * ```
 */
export function defineMiddleware(guards: MiddlewareGuard[]): void {
  for (const guard of guards) {
    const globalGuard: MiddlewareGlobalGuard = (context, ...args) => guard(context, ...args)
    globalGuard.exports = { server: ['ssr'] }
    registerGlobalGuard(globalGuard)
  }
}
