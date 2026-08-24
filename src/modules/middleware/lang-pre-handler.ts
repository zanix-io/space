import type { PreHandler } from '@zanix/server'
import { assertZnxCookieName, PUBLIC_COOKIE_ATTRIBUTES } from '@zanix/helpers'

/** Path prefixes `langPreHandler` never redirects, regardless of `ignorePrefixes` — every
 * framework-internal route `@zanix/space` itself can register. A caller's own `ignorePrefixes`
 * ADDS to this list; it can't be used to accidentally re-include one of these. */
const FRAMEWORK_PREFIXES: readonly string[] = [
  '/health',
  '/ready',
  '/assets/',
  '/icons/',
  '/manifest.webmanifest',
  '/sw.js',
]

/** Options for {@linkcode langPreHandler}. */
export type LangPreHandlerOptions = {
  /** Every language this app actually serves — e.g. `['en', 'es']`. The first entry is NOT
   * treated as the default; set `defaultLang` explicitly. */
  availableLangs: string[]
  /** Used when the URL, the cookie, and `Accept-Language` all fail to resolve to one of
   * `availableLangs`. */
  defaultLang: string
  /** Extra path prefixes to never redirect, beyond the framework-internal ones this always
   * skips (`/health`, `/ready`, `/assets/`, `/icons/`, `/manifest.webmanifest`, `/sw.js`) — e.g. a
   * consumer app's own non-i18n API routes sharing the same port. */
  ignorePrefixes?: string[]
  /**
   * Name of the cookie an explicitly-chosen language persists to (e.g. via a language switcher
   * navigating to `/es/...`), so a LATER visit to an un-prefixed URL — a bookmark, an external
   * link, `/checkout` reached from within the app itself — still honors that choice instead of
   * re-resolving from `Accept-Language` every time. **Must start with `X-Znx-`**, enforced at
   * construction via `@zanix/utils`'s `assertZnxCookieName` (throws `ApplicationError`) even though
   * this one isn't actually filtered by `@zanix/server`'s `cookiesGuard` itself (a `PreHandler` runs
   * before any guard, reading the raw `Request` directly) — kept consistent with `populationGuard`'s
   * own cookie so there's one naming convention for this kind of "persisted resolution" cookie, not
   * two, and so `langGuard`'s own copy of the same name (which IS read through `ctx.cookies`) stays
   * valid too. Deliberately NOT `HttpOnly`, same reasoning as `populationGuard`'s own cookie:
   * client-side code (a language switcher) is expected to set/read it too. @default 'X-Znx-Lang'
   */
  cookieName?: string
}

function resolveAcceptLanguage(
  header: string | null,
  availableLangs: string[],
): string | undefined {
  if (!header) return undefined

  const candidates = header
    .split(',')
    .map((part) => {
      const [tag, qPart] = part.trim().split(';q=')
      const quality = qPart ? parseFloat(qPart) : 1
      return { tag: tag.trim(), quality: Number.isFinite(quality) ? quality : 1 }
    })
    .sort((a, b) => b.quality - a.quality)

  for (const { tag } of candidates) {
    if (availableLangs.includes(tag)) return tag
    const base = tag.split('-')[0].toLowerCase()
    if (availableLangs.includes(base)) return base
  }
  return undefined
}

/** Reads one cookie by name directly off the raw `Cookie` header — a `PreHandler` runs before
 * `@zanix/server`'s own `cookiesGuard`, so `ctx.cookies` doesn't exist yet at this point; nothing
 * heavier than this (no external dependency) is needed for a single, exact-name lookup. */
function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie')
  if (!header) return undefined

  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    if (pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim()
  }
  return undefined
}

/**
 * Builds a `PreHandler` (`@zanix/server`'s pre-route-matching hook — NOT a guard: guards only
 * ever run AFTER a route has already matched, which is too late for a redirect keyed on the URL
 * not matching anything yet) that keeps every page under a `routes/[lang]/...` folder convention
 * reachable only through its canonical, language-prefixed URL:
 *
 * ```ts
 * import { bootstrapServers } from '@zanix/server'
 * import { langPreHandler } from '@zanix/space'
 *
 * await bootstrapServers({
 *   ssr: {
 *     preHandler: langPreHandler({ availableLangs: ['en', 'es'], defaultLang: 'en' }),
 *   },
 * })
 * ```
 *
 * A request whose first path segment is already one of `availableLangs` falls through unchanged
 * (returns `null`) — this `PreHandler` alone can't refresh the cookie in that case (see the
 * implementation's own comment for why: it has no way to attach a header to a response it isn't
 * the one building). Pair it with {@linkcode langGuard} to cover that case too — the guard runs
 * AFTER route matching and reads the language back out of the matched route's own `:lang` param
 * instead. Otherwise, resolves a language — cookie, then `Accept-Language`, then
 * `defaultLang` — and 301-redirects to that same path with it prepended: `/products` →
 * `/en/products`, `/` → `/en`. `301`, not `302`: a lang-less URL and its canonical, prefixed form
 * are a permanent relationship. The redirect response also sets the cookie, so a later visit to
 * another un-prefixed URL resolves the same way without needing `Accept-Language` again.
 *
 * A missing language segment and an invalid one are treated as the same case — a single check
 * ("is the first segment already a valid language?") rather than two separate states with
 * different redirect codes. A per-route opt-out (some pages need no language prefix at all, others
 * do) is NOT supported: nothing in `@zanix/space` today has a proven need for mixed
 * prefixed/unprefixed pages in the same app — add it if that changes, rather than building the
 * flexibility speculatively now. The cookie exists for consistency with `populationGuard`'s own
 * persistence, and because the same gap it closes for population — an explicit choice silently
 * reverting on the next un-prefixed URL — applies to language exactly as much.
 *
 * Never redirects a framework-internal route (`/health`, `/ready`, `/assets/`, `/icons/`,
 * `/manifest.webmanifest`, `/sw.js`) — `ignorePrefixes` extends that list, never replaces it.
 */
export function langPreHandler(options: LangPreHandlerOptions): PreHandler {
  const { availableLangs, defaultLang, ignorePrefixes = [], cookieName = 'X-Znx-Lang' } = options
  assertZnxCookieName(cookieName, 'langPreHandler')
  const ignored = [...FRAMEWORK_PREFIXES, ...ignorePrefixes]

  return (request) => {
    const url = new URL(request.url)
    const { pathname } = url

    if (ignored.some((prefix) => pathname.startsWith(prefix))) return null

    const first = pathname.split('/').filter(Boolean)[0]
    // `PreHandler` can only ever return a full `Response` or `null` — there is no way to fall
    // through to normal dispatch AND still attach a `Set-Cookie` to whatever response eventually
    // comes out of it (a `null` here is a pure "handle this normally", nothing more). So an
    // already-correctly-prefixed request (no redirect happening) can never refresh the cookie
    // here. `langGuard` (`./lang-guard.ts`) covers exactly this case instead — it runs AFTER route
    // matching, where a guard's returned `headers` DO get merged into the response.
    if (first && availableLangs.includes(first)) return null

    const existingCookie = readCookie(request, cookieName)
    const lang =
      (existingCookie && availableLangs.includes(existingCookie) ? existingCookie : undefined) ??
        resolveAcceptLanguage(request.headers.get('accept-language'), availableLangs) ??
        defaultLang

    const redirectUrl = new URL(url)
    redirectUrl.pathname = `/${lang}${pathname === '/' ? '' : pathname}`

    return new Response(null, {
      status: 301,
      headers: {
        Location: redirectUrl.href,
        'Set-Cookie': `${cookieName}=${lang}; ${PUBLIC_COOKIE_ATTRIBUTES}`,
      },
    })
  }
}
