import type { HeadLinkTag } from '../router/head-descriptor.ts'

/** Options for {@linkcode buildCanonicalLink}. */
export type BuildCanonicalLinkOptions = {
  /** The current request's URL — `ctx.url` from `PageContext`. */
  url: URL
  /** Query parameter names to preserve in the canonical URL — e.g. `['page']` for paginated
   * content, where `?page=2` is itself a distinct, indexable resource. Every OTHER query parameter
   * (tracking params, sort order, session ids, ...) is dropped. Omit entirely for the common case:
   * a canonical URL with no query string at all. */
  keepParams?: string[]
}

/**
 * Builds a `<link rel="canonical">` tag for the current page — genuinely new, not a port: the
 * legacy component this replaces had no canonical-link mechanism at all (confirmed by reading its
 * source, not assumed — grepped the entire repo for "canonical", zero matches outside unrelated
 * route-naming comments).
 *
 * Strips the query string by default (`keepParams` opts specific params back in) and always uses
 * `url.origin` — never a separately-configured/env-sourced domain, unlike common legacy patterns
 * that read a `SITE_DOMAIN` env var independently at every call site (fragile: unset/misconfigured
 * in one spot but not another silently drifts). `ctx.url` already carries the real request origin,
 * so there's nothing else to configure.
 *
 * Pure — no React/Preact dependency. Called from `loader` (which receives `ctx.url`), same reason
 * `buildHreflangLinks` is — `SpacePageController.head`'s own function form only ever receives
 * `data`, never `ctx` directly.
 *
 * @example
 * ```tsx
 * loader = (ctx: PageContext) => ({
 *   product: getProduct(),
 *   canonical: buildCanonicalLink({ url: ctx.url }),
 * })
 * static head = (data: { canonical: HeadLinkTag }) => ({ link: [data.canonical] })
 * ```
 */
export function buildCanonicalLink(options: BuildCanonicalLinkOptions): HeadLinkTag {
  const { url, keepParams = [] } = options
  const canonical = new URL(url.pathname, url.origin)

  for (const name of keepParams) {
    const value = url.searchParams.get(name)
    if (value !== null) canonical.searchParams.set(name, value)
  }

  return { rel: 'canonical', href: canonical.href }
}
