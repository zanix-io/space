import type { GuardContext, MiddlewareGuard } from '@zanix/server'
import { getRequestFromError } from '@zanix/server'
import { HttpError } from '@zanix/errors'
import { assertZnxCookieName, SESSION_COOKIE_ATTRIBUTES } from '@zanix/helpers'
import { CSRF_FORM_FIELD } from './csrf-form-field.ts'

/** The `ctx.locals` key {@linkcode csrfGuard} stashes the current request's CSRF token under —
 * `SpacePageController` reads this back into `PageContext.csrfToken` automatically. */
export const CSRF_TOKEN_LOCALS_KEY = 'csrfToken'

/** Internal error code {@linkcode csrfGuard} sets on its own thrown `HttpError` —
 * {@linkcode redirectCsrfFailure} matches on THIS, never the bare `status.code` (`'FORBIDDEN'`)
 * alone, since a page's own `action` can throw its own unrelated `FORBIDDEN` for a real business
 * reason (a permission check, a business-rule rejection) that a generic recovery handler must
 * never swallow as if it were a stale token. */
export const CSRF_TOKEN_INVALID_CODE = 'CSRF_TOKEN_INVALID'

/** Options for {@linkcode csrfGuard}. */
export type CsrfGuardOptions = {
  /**
   * Name of the cookie carrying the token. **Must start with `X-Znx-` and contain `Csrf`** —
   * enforced at construction via `@zanix/utils`'s `assertZnxCookieName` (throws `ApplicationError`),
   * not just documented: `@zanix/server`'s own `cookiesGuard` populates `ctx.cookies` with only
   * cookies matching the `X-Znx-` prefix, filtering everything else out before any guard (this one
   * included) ever runs; and `@zanix/utils`'s own sensitive-key redaction pattern recognizes a Csrf
   * cookie by looking for that word in the key name, so a customized name dropping it would silently
   * stop being redacted from logs.
   * @default 'X-Znx-Csrf'
   */
  cookieName?: string
  /**
   * Header a non-form (fetch/XHR) action can send the token back on, as an alternative to the
   * `_csrf` form field. `X-Znx-`-prefixed by default, same as every other framework-owned
   * header/cookie in the ecosystem — but unlike `cookieName`, a custom value here is never
   * validated: `@zanix/server`'s `cookiesGuard` only filters `ctx.cookies`, never arbitrary request
   * headers, so there's no equivalent silent-drop risk a runtime assert would need to catch. A
   * misconfigured `headerName` fails loudly instead (every non-safe request gets rejected as a
   * missing/invalid token), the same way any other functional misconfiguration would.
   * @default 'X-Znx-Csrf-Token'
   */
  headerName?: string
}

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS'])

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '')
}

async function readFormField(ctx: GuardContext): Promise<string | undefined> {
  const contentType = ctx.req.headers.get('content-type') ?? ''
  if (!contentType.includes('form')) return undefined

  // `@zanix/server` already consumes the request body while parsing it for
  // `application/x-www-form-urlencoded` — the exact content type a real, no-JS
  // `<form method="post">` submits, and the primary case this function exists for — leaving
  // `ctx.payload.body` as the already-parsed `FormData` instead (same reason
  // `SpacePageController.handlePost` reads from there rather than the request itself; see that
  // method's own doc). `ctx.req.clone().formData()` throws `TypeError: Body is unusable` for this
  // content type by the time any guard runs — a real, confirmed bug this replaces (the previous
  // version's own comment had this backwards: it assumed avoiding `multipart/form-data` made
  // cloning safe, when `x-www-form-urlencoded` is precisely the content type that's already
  // consumed). Only genuinely untouched `multipart/form-data` (which `@zanix/server` never
  // pre-parses) still needs, and is still safe for, the clone-and-read fallback below.
  if (ctx.payload.body instanceof FormData) {
    const value = ctx.payload.body.get(CSRF_FORM_FIELD)
    return typeof value === 'string' ? value : undefined
  }

  try {
    const value = (await ctx.req.clone().formData()).get(CSRF_FORM_FIELD)
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Builds a `MiddlewareGuard` implementing the double-submit-cookie CSRF pattern — real, standalone
 * code; nothing exists elsewhere in the ecosystem to reuse for this specifically. On a safe request
 * (`GET`/`HEAD`/`OPTIONS`), issues (or reuses) a token: sets it as an `HttpOnly` cookie, and stashes
 * it in `ctx.locals[CSRF_TOKEN_LOCALS_KEY]` — `SpacePageController` reads this back automatically
 * into `PageContext.csrfToken`, so a page's `loader` can hand it to `component` to render as a
 * hidden form field:
 *
 * ```tsx
 * loader = (ctx) => ({ csrfToken: ctx.csrfToken })
 * component = ({ csrfToken }) => (
 *   <form method="post">
 *     <input type="hidden" name="_csrf" value={csrfToken} />
 *   </form>
 * )
 * ```
 *
 * On any other method, the request is rejected (`HttpError('FORBIDDEN')`) unless the submitted
 * token — that same `_csrf` form field, or the `X-Znx-Csrf-Token` header for a fetch/XHR-based
 * action — matches the cookie. The cookie being `HttpOnly` doesn't defeat this: the token reaches
 * the page through server-rendered HTML (`ctx.locals`/`PageContext.csrfToken`), never by reading
 * the cookie from client-side JS, so nothing needs to read it back except the browser re-sending
 * it and this guard comparing it.
 *
 * **Not applied by default** by `Page()`, unlike `cspGuard`/`securityHeadersGuard` — those are
 * purely additive response headers that never change whether a request succeeds; this guard can
 * reject a real request outright, so turning it on for every page automatically would silently
 * break any existing `action` that doesn't yet render the token field. Opt in explicitly via
 * `@Guard(csrfGuard())` on a page, or `defineMiddleware([csrfGuard()])` for every page at once.
 * `@zanix/auth`'s own session cookies already default to `SameSite=Strict`, which mitigates most
 * classic CSRF on its own — this guard is real defense-in-depth on top of that, or a substitute for
 * apps not using `@zanix/auth`'s cookies at all.
 */
export function csrfGuard(options: CsrfGuardOptions = {}): MiddlewareGuard {
  const cookieName = options.cookieName ?? 'X-Znx-Csrf'
  const headerName = options.headerName ?? 'X-Znx-Csrf-Token'
  assertZnxCookieName(cookieName, 'csrfGuard', 'Csrf')

  return async (ctx: GuardContext) => {
    const existingToken = ctx.cookies[cookieName]

    if (SAFE_METHODS.has(ctx.req.method)) {
      const token = existingToken ?? generateToken()
      ctx.locals[CSRF_TOKEN_LOCALS_KEY] = token
      if (existingToken) return {}
      return {
        headers: {
          'Set-Cookie': `${cookieName}=${token}; ${SESSION_COOKIE_ATTRIBUTES}`,
        },
      }
    }

    const submitted = ctx.req.headers.get(headerName) ??
      (await readFormField(ctx))
    if (!existingToken || submitted !== existingToken) {
      throw new HttpError('FORBIDDEN', {
        id: ctx.id,
        code: CSRF_TOKEN_INVALID_CODE,
        message: 'Missing or invalid CSRF token',
        meta: { source: 'zanix' },
      })
    }
    return {}
  }
}

/**
 * Builds a `ComposableErrorHandler` (`globalErrorHandler`, this package's own composer) that turns
 * {@linkcode csrfGuard}'s own rejection into a redirect back to the SAME url, as a fresh `GET`,
 * instead of `@zanix/server`'s generic JSON error response reaching what a browser navigation
 * expects to be a full HTML page. Real, confirmed gap this closes: unlike `createNotFoundHandler()`'s
 * own 404 recovery or `@zanix/auth`'s own `recoverRotatedSessionCookie`, a `csrfGuard` rejection had
 * NO recovery handler anywhere in the ecosystem — every app wiring `@Guard(csrfGuard())` onto a real
 * page was exposed to this raw JSON leak the moment a submitted token actually went stale (a
 * browser back-button resubmission, a second tab, a cookie cleared between page load and submit),
 * with no documented way to avoid it.
 *
 * A fresh `GET` to the same url re-issues a new token via `csrfGuard` itself (see its own doc for
 * the safe-request branch) — the visitor lands back on the same form, ready to resubmit, with
 * nothing lost and nothing to explain beyond "try again."
 *
 * Declines (`undefined`) for anything that isn't `csrfGuard`'s own specific rejection (checked via
 * {@linkcode CSRF_TOKEN_INVALID_CODE}), or that arrives with no request attached
 * (`server.ssr.attachRequestToErrors: true` required, same as `createNotFoundHandler`/any other
 * request-reading recovery handler in this ecosystem) — composes safely with the rest of a
 * `globalErrorHandler(...)` chain regardless of order.
 *
 * @returns A handler shaped `(error: unknown) => Response | undefined` — pass it to
 * `globalErrorHandler` alongside any other recovery handlers this app needs.
 *
 * @example
 * ```ts
 * import { createNotFoundHandler, globalErrorHandler, redirectCsrfFailure } from '@zanix/space'
 *
 * await bootstrapRemoteApp(spaceApp, {
 *   server: {
 *     ssr: {
 *       onError: globalErrorHandler(redirectCsrfFailure(), createNotFoundHandler()),
 *       attachRequestToErrors: true,
 *     },
 *   },
 * })
 * ```
 */
export function redirectCsrfFailure(): (error: unknown) => Response | undefined {
  return (error: unknown) => {
    if (!(error instanceof HttpError) || error.code !== CSRF_TOKEN_INVALID_CODE) return undefined
    const request = getRequestFromError(error)
    if (!request) return undefined

    return new Response(null, { status: 302, headers: { location: request.url } })
  }
}
