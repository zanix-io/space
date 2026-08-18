import type { HeadLinkTag } from '../router/head-descriptor.ts'

/** Options for {@linkcode buildHreflangLinks}. */
export type BuildHreflangLinksOptions = {
  /** The current request's URL — `ctx.url` from `PageContext`. Its `origin` anchors every produced
   * `href`; its `pathname` (with `lang`'s own segment stripped) is reused for every language
   * variant, so every produced URL shares the exact same path shape. */
  url: URL
  /** The lang segment currently prefixing `url.pathname` — `ctx.params.lang`, matching
   * `langPreHandler`'s own `/{lang}/...` convention. */
  lang: string
  /** Every language this app serves — same list passed to `langPreHandler({ availableLangs })`. */
  availableLangs: string[]
  /** Which of `availableLangs` the `x-default` entry points at. */
  defaultLang: string
}

/**
 * Builds the `<link rel="alternate" hreflang="...">` set for the current page — one entry per
 * `availableLangs` (always including a self-reference for `lang` itself, the Google-recommended
 * practice this ports as an explicit design choice rather than an emergent side effect), plus an
 * `x-default` entry.
 *
 * Deliberately NOT a port of the legacy component's own `getHrefLangs` — that one was a React hook
 * consumer (read the current lang via `useAppContext()`, making it unusable outside a component
 * render) with two real bugs this fixes: (1) `x-default` was hardcoded to the bare site root
 * regardless of the current page's own path — here it points at `{origin}/{defaultLang}{path}`, the
 * default-language version of THIS page, matching Google's own stated guidance for what `x-default`
 * should resolve to; (2) a standalone (non-templated) page only ever emitted a single self-hreflang,
 * never links to its OTHER language variants, because the legacy function had no way to know a
 * language list outside its own React-context lookup — here, `availableLangs` is always required
 * input, so every entry is always produced regardless of how this function is called.
 *
 * Pure — no React/Preact/hook dependency, works identically for either renderer. Called from
 * `loader` (the only page method that receives `ctx`, hence `ctx.url`/`ctx.params`) rather than
 * `head` itself — `SpacePageController.head`'s own function form only ever receives `data` (the
 * same value `component` receives as props), never `ctx` directly — so the produced links travel
 * through `loader`'s own return value, same as any other loader-derived data `head` depends on.
 *
 * @example
 * ```tsx
 * loader = (ctx: PageContext<{ lang: string }>) => ({
 *   product: getProduct(),
 *   hreflang: buildHreflangLinks({
 *     url: ctx.url,
 *     lang: ctx.params.lang,
 *     availableLangs: ['en', 'es'],
 *     defaultLang: 'en',
 *   }),
 * })
 * static head = (data: { hreflang: HeadLinkTag[] }) => ({ link: data.hreflang })
 * ```
 */
// `hreflang`, all lowercase — the real HTML attribute name, and NOT auto-corrected if it were
// camelCased instead. Confirmed empirically: `render-to-response.tsx` spreads a `HeadLinkTag`
// object directly onto a real `<link {...tag} />` element; React only special-cases a small,
// hardcoded set of camelCase DOM property names (`className`, `htmlFor`, ...) — `hrefLang` is not
// among them, so it would render VERBATIM as the invalid attribute `hrefLang="en"`, not translated
// to the real `hreflang="en"` a crawler expects.
export function buildHreflangLinks(options: BuildHreflangLinksOptions): HeadLinkTag[] {
  const { url, lang, availableLangs, defaultLang } = options
  const prefix = `/${lang}`
  const rest = url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)
    ? url.pathname.slice(prefix.length)
    : url.pathname

  const links = availableLangs.map((availableLang) => ({
    rel: 'alternate',
    hreflang: availableLang,
    href: `${url.origin}/${availableLang}${rest}`,
  }))

  links.push({
    rel: 'alternate',
    hreflang: 'x-default',
    href: `${url.origin}/${defaultLang}${rest}`,
  })

  return links
}
