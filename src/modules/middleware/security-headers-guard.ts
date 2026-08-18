import type { MiddlewareGuard } from '@zanix/server'

/** Options for {@linkcode securityHeadersGuard} — each field is a real, standalone response header;
 * `false` omits that header entirely. */
export type SecurityHeadersOptions = {
  /** `X-Frame-Options`. `false` to omit. @default 'SAMEORIGIN' */
  frameOptions?: 'DENY' | 'SAMEORIGIN' | false
  /** `Referrer-Policy`. `false` to omit. @default 'strict-origin-when-cross-origin' */
  referrerPolicy?: string | false
  /** `X-Content-Type-Options: nosniff`. `false` to omit. @default true */
  noSniff?: boolean
  /** `Permissions-Policy`, keyed by feature (e.g. `{ camera: [] }` disallows it entirely,
   * `{ geolocation: ["'self'"] }` restricts it to same-origin). Omitted by default — most apps
   * don't need to restrict browser features beyond the platform's own defaults. */
  permissionsPolicy?: Record<string, string[]> | false
  /** `Strict-Transport-Security`. **Not enabled by default** — HSTS applied while the app is still
   * served over plain HTTP anywhere (a common case in local dev) can lock a browser out of that
   * domain over HTTP for the full `max-age` duration. Opt in only once the app is served over HTTPS
   * everywhere it's reachable. */
  strictTransportSecurity?: string | false
  /** `Cross-Origin-Opener-Policy`. **Not enabled by default** — `'same-origin'` cuts off
   * `window.opener` access from cross-origin popups (breaks some OAuth/payment popup flows unless
   * they're updated to `postMessage`-based communication). Needed, alongside
   * `crossOriginEmbedderPolicy`, for cross-origin isolation (`SharedArrayBuffer`, precise timers). */
  crossOriginOpenerPolicy?:
    | 'unsafe-none'
    | 'same-origin-allow-popups'
    | 'same-origin'
    | false
  /** `Cross-Origin-Embedder-Policy`. **Not enabled by default** — `'require-corp'`/`'credentialless'`
   * block loading any cross-origin resource (images, scripts, iframes) that doesn't itself send a
   * matching CORP/CORS header, which breaks plenty of ordinary third-party embeds. Needed, alongside
   * `crossOriginOpenerPolicy`, for cross-origin isolation. */
  crossOriginEmbedderPolicy?:
    | 'unsafe-none'
    | 'require-corp'
    | 'credentialless'
    | false
  /** `Cross-Origin-Resource-Policy`. **Not enabled by default** — restricts which sites may load
   * this page's own resources cross-origin; `'same-origin'` breaks legitimate cross-origin embedding
   * of this app's own assets if that's ever needed. `'same-site'` is the safer opt-in starting point. */
  crossOriginResourcePolicy?:
    | 'same-site'
    | 'same-origin'
    | 'cross-origin'
    | false
}

/**
 * Maps each {@linkcode SecurityHeadersOptions} field to the real HTTP header name it controls —
 * the single source of truth {@linkcode securityHeadersGuard} itself builds from below, and the
 * same names `SpacePageController`'s own `applySecurityGuards` needs to check a guard's
 * `Headers` for (see that function's own doc) when resolving `Page explicit > Guard > Space
 * default` for each of these fields, not just CSP. Exported specifically so that cross-cutting
 * logic never has to duplicate this mapping — there's exactly one place it's declared.
 */
export const SECURITY_HEADER_NAMES: Record<keyof SecurityHeadersOptions, string> = {
  frameOptions: 'X-Frame-Options',
  referrerPolicy: 'Referrer-Policy',
  noSniff: 'X-Content-Type-Options',
  permissionsPolicy: 'Permissions-Policy',
  strictTransportSecurity: 'Strict-Transport-Security',
  crossOriginOpenerPolicy: 'Cross-Origin-Opener-Policy',
  crossOriginEmbedderPolicy: 'Cross-Origin-Embedder-Policy',
  crossOriginResourcePolicy: 'Cross-Origin-Resource-Policy',
}

function serializePermissionsPolicy(policy: Record<string, string[]>): string {
  return Object.entries(policy)
    .map(([feature, allowlist]) => `${feature}=(${allowlist.join(' ')})`)
    .join(', ')
}

/**
 * Builds a `MiddlewareGuard` that sets a small set of common security response headers —
 * `X-Frame-Options`, `Referrer-Policy`, and `X-Content-Type-Options` by default, plus
 * `Permissions-Policy`/`Strict-Transport-Security` when explicitly configured. Real, standalone
 * code: neither `@zanix/server` nor `@zanix/auth` ship anything for these today (same finding as
 * {@linkcode cspGuard}'s own doc).
 *
 * The header set is computed once, at call time, and reused for every request.
 *
 * @example
 * ```ts
 * import { defineMiddleware, securityHeadersGuard } from '@zanix/space'
 *
 * defineMiddleware([securityHeadersGuard()]) // the three safe defaults, nothing else
 * defineMiddleware([securityHeadersGuard({ frameOptions: 'DENY' })]) // override just one
 * ```
 */
export function securityHeadersGuard(
  options: SecurityHeadersOptions = {},
): MiddlewareGuard {
  const {
    frameOptions = 'SAMEORIGIN',
    referrerPolicy = 'strict-origin-when-cross-origin',
    noSniff = true,
    permissionsPolicy = false,
    strictTransportSecurity = false,
    crossOriginOpenerPolicy = false,
    crossOriginEmbedderPolicy = false,
    crossOriginResourcePolicy = false,
  } = options

  const headers: Record<string, string> = {}
  if (frameOptions) headers[SECURITY_HEADER_NAMES.frameOptions] = frameOptions
  if (referrerPolicy) headers[SECURITY_HEADER_NAMES.referrerPolicy] = referrerPolicy
  if (noSniff) headers[SECURITY_HEADER_NAMES.noSniff] = 'nosniff'
  if (permissionsPolicy) {
    headers[SECURITY_HEADER_NAMES.permissionsPolicy] = serializePermissionsPolicy(
      permissionsPolicy,
    )
  }
  if (strictTransportSecurity) {
    headers[SECURITY_HEADER_NAMES.strictTransportSecurity] = strictTransportSecurity
  }
  if (crossOriginOpenerPolicy) {
    headers[SECURITY_HEADER_NAMES.crossOriginOpenerPolicy] = crossOriginOpenerPolicy
  }
  if (crossOriginEmbedderPolicy) {
    headers[SECURITY_HEADER_NAMES.crossOriginEmbedderPolicy] = crossOriginEmbedderPolicy
  }
  if (crossOriginResourcePolicy) {
    headers[SECURITY_HEADER_NAMES.crossOriginResourcePolicy] = crossOriginResourcePolicy
  }

  return () => ({ headers })
}
