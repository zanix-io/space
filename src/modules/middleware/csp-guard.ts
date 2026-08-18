import type { GuardContext, MiddlewareGuard } from '@zanix/server'

/**
 * A `Content-Security-Policy` directive's value: `true` to include the directive with no value
 * (e.g. `upgrade-insecure-requests`), `false` to omit it, or one/many sources (e.g. `"'self'"`,
 * `'data:'`, a hostname).
 */
export type CspDirectiveValue = boolean | string | string[]

/** A `Content-Security-Policy` policy, keyed by directive name (e.g. `'default-src'`,
 * `'script-src'`, `'img-src'`) — see the MDN CSP reference for the full directive list. */
export type CspDirectives = Record<string, CspDirectiveValue>

/**
 * The `ctx.locals` key {@linkcode cspGuard}'s nonce-generating form stashes its per-request nonce
 * under. `SpacePageController` reads this back and forwards it to `renderToResponse({ nonce })` so
 * React's own inline scripts (the initial-state block) carry a matching `nonce` attribute — an app
 * never needs to read this key itself unless it renders outside `SpacePageController` entirely.
 */
export const CSP_NONCE_LOCALS_KEY = 'cspNonce'

function serializeCsp(directives: CspDirectives): string {
  return Object.entries(directives)
    .map(([directive, value]) => {
      if (value === false) return undefined
      if (value === true) return directive
      const sources = Array.isArray(value) ? value.join(' ') : value
      return `${directive} ${sources}`
    })
    .filter((part): part is string => part !== undefined)
    .join('; ')
}

/** A fresh, cryptographically random nonce, base64-encoded (the conventional CSP nonce format). */
function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
}

/**
 * Builds a `MiddlewareGuard` that sets the `Content-Security-Policy` response header — a real
 * implementation, not a wrapper: `@zanix/server`/`@zanix/auth` ship no CSP guard of their own to
 * reuse (unlike rate limiting, see `@zanix/auth`'s `rateLimitGuard`).
 *
 * Two forms:
 * - **Static** (`cspGuard({ 'default-src': ["'self'"] })`) — the header value is computed once, at
 *   call time, and reused for every request; a policy's directives don't vary per request, so
 *   there's no reason to rebuild the string on each one.
 * - **Nonce-based** (`cspGuard((nonce) => ({ 'script-src': ["'self'", "'nonce-" + nonce + "'"] }))`)
 *   — a fresh, cryptographically random nonce is generated PER REQUEST, stashed on
 *   `ctx.locals[CSP_NONCE_LOCALS_KEY]`, and handed to the callback to build that request's
 *   directives. This is the form `Page()`'s own default CSP uses (see its own doc) — it's what
 *   lets a strict `script-src` coexist with the inline initial-state script `renderToResponse`
 *   always emits, without weakening the policy via `'unsafe-inline'`.
 *
 * There is no default policy in either form: an empty/omitted `directives` object would produce an
 * empty header, which is almost certainly not what's intended — declare the actual policy explicitly.
 *
 * **Acts as the app-wide base/default, not an override**: a page's own `Page({ headers: { csp } })`
 * (including `csp: false`) always wins over this when configured, and — when NEITHER this page NOR
 * this guard configured anything for a given page — that page's own zero-config nonce-based default
 * applies instead. See `PageOptions.headers`'s own doc (`page-decorator.ts`) for the full
 * three-tier precedence rule.
 *
 * @example
 * ```ts
 * import { cspGuard, defineMiddleware } from '@zanix/space'
 *
 * defineMiddleware([
 *   cspGuard({
 *     'default-src': ["'self'"],
 *     'img-src': ["'self'", 'data:'],
 *     'upgrade-insecure-requests': true,
 *   }),
 * ])
 * // Content-Security-Policy: default-src 'self'; img-src 'self' data:; upgrade-insecure-requests
 * ```
 */
export function cspGuard(
  directives: CspDirectives | ((nonce: string) => CspDirectives),
): MiddlewareGuard {
  if (typeof directives !== 'function') {
    const value = serializeCsp(directives)
    return () => ({ headers: { 'Content-Security-Policy': value } })
  }

  const buildDirectives = directives
  return (ctx: GuardContext) => {
    const nonce = generateNonce()
    ctx.locals[CSP_NONCE_LOCALS_KEY] = nonce
    return {
      headers: {
        'Content-Security-Policy': serializeCsp(buildDirectives(nonce)),
      },
    }
  }
}
