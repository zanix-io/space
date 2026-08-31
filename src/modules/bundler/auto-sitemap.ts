import type { DiscoveredPage } from './discover-pages.ts'
import type { SitemapEntry } from 'modules/seo/sitemap.ts'
import { hasDynamicSegment } from './render-probe.ts'
import { isNoindex } from 'modules/validation/mod.ts'
import { getLangRegistration } from 'modules/middleware/lang-registry.ts'

function routeSegments(routePath: string): string[] {
  return routePath.split('/')
}

/** Whether every dynamic segment in `routePath` is the registered lang param — the one dynamic
 * segment with a small, statically known enumeration (`availableLangs`), unlike a database-backed
 * one (`:id`). A route with no dynamic segment at all also passes vacuously, but this is only ever
 * called on a route already confirmed to have at least one via {@linkcode hasDynamicSegment}. */
function isLangOnlyDynamic(routePath: string, paramName: string): boolean {
  const langSegment = `:${paramName}`
  return routeSegments(routePath).every((segment) =>
    !segment.startsWith(':') || segment === langSegment
  )
}

function substituteLangSegment(routePath: string, paramName: string, lang: string): string {
  const langSegment = `:${paramName}`
  return routeSegments(routePath).map((segment) => segment === langSegment ? lang : segment).join(
    '/',
  )
}

/** One route whose only dynamic segment is the lang param, expanded into one entry per
 * `availableLangs`, each cross-referencing every other language's own equivalent URL —
 * {@linkcode SitemapAlternate}'s own doc requires including a self-reference too, which this does
 * by construction (`availableLangs` always includes the entry's own `lang`). */
function expandLangEntries(
  routePath: string,
  paramName: string,
  availableLangs: string[],
): SitemapEntry[] {
  return availableLangs.map((lang) => ({
    loc: `/${substituteLangSegment(routePath, paramName, lang)}`,
    alternates: availableLangs.map((altLang) => ({
      lang: altLang,
      href: `/${substituteLangSegment(routePath, paramName, altLang)}`,
    })),
  }))
}

/**
 * Derives `defineSpaceApp({ sitemap: 'auto' })`'s own entries from a build's already-discovered
 * pages — no separate scan, no per-page declaration beyond what routing itself already captures.
 *
 * A page is skipped entirely when it declares an unconditional `redirect` (no document of its own
 * to index) or its resolved head carries `noindex` ({@linkcode isNoindex} — the same signal SEO004
 * already cross-checks a hand-written sitemap against, applied here so an auto-derived one can
 * never contradict itself by construction). A page whose head is dynamic (`headIsDynamic`) still
 * qualifies: `noindex` is a directive an app declares statically on a page or one of its layouts,
 * never something a `loader` computes per request, so an unresolved dynamic head has nothing
 * further to check for THIS purpose specifically (unlike the document-content rules `headIsDynamic`
 * skips for good reason elsewhere).
 *
 * A route with no dynamic segment ({@linkcode hasDynamicSegment}) becomes a single entry, as-is.
 * One WITH a dynamic segment is excluded — a route backed by a database (`products/:id`) has no
 * fixed set of real URLs this pass can enumerate — UNLESS `langPreHandler({ availableLangs })` has
 * registered itself in this same process ({@linkcode getLangRegistration}) AND every one of the
 * route's own dynamic segments is that registered lang param: `routes/[lang]/...`'s own `:lang` has
 * a small, statically known enumeration, unlike `:id`, so it expands into one entry per available
 * language instead of being excluded (see {@linkcode expandLangEntries}). A route mixing the lang
 * param with any OTHER dynamic segment (`[lang]/regions/[region]/page.tsx`) still excludes
 * entirely — `:region` has no fixed set to enumerate either, and expanding only the lang dimension
 * would produce URLs for content that doesn't actually exist for every language. An app with no
 * `langPreHandler` registered at all sees no change from this: every dynamic segment excludes,
 * exactly as before this expansion existed.
 *
 * Pure and synchronous — no I/O, no dependency on which renderer built `pages`, since
 * {@linkcode DiscoveredPage} itself carries no renderer-specific data at all.
 */
export function deriveAutoSitemapEntries(pages: DiscoveredPage[]): SitemapEntry[] {
  const langRegistration = getLangRegistration()
  const entries: SitemapEntry[] = []

  for (const page of pages) {
    if (page.hasUnconditionalRedirect || isNoindex(page.head)) continue

    if (hasDynamicSegment(page.routePath)) {
      if (langRegistration && isLangOnlyDynamic(page.routePath, langRegistration.paramName)) {
        entries.push(
          ...expandLangEntries(
            page.routePath,
            langRegistration.paramName,
            langRegistration.availableLangs,
          ),
        )
      }
      continue
    }

    entries.push({ loc: `/${page.routePath}` })
  }

  return entries
}
