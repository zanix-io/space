import type { HandlerContext } from '@zanix/server'
import { Get, SsrController, ZanixSsrController } from '@zanix/server'
import { isDevClientEnabled } from 'modules/dev/dev-client-registry.ts'

/** One language variant of a {@linkcode SitemapEntry}, cross-referenced within its own `<url>`
 * block. Google's sitemap-hreflang convention requires every language's `<url>` block to list
 * EVERY variant, itself included — never just a self-referencing `xhtml:link`. Include an entry
 * for the URL's own language too — this function performs no implicit self-inclusion. */
export type SitemapAlternate = { lang: string; href: string }

/** One `<url>` entry. `loc`/`alternates[].href` may be relative (`/products/widget`) or absolute
 * (`https://example.com/products/widget`) — {@linkcode buildSitemapXml} resolves a relative one
 * against the `origin` it's given, so an app never has to know/configure its own domain separately.
 * `SITE_DOMAIN`-style env vars read independently at 2-3 different call sites are a common footgun:
 * silently producing invalid relative `<loc>` values wherever one is unset. */
export type SitemapEntry = {
  loc: string
  /** ISO 8601 date, e.g. `'2026-08-15'`. */
  lastmod?: string
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'
  /** `0.0`–`1.0`. */
  priority?: number
  /** This entry's own language siblings — see {@linkcode SitemapAlternate}'s own doc. Omit for a
   * single-language or language-neutral URL. */
  alternates?: SitemapAlternate[]
}

/**
 * Where `defineSpaceApp({ sitemap })` reads its entries from.
 *
 * **A plain array is never recomputed, ever** — `registerSitemap` keeps the exact same reference
 * for the lifetime of the process; there is no function to invoke, no re-fetch, no snapshot taken
 * at registration time either (mutating the array after `defineSpaceApp()` returns is reflected on
 * the very next request — see the dedicated test, `sitemap-robots.test.tsx`'s "a static array is
 * never recomputed" case). The only per-request work for this shape is `buildSitemapXml` itself
 * (pure string building from whatever the array currently holds), which always runs regardless of
 * source kind — it has to, since it resolves relative `loc`/`alternates[].href` values against
 * `ctx.url.origin`, which is only known once a real request arrives.
 *
 * **A function is called once, then cached in memory for the process lifetime** — same pattern
 * `loadMessages()` already uses, applied here for the same reason: a function `source` doing real
 * work (a database query for a live product catalog) shouldn't repeat that work on every crawler
 * hit. What's cached is the resolved `SitemapEntry[]`, never the final XML string —
 * `buildSitemapXml` still runs per request against the CURRENT request's `ctx.url.origin`, so a
 * cached result stays correct even if the app is reachable under more than one origin. Concurrent
 * requests racing before the first resolution settles share a single in-flight call instead of each
 * triggering their own.
 *
 * **The cache is bypassed entirely under `znx space dev`** (`isDevClientEnabled()`), so editing
 * whatever backs the function's own data during development is reflected on the very next request
 * — no restart needed, same convention `loadMessages()`'s own dev bypass already establishes
 * (in-flight de-duplication still applies even in dev; only the cache read/write is skipped).
 *
 * The accepted trade-off in production: a function source's result is only as fresh as the last
 * process start — a change to the underlying data isn't reflected until the next restart/redeploy,
 * not on the next request. `sitemap.xml` is a low-traffic, crawler-only path where staleness on the
 * order of a deploy cycle is an acceptable cost for not repeating real work on every hit. An app
 * that genuinely needs sub-restart freshness can still bypass this by managing its own cache
 * invalidation inside the function itself (nothing here prevents that) — but that's not this
 * module's own default behavior.
 */
export type SitemapSource =
  | SitemapEntry[]
  | (() => SitemapEntry[] | Promise<SitemapEntry[]>)

let cachedEntries: SitemapEntry[] | undefined
let inFlight: Promise<SitemapEntry[]> | undefined

/** Test-only escape hatch — clears both the resolved-entries cache and any in-flight resolution,
 * for test isolation between fixtures that reuse the same process. Not exported from this
 * package's public entry points. */
export function resetSitemapCache(): void {
  cachedEntries = undefined
  inFlight = undefined
}

function resolveEntries(source: SitemapSource): SitemapEntry[] | Promise<SitemapEntry[]> {
  if (typeof source !== 'function') return source

  const devMode = isDevClientEnabled()

  if (!devMode && cachedEntries) return cachedEntries
  if (inFlight) return inFlight

  const promise = Promise.resolve(source()).then((entries) => {
    if (!devMode) cachedEntries = entries
    inFlight = undefined
    return entries
  })
  inFlight = promise
  return promise
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function resolveUrl(value: string, origin: string): string {
  return new URL(value, origin).href
}

/**
 * Builds a standards-compliant `sitemap.xml` document (the `sitemaps.org` `urlset` schema, plus the
 * `xhtml` namespace for hreflang alternates) from `entries` — pure, synchronous, no I/O, no route
 * involved (see {@linkcode registerSitemap} for the HTTP route this backs).
 *
 * Every `loc`/`href` value is XML-escaped — raw, unescaped interpolation would let a URL containing
 * `&` produce invalid XML. Redirected routes are never mixed into the same `<urlset>` as real,
 * indexable URLs — a sitemap should only ever list canonical, indexable URLs, never non-standard
 * `<redirect>`/`<target>` tags real crawlers don't recognize. `changefreq`/`priority` are per-entry
 * and optional, not hardcoded to a single value for every URL regardless of how often it actually
 * changes.
 *
 * @param entries - See {@linkcode SitemapEntry}.
 * @param origin - Resolves any relative `loc`/`alternates[].href` — e.g. `'https://example.com'`.
 */
export function buildSitemapXml(entries: SitemapEntry[], origin: string): string {
  const urls = entries.map((entry) => {
    const loc = resolveUrl(entry.loc, origin)
    const parts = [`    <loc>${escapeXml(loc)}</loc>`]
    if (entry.lastmod) parts.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`)
    if (entry.changefreq) parts.push(`    <changefreq>${entry.changefreq}</changefreq>`)
    if (entry.priority !== undefined) parts.push(`    <priority>${entry.priority}</priority>`)
    for (const alt of entry.alternates ?? []) {
      const href = escapeXml(resolveUrl(alt.href, origin))
      parts.push(
        `    <xhtml:link rel="alternate" hreflang="${escapeXml(alt.lang)}" href="${href}"/>`,
      )
    }
    return `  <url>\n${parts.join('\n')}\n  </url>`
  })

  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ` +
    `xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    `${urls.join('\n')}\n` +
    `</urlset>\n`
}

/**
 * Registers `GET /sitemap.xml`. Called from `defineSpaceApp`'s own `setup()` when `sitemap` is
 * configured — an app that never declares it never registers this route at all, same "omitted =
 * feature off" convention as `assetsDir`/`messagesDir`.
 *
 * **`sitemap.xml` is served as a real SSR route, not generated as a static file at build time —
 * this is a deliberate architectural decision, not an accidental limitation.** `@zanix/space` has
 * no general build-time data-generation phase at all today (`zanix space build`, via
 * `buildSpaceClient()`, only ever bundles the CLIENT — CSS/Comets/PWA icons — nothing server-side
 * or data-driven runs at that point); adding one JUST to freeze a sitemap would mean building new,
 * genuinely separate machinery for a single, low-traffic use case (crawlers, not real page views).
 * A live route also composes for free with everything `SitemapSource` already needs to support: a
 * static array costs nothing extra per request (see that type's own doc), and a function source
 * genuinely REQUIRES per-request evaluation to stay correct for a live product catalog — freezing
 * that case at build time would silently go stale between deploys, defeating the reason a function
 * source exists at all.
 *
 * A function `source` is called once and cached for the process lifetime, bypassed under
 * `znx space dev` (see {@linkcode SitemapSource}'s own doc for the exact guarantee, the
 * in-flight-dedup behavior, and the accepted staleness trade-off); a static array is used as-is
 * every time, at zero per-request cost — the same reference is kept for the process lifetime, never
 * recomputed, snapshotted, or re-invoked (arrays aren't callable to begin with).
 */
export function registerSitemap(source: SitemapSource): void {
  class SitemapRoute extends ZanixSsrController {
    public async serve(ctx: HandlerContext): Promise<Response> {
      const entries = await resolveEntries(source)
      const xml = buildSitemapXml(entries, ctx.url.origin)
      return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } })
    }
  }
  Get('/sitemap.xml')(SitemapRoute.prototype.serve)
  SsrController()(SitemapRoute)
}
