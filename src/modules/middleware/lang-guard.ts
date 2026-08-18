import type { GuardContext, MiddlewareGuard } from '@zanix/server'

/** Options for {@linkcode langGuard}. */
export type LangGuardOptions = {
  /** Route param key the current language is read from — must match the `[lang]` folder segment
   * `langPreHandler` redirects into (`routes/[lang]/...` → `:lang`). @default 'lang' */
  paramName?: string
  /** Name of the cookie kept in sync with the matched route's language. **Must be the same
   * `cookieName` passed to `langPreHandler`** — this guard only ever reads/writes it, it never
   * resolves a language on its own. @default 'X-Znx-Lang' */
  cookieName?: string
}

/**
 * Builds a `MiddlewareGuard` that closes the one gap `langPreHandler` documents as unable to close
 * itself: keeping the `X-Znx-Lang` cookie in sync while a visitor browses entirely under an
 * already-correctly-prefixed URL (a language switcher's own links, a bookmark under `/es/...`),
 * which never goes through a redirect at all. A `PreHandler` runs BEFORE route matching and can
 * only ever return a full `Response` or `null` — there is no way for it to attach a header to a
 * response it isn't building. A guard runs AFTER route matching and CAN merge `headers` into the
 * response the matched route eventually produces (`@zanix/server`'s own `mainGuard`), which is
 * exactly the mechanism this needs.
 *
 * Deliberately minimal: it does NOT resolve a language from `Accept-Language`, a param, or a query
 * string — `langPreHandler` already guarantees, by the time any guard runs, that the URL's first
 * segment is one of `availableLangs` (anything else was already 301-redirected away before route
 * matching happened). This guard's only job is to read that segment back out of the matched route's
 * OWN `:lang` param (present because the route lives under `routes/[lang]/...`) and, if it differs
 * from the persisted cookie, refresh it — the same "does the resolved value already match the
 * cookie" check `populationGuard` performs for its own cookie.
 *
 * @example
 * ```ts
 * import { defineMiddleware } from '@zanix/space'
 * import { langGuard, langPreHandler } from '@zanix/space'
 *
 * // preHandler: redirects an un-prefixed request to its canonical `/{lang}/...` URL.
 * // langGuard: keeps the cookie in sync for every request that's already prefixed correctly.
 * defineMiddleware([langGuard()])
 * ```
 */
export function langGuard(options: LangGuardOptions = {}): MiddlewareGuard {
  const paramName = options.paramName ?? 'lang'
  const cookieName = options.cookieName ?? 'X-Znx-Lang'

  return (ctx: GuardContext) => {
    const params = ctx.payload.params as Record<string, string> | undefined
    const current = params?.[paramName]
    if (!current || ctx.cookies[cookieName] === current) return {}

    return {
      headers: {
        'Set-Cookie': `${cookieName}=${current}; Path=/; SameSite=Lax`,
      },
    }
  }
}
