/**
 * Static validation — everything decidable without rendering.
 *
 * The input is a page's already-resolved head plus its surrounding configuration, never source
 * text: resolution belongs to `resolveHead` (`router/head-descriptor.ts`) and this module reads its
 * output, exactly as the serializers do. That means a rule here sees the same merged, deduplicated
 * head the document will actually carry, rather than re-deriving one and risking a different answer.
 *
 * **What static validation deliberately cannot do.** A page whose `head` is a function of loader
 * data cannot be evaluated without running that loader, which means data, which means it is not
 * static. Rather than invoke it with a fabricated argument and report whatever falls out, those
 * pages are recorded as unresolvable and skipped — see {@linkcode StaticPageInput.headIsDynamic}.
 * Silence about something unknowable is correct; a confident wrong answer is not.
 *
 * @module
 */
import type { HeadDescriptor, ResolvedHead } from '../router/head-descriptor.ts'
import type { PwaConfig } from 'typings/pwa.ts'
import type { Diagnostic } from './diagnostic.ts'
import type { ValidationConfig } from './engine.ts'
import { DiagnosticCollector, isExemptFromDocumentRules } from './engine.ts'
import { DEFAULT_ICON_SIZES } from '../pwa/icon-naming.ts'

/** Every robots token Google documents. Extendable per project — other crawlers define their own,
 * and an unrecognized token is ignored rather than treated as an error for exactly that reason. */
const KNOWN_ROBOTS_TOKENS = new Set([
  'all',
  'noindex',
  'index',
  'nofollow',
  'follow',
  'none',
  'noarchive',
  'nosnippet',
  'indexifembedded',
  'max-snippet',
  'max-image-preview',
  'max-video-preview',
  'notranslate',
  'noimageindex',
  'unavailable_after',
])

/** One page, as static validation sees it. */
export type StaticPageInput = {
  /** Source path, for reporting. */
  filePath: string
  /** Route path, e.g. `'products/:id'`. */
  routePath: string
  /**
   * This page's head, ALREADY resolved across its own declaration and its whole layout chain — the
   * same `ResolvedHead` the document will carry.
   */
  head: ResolvedHead
  /** `true` when the page (or a layout in its chain) declares `head` as a function of loader data,
   * so the resolved head above is incomplete. Head-content rules skip such a page entirely. */
  headIsDynamic?: boolean
  /** `true` when the page declares a `redirect` with no `condition` — it never renders. */
  hasUnconditionalRedirect?: boolean
  /** Heads declared by layouts in this page's chain, paired with their source paths — needed by
   * rules about WHERE a tag was declared rather than what the merged result is. */
  layoutHeads?: Array<{ filePath: string; head: HeadDescriptor }>
}

/** App-level input, shared across every page. */
export type StaticAppInput = {
  /** `defineSpaceApp({ pwa })`, when configured. */
  pwa?: PwaConfig
  /** Sitemap entries, when the app declares them as a literal array. A function source is not
   * evaluated — see {@linkcode validateDocuments}. */
  sitemapLocations?: string[]
  /** Every route the app serves, for cross-checking the sitemap. */
  knownRoutes?: string[]
  /** The root layout's source text, when there is one, for the two source-level heuristics. */
  rootLayout?: { filePath: string; source: string }
  /** `true` when the route tree contains a `[lang]` segment. */
  hasLangRoutes?: boolean
  /** Title/description length bounds for the opt-in heuristic rule. */
  lengthLimits?: { titleMax?: number; descriptionMax?: number }
}

function metaContent(head: ResolvedHead, name: string): string | undefined {
  return head.meta.find((tag) => tag.name === name)?.content
}

/** Whether a resolved head's own `<meta name="robots">` carries a `noindex` token — shared between
 * this module's own SEO004 cross-check below and `deriveAutoSitemapEntries`
 * (`modules/bundler/auto-sitemap.ts`), so a page that opts out of indexing is excluded from an
 * auto-derived sitemap by construction, rather than relying on a second parse of the same tag to
 * agree with this one. */
export function isNoindex(head: ResolvedHead): boolean {
  const robots = metaContent(head, 'robots')
  return robots !== undefined &&
    robots.split(',').some((token) => token.trim().toLowerCase() === 'noindex')
}

function ogProperty(head: ResolvedHead, property: string): string | undefined {
  return head.meta.find((tag) => tag.property === property)?.content
}

function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function canonicalLinks(head: ResolvedHead) {
  return head.link.filter((tag) => tag.rel.trim().toLowerCase() === 'canonical')
}

/** Validates one page's head and declarations. */
function validatePage(
  page: StaticPageInput,
  app: StaticAppInput,
  collector: DiagnosticCollector,
  config: ValidationConfig,
): void {
  const where = { file: page.filePath, route: page.routePath }

  if (isExemptFromDocumentRules(page.routePath, page, config)) return

  // --- head presence -----------------------------------------------------------------------------
  // Skipped entirely for a dynamic head: the resolved value here is not what the document will
  // carry, so every rule below would be answering the wrong question.
  if (!page.headIsDynamic) {
    if (page.head.title === undefined) {
      collector.report('DOC001', {
        ...where,
        message: `Route '${page.routePath}' resolves no <title>.`,
        hint:
          'Declare `static head = { title: ... }` on the page, or a `head` export on a layout in its chain.',
      })
    }

    if (metaContent(page.head, 'description') === undefined) {
      collector.report('SEO001', {
        ...where,
        message: `Route '${page.routePath}' declares no meta description.`,
      })
    }

    const canonicals = canonicalLinks(page.head)
    const distinctHrefs = new Set(canonicals.map((tag) => tag.href))

    // FW001 — cannot normally happen: `resolveHead` treats canonical as a singleton. It is checked
    // anyway because this is the one invariant whose violation is silently harmful, and a future
    // change to the dedup rule would otherwise reintroduce it unnoticed.
    if (distinctHrefs.size > 1) {
      collector.report('FW001', {
        ...where,
        message:
          `Route '${page.routePath}' resolved ${distinctHrefs.size} conflicting canonical URLs: ${
            [...distinctHrefs].join(', ')
          }.`,
        hint: 'A canonical URL is a per-URL fact; declare it on the page, not on a shared layout.',
      })
    }

    for (const tag of canonicals) {
      if (!isAbsoluteHttpUrl(tag.href)) {
        collector.report('SEO005', {
          ...where,
          message: `Canonical '${tag.href}' on route '${page.routePath}' is not an absolute URL.`,
        })
      }
    }

    if (canonicals.length === 0) {
      collector.report('SEO002', {
        ...where,
        message: `Route '${page.routePath}' declares no canonical.`,
      })
    }

    // --- robots ----------------------------------------------------------------------------------
    const robots = metaContent(page.head, 'robots')
    if (robots !== undefined) {
      for (const rawToken of robots.split(',')) {
        const token = rawToken.trim().split(':')[0].toLowerCase()
        if (token === '') continue
        if (!KNOWN_ROBOTS_TOKENS.has(token)) {
          collector.report('SEO003', {
            ...where,
            message: `Unrecognized robots token '${token}' on route '${page.routePath}'.`,
            hint:
              'Crawlers ignore tokens they do not recognize, so this directive silently will not apply.',
          })
        }
      }
    }

    // --- sitemap / noindex contradiction ---------------------------------------------------------
    const pageIsNoindex = isNoindex(page.head)
    if (
      pageIsNoindex &&
      app.sitemapLocations?.some((loc) => loc.replace(/^\//, '') === page.routePath)
    ) {
      collector.report('SEO004', {
        ...where,
        message:
          `Route '${page.routePath}' declares noindex but is listed in the sitemap — the two contradict each other.`,
      })
    }

    // --- open graph (opt-in) ---------------------------------------------------------------------
    const ogProperties = ['og:title', 'og:type', 'og:image', 'og:url'] as const
    const declared = ogProperties.filter((property) =>
      ogProperty(page.head, property) !== undefined
    )
    if (declared.length > 0 && declared.length < ogProperties.length) {
      const missing = ogProperties.filter((property) => !declared.includes(property))
      collector.report('SOC002', {
        ...where,
        message: `Route '${page.routePath}' declares Open Graph but is missing ${
          missing.join(', ')
        }.`,
      })
    }
    for (const property of ['og:image', 'og:url'] as const) {
      const value = ogProperty(page.head, property)
      if (value !== undefined && !isAbsoluteHttpUrl(value)) {
        collector.report('SOC001', {
          ...where,
          message: `${property} on route '${page.routePath}' is relative ('${value}').`,
        })
      }
    }
    if (declared.length > 0 && metaContent(page.head, 'twitter:card') === undefined) {
      collector.report('SOC003', { ...where })
    }

    // --- length heuristics (opt-in, no primary source) -------------------------------------------
    const titleMax = app.lengthLimits?.titleMax ?? 60
    const descriptionMax = app.lengthLimits?.descriptionMax ?? 160
    if (page.head.title !== undefined && page.head.title.length > titleMax) {
      collector.report('SEO007', {
        ...where,
        message:
          `Title on route '${page.routePath}' is ${page.head.title.length} characters (over ${titleMax}).`,
      })
    }
    const description = metaContent(page.head, 'description')
    if (description !== undefined && description.length > descriptionMax) {
      collector.report('SEO007', {
        ...where,
        message:
          `Description on route '${page.routePath}' is ${description.length} characters (over ${descriptionMax}).`,
      })
    }
  }

  // --- where a canonical was declared ------------------------------------------------------------
  // Independent of `headIsDynamic`: this is about the DECLARATION SITE, which is known statically
  // whether or not the value is.
  for (const layout of page.layoutHeads ?? []) {
    if ((layout.head.link ?? []).some((tag) => tag.rel.trim().toLowerCase() === 'canonical')) {
      collector.report('FW002', {
        file: layout.filePath,
        route: page.routePath,
        message: `Layout '${layout.filePath}' declares a canonical, but it wraps multiple routes.`,
      })
    }
  }
}

/** App-level rules, evaluated once rather than per page. */
function validateApp(
  app: StaticAppInput,
  collector: DiagnosticCollector,
): void {
  // --- PWA ---------------------------------------------------------------------------------------
  if (app.pwa) {
    const sizes = app.pwa.iconSizes ?? DEFAULT_ICON_SIZES
    const missing = [192, 512].filter((size) => !sizes.includes(size))
    if (missing.length > 0) {
      collector.report('PWA001', {
        message: `PWA iconSizes is missing ${
          missing.join(' and ')
        } — an app without both cannot be installed.`,
        hint: `Current sizes: ${sizes.join(', ')}.`,
      })
    }

    if (app.pwa.offlineFallback !== undefined && app.knownRoutes) {
      const fallback = app.pwa.offlineFallback.replace(/^\//, '')
      if (!app.knownRoutes.some((route) => route.replace(/^\//, '') === fallback)) {
        collector.report('PWA002', {
          message: `offlineFallback '${app.pwa.offlineFallback}' matches no known route.`,
          hint:
            'The service worker precaches it during install; a failing precache aborts the whole install, so the worker never activates.',
        })
      }
    }

    if (app.pwa.themeColor === undefined) collector.report('PWA003', {})
  }

  // --- sitemap -----------------------------------------------------------------------------------
  if (app.sitemapLocations && app.knownRoutes) {
    for (const location of app.sitemapLocations) {
      const normalized = location.replace(/^\//, '')
      // A dynamic route is matched by pattern, not by literal — `products/:id` legitimately backs
      // `products/42`, and reporting that as unmatched would be wrong.
      const matched = app.knownRoutes.some((route) => {
        const pattern = route.replace(/^\//, '').replace(/:[^/]+/g, '[^/]+')
        return new RegExp(`^${pattern}$`).test(normalized)
      })
      if (!matched) {
        collector.report('SEO006', {
          message: `Sitemap entry '${location}' matches no known route.`,
        })
      }
    }
  }

  // --- root layout source heuristics ---------------------------------------------------------------
  if (app.rootLayout) {
    const { filePath, source } = app.rootLayout
    if (!/<html[\s>]/.test(source) && !/'html'/.test(source) && !/"html"/.test(source)) {
      collector.report('FW006', {
        file: filePath,
        message: `Root layout '${filePath}' does not appear to render <html>/<body>.`,
        hint:
          'If it delegates the document to another component this is a false positive; DOC003 decides validity against the real rendered output.',
      })
    }

    const literalLang = /lang\s*[=:]\s*['"]([a-z-]+)['"]/i.exec(source)
    if (literalLang && app.hasLangRoutes) {
      collector.report('FW005', {
        file: filePath,
        message: `Root layout hardcodes lang='${
          literalLang[1]
        }' while the app serves [lang] routes — every language would be served as '${
          literalLang[1]
        }'.`,
        hint: 'Derive lang from the route params instead.',
      })
    }
  }
}

/**
 * Runs every static rule over an app and its pages.
 *
 * @param pages - Every page, with its head ALREADY resolved. Building that input is the caller's
 * job (`bundler/discover-pages.ts` does it during a build) — this function performs no discovery
 * and no head resolution of its own.
 * @param app - App-level configuration. Anything absent simply skips the rules that need it, so a
 * caller that knows less still gets correct results for what it does know.
 * @param config - Project validation configuration.
 * @returns Diagnostics, most severe first.
 */
export function validateDocuments(
  pages: StaticPageInput[],
  app: StaticAppInput = {},
  config: ValidationConfig = {},
): Diagnostic[] {
  const collector = new DiagnosticCollector(config)
  validateApp(app, collector)
  for (const page of pages) validatePage(page, app, collector, config)
  return collector.results()
}
