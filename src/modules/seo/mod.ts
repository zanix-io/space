/**
 * SEO helpers native to SSR — built on `router/head-descriptor.ts`'s own `title`/`meta`/`link`
 * resolution (`buildHreflangLinks`/`buildCanonicalLink` both produce plain `HeadLinkTag`s, meant to
 * flow through a page's `loader` into its `head`), plus two standalone routes
 * (`sitemap.xml`/`robots.txt`) wired through `defineSpaceApp({ sitemap, robots })`. Structured data
 * (JSON-LD) is deliberately NOT here — that's `@zanix/space-ui`'s `StructuredData` component/
 * `resolveStructuredData`, a UI-level concern (renders as a real `<script>` tag inside a page's own
 * component tree), not a head-descriptor field (this package's `HeadDescriptor` deliberately excludes
 * `script`, see `head-descriptor.ts`'s own doc).
 *
 * @module
 */
export { buildHreflangLinks } from './hreflang.ts'
export type { BuildHreflangLinksOptions } from './hreflang.ts'
export { buildCanonicalLink } from './canonical.ts'
export type { BuildCanonicalLinkOptions } from './canonical.ts'
export { buildSitemapXml, registerSitemap } from './sitemap.ts'
export type { SitemapAlternate, SitemapEntry, SitemapSource } from './sitemap.ts'
export { buildRobotsTxt, registerRobots } from './robots.ts'
export type { RobotsConfig, RobotsRule, SpaceRobotsConfig } from './robots.ts'
