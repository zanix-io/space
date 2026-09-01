import type { GuardContext, HandlerContext } from '@zanix/server'
import { GUARD_BLOCKED_HEADERS_LOCALS_KEY, GUARD_HEADERS_LOCALS_KEY } from '@zanix/server'
import type { CspDirectives } from '../middleware/csp-guard.ts'
import { CSP_NONCE_LOCALS_KEY, cspGuard } from '../middleware/csp-guard.ts'
import type { SecurityHeadersOptions } from '../middleware/security-headers-guard.ts'
import {
  SECURITY_HEADER_NAMES,
  securityHeadersGuard,
} from '../middleware/security-headers-guard.ts'
import type { PageHeaderOptions } from './space-page-controller.ts'

/**
 * Resolving a page's response security headers — the default CSP, and the three-tier merge between
 * a page's own `headers`, whatever guards contributed, and Space's built-in defaults.
 *
 * Its own module because the page controller had grown past what one file should hold, and this is
 * the most self-contained thing in it: nothing here knows about rendering, loaders or actions.
 *
 * @module
 */

/** `Page()`'s own default CSP, applied whenever `headers.csp` is left unset — nonce-based (not
 * `'unsafe-inline'`) specifically so it doesn't conflict with `renderToResponse`'s own inline
 * initial-state script; see `cspGuard`'s nonce-generating form for how the two stay in sync.
 * `style-src` carries the SAME nonce for the exact same reason, one layer over: it's what lets
 * `defineSpaceApp({ theme: { resolve } })`'s own resolved `<style nonce>` block (`theme/mod.ts`)
 * survive this default policy — unconditional, even for an app that never configures `theme`, since
 * an unused nonce permission is inert (no `<style>` tag is ever rendered to use it) and 'self' adds
 * nothing `default-src 'self'` didn't already imply. A page/guard supplying its OWN CSP (replacing
 * this default entirely, per `PageOptions.headers`'s own precedence doc) must grant its own
 * `style-src` + matching nonce if it wants a resolved theme override to keep applying — same
 * disclosure already required of a custom policy that restricts `script-src`. */
const DEFAULT_CSP_DIRECTIVES = (nonce: string): CspDirectives => ({
  'default-src': ["'self'"],
  'script-src': ["'self'", `'nonce-${nonce}'`],
  'style-src': ["'self'", `'nonce-${nonce}'`],
})

/**
 * Applies this page's `headers` choice to `ctx`/the eventual response — calls
 * `cspGuard`/`securityHeadersGuard` as plain functions, deliberately NOT via `@Guard`/
 * `registerGlobalGuard`: those require a real TC39 decorator `context` to know they're registering
 * a class-level guard, which `Page()` (an imperative call, not `@Guard` class-decorator syntax)
 * never has — see `registerPage`'s own doc in `page-decorator.ts` for the full explanation. A guard
 * is, at the end of the day, just a plain function; nothing about calling it directly is unusual.
 *
 * **Every security header this function can produce — CSP included — resolves through the SAME
 * three-tier chain: this page's own explicit config (including `false`) > a guard registered via
 * `defineMiddleware`/`@Guard` (`cspGuard()`/`securityHeadersGuard()`) > this page's own zero-config
 * default.** Tiers 1 and 3 are resolved entirely here, inside this function; tier 2 is resolved by
 * `@zanix/server`'s own `mainInterceptor`, which this function only ever DEFERS to — never
 * duplicates. The real problem this solves: `mainInterceptor`'s own
 * merge can only tell "the response already has this header" from "it doesn't" — a plain boolean,
 * not enough to express three tiers. Without the extra signals below, this page's own zero-config
 * defaults (values nobody actually asked for — CSP's nonce-based policy exists purely so hydration
 * never breaks; `frameOptions`/`referrerPolicy`/`noSniff`'s exist purely as safe, standard baselines)
 * would ALWAYS count as "already set" by the time that merge runs, permanently starving a
 * guard-registered value of the one case it's meant to cover — a page that configured nothing at
 * all. Two signals, read/written via `ctx.locals` so `@zanix/server` itself never has to know
 * anything CSP- or security-header-specific:
 * - **Read**: `ctx.locals[GUARD_HEADERS_LOCALS_KEY]` (the SAME fully-accumulated guard `Headers`
 *   instance `mainInterceptor` will itself merge afterward) tells this function, BEFORE it builds
 *   its own response, whether a guard already has an answer for a given header — letting it step
 *   aside instead of silently pre-empting it.
 * - **Write**: `ctx.locals[GUARD_BLOCKED_HEADERS_LOCALS_KEY]` (a plain `Set<string>` of lowercased
 *   header names) tells `mainInterceptor`, AFTER this function returns, to never fill a given header
 *   from the guard even though this function's own response doesn't have it either — the one case
 *   `GUARD_HEADERS_LOCALS_KEY` alone can't express: this page explicitly disabling a header (`false`)
 *   must win even over a guard's own value, ending with NO header at all, not an empty one — an
 *   absent header is exactly what the merge already reads as "please fill this from the guard," so
 *   silence alone can't communicate "and don't you dare fill it either."
 *
 * Returns the headers to merge into the response, and the nonce (if any) to forward to
 * `renderToResponse`. `headers: false` skips everything (CSP included) for this page.
 */
export async function applySecurityGuards(
  ctx: HandlerContext,
  headers: PageHeaderOptions | false | undefined,
): Promise<{ headers: Record<string, string>; nonce: string | undefined }> {
  if (headers === false) return { headers: {}, nonce: undefined }

  const { csp, ...securityHeaderOptions } = headers ?? {}
  const merged: Record<string, string> = {}
  const blocked = new Set<string>()

  const guardHeaders = ctx.locals[GUARD_HEADERS_LOCALS_KEY] as Headers | undefined
  const guardHasCsp = guardHeaders?.has('content-security-policy') ?? false

  // `cspGuard` only ever reads `ctx.locals` — a plain `HandlerContext` already satisfies that, the
  // extra `GuardContext` fields (interactors/providers/connectors) are never touched. It's actually
  // synchronous, but `MiddlewareGuard`'s own type allows an async implementation too, so every call
  // below awaits rather than assuming.
  if (csp === false) {
    // Explicit opt-out — must win outright, even over a guard's own CSP. `blocked` is what makes
    // `mainInterceptor` skip the guard's value entirely, rather than filling the gap with it —
    // see this function's own doc for why silence alone (no CSP key in `merged`) isn't enough.
    // Skipped entirely when no guard has a CSP to begin with (nothing to block), which is exactly
    // why the existing `{ csp: false }` unit tests — none of which run through a real guard
    // pipeline — still see a fully absent header, unaffected by any of this.
    if (guardHasCsp) blocked.add('content-security-policy')
  } else if (csp !== undefined) {
    // Explicitly configured — by this page's own `Page({ headers })`, or by `defineSpaceApp`'s own
    // app-wide default (already resolved into `headers` by `resolvePageHeaders` before this
    // function ever runs) — always wins outright, unconditionally, same as before this change.
    const { headers: cspHeaders } = await cspGuard(csp)(ctx as GuardContext)
    Object.assign(merged, cspHeaders)
  } else if (!guardHasCsp) {
    // Nothing configured anywhere, AND no guard has an answer either — this page's own zero-config
    // default is the last resort, same as before this change.
    const { headers: cspHeaders } = await cspGuard(DEFAULT_CSP_DIRECTIVES)(ctx as GuardContext)
    Object.assign(merged, cspHeaders)
  }
  // else (csp === undefined && guardHasCsp): deliberately sets nothing here — `merged` simply has
  // no CSP key, so `mainInterceptor`'s own merge fills it in from the SAME guard headers this
  // function just read, once this response reaches it.

  // Every OTHER security header `securityHeadersGuard` can produce goes through the exact same
  // three-tier chain, generalized: for a field this page didn't mention at all, suppress this
  // page's own default for it (force `false`) whenever a guard already has an answer for its real
  // header name — `securityHeadersGuard`'s own default never gets computed, so `mainInterceptor`'s
  // merge fills the gap from the guard instead. For a field this page explicitly disabled, block
  // the guard too, the same way CSP does above. A field this page explicitly configured is left
  // completely untouched — it flows into `securityHeadersGuard` exactly as declared, unconditionally
  // winning, same as always.
  const effectiveSecurityOptions: Record<string, unknown> = { ...securityHeaderOptions }
  for (
    const field of Object.keys(SECURITY_HEADER_NAMES) as (keyof SecurityHeadersOptions)[]
  ) {
    const headerName = SECURITY_HEADER_NAMES[field].toLowerCase()
    const guardHasField = guardHeaders?.has(headerName) ?? false
    const explicitValue = securityHeaderOptions[field]

    if (explicitValue === false) {
      if (guardHasField) blocked.add(headerName)
    } else if (explicitValue === undefined && guardHasField) {
      effectiveSecurityOptions[field] = false
    }
  }

  const { headers: securityHeaders } = await securityHeadersGuard(
    effectiveSecurityOptions as SecurityHeadersOptions,
  )(
    ctx as GuardContext,
  )
  Object.assign(merged, securityHeaders)

  if (blocked.size > 0) ctx.locals[GUARD_BLOCKED_HEADERS_LOCALS_KEY] = blocked

  return {
    headers: merged,
    nonce: ctx.locals[CSP_NONCE_LOCALS_KEY] as string | undefined,
  }
}
