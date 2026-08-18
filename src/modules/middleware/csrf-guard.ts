import type { GuardContext, MiddlewareGuard } from '@zanix/server'
import { HttpError } from '@zanix/errors'

/** The `ctx.locals` key {@linkcode csrfGuard} stashes the current request's CSRF token under —
 * `SpacePageController` reads this back into `PageContext.csrfToken` automatically. */
export const CSRF_TOKEN_LOCALS_KEY = 'csrfToken'

/** Options for {@linkcode csrfGuard}. */
export type CsrfGuardOptions = {
  /**
   * Name of the cookie carrying the token. **Must start with `X-Znx-`** — `@zanix/server`'s own
   * `cookiesGuard` populates `ctx.cookies` with only cookies matching that prefix, filtering
   * everything else out before any guard (this one included) ever runs; a cookie name outside that
   * prefix would silently never be visible to `ctx.cookies`, no matter what's actually on the wire.
   * @default 'X-Znx-Csrf'
   */
  cookieName?: string
  /** Header a non-form (fetch/XHR) action can send the token back on, as an alternative to the
   * `_csrf` form field. @default 'x-csrf-token' */
  headerName?: string
}

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS'])
const FORM_FIELD = '_csrf'

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '')
}

async function readFormField(req: Request): Promise<string | undefined> {
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.includes('form')) return undefined
  try {
    // `req.clone()` so the real handler can still read the body afterward — a `Request` body
    // stream can only be consumed once, and this guard runs before the page's own `action`. Safe
    // here specifically because `@zanix/server` only pre-reads the body itself (into
    // `ctx.payload.body`) for `application/json`/`application/x-www-form-urlencoded`, never for
    // `multipart/form-data` — the content type an HTML `<form>` (no JS) actually submits.
    const value = (await req.clone().formData()).get(FORM_FIELD)
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
 * token — that same `_csrf` form field, or the `x-csrf-token` header for a fetch/XHR-based action —
 * matches the cookie. The cookie being `HttpOnly` doesn't defeat this: the token reaches the page
 * through server-rendered HTML (`ctx.locals`/`PageContext.csrfToken`), never by reading the cookie
 * from client-side JS, so nothing needs to read it back except the browser re-sending it and this
 * guard comparing it.
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
  const headerName = options.headerName ?? 'x-csrf-token'

  return async (ctx: GuardContext) => {
    const existingToken = ctx.cookies[cookieName]

    if (SAFE_METHODS.has(ctx.req.method)) {
      const token = existingToken ?? generateToken()
      ctx.locals[CSRF_TOKEN_LOCALS_KEY] = token
      if (existingToken) return {}
      return {
        headers: {
          'Set-Cookie': `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict`,
        },
      }
    }

    const submitted = ctx.req.headers.get(headerName) ??
      (await readFormField(ctx.req))
    if (!existingToken || submitted !== existingToken) {
      throw new HttpError('FORBIDDEN', {
        id: ctx.id,
        message: 'Missing or invalid CSRF token',
        meta: { source: 'zanix' },
      })
    }
    return {}
  }
}
