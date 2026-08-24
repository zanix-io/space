## SEO — canonical links, hreflang, robots.txt and sitemap.xml

This is the full reference the README's ["SEO helpers"](../README.md#seo-helpers) section points to.
Two pure link builders (`buildCanonicalLink`, `buildHreflangLinks`) feed into
[Head management](../README.md#head-management) through a page's `loader`, and two build/serve pairs
(`buildRobotsTxt`/`registerRobots`, `buildSitemapXml`/`registerSitemap`) back the
`robots.txt`/`sitemap.xml` routes `defineSpaceApp({ robots, sitemap })` registers. Structured data
(JSON-LD) is deliberately not part of this module — that's `@zanix/space-ui`'s `StructuredData`
component, a UI-level concern rendered inside a page's own `component` tree, not a head-descriptor
field.

### Canonical links — `buildCanonicalLink`

Builds a `<link rel="canonical">` tag for the current request. It strips the query string by default
and always resolves against `url.origin` — never a separately-configured domain, since `ctx.url`
already carries the real request origin.

```tsx
import { buildCanonicalLink } from '@zanix/space'

@Page()
export default class ProductPage extends SpacePageController<{ id: string }> {
  loader = (ctx: { url: URL; params: { id: string } }) => ({
    product: getProduct(ctx.params.id),
    canonical: buildCanonicalLink({ url: ctx.url }),
  })
  static head = (data: { canonical: HeadLinkTag }) => ({ link: [data.canonical] })
  component = ProductView
}
```

Called from `loader`, not `head` directly — `SpacePageController.head`'s own function form only ever
receives `data` (the loader's own return value), never `ctx`.

`keepParams` opts specific query parameters back into the canonical URL — the case where a parameter
is itself part of what makes the page a distinct, indexable resource:

```ts
buildCanonicalLink({ url: ctx.url, keepParams: ['page'] })
// /products?page=2&sort=price&session=abc  ->  /products?page=2
```

Every OTHER query parameter (`sort`, `session`, ...) is dropped. Omit `keepParams` entirely for the
common case — a canonical URL with no query string at all.

#### `BuildCanonicalLinkOptions`

| Field        | Type       | Required | Meaning                                                        |
| ------------ | ---------- | -------- | -------------------------------------------------------------- |
| `url`        | `URL`      | yes      | The current request's URL — `ctx.url` from `PageContext`.      |
| `keepParams` | `string[]` | no       | Query parameter names to preserve; every other one is dropped. |

### Hreflang alternates — `buildHreflangLinks`

Builds the `<link rel="alternate" hreflang="...">` set for the current page: one entry per
`availableLangs` — always including a self-reference for the current `lang` — plus one `x-default`
entry.

```tsx
import { buildHreflangLinks } from '@zanix/space'

@Page({ path: ':lang/products/:id' })
export default class ProductPage extends SpacePageController<{ lang: string; id: string }> {
  loader = (ctx: { url: URL; params: { lang: string; id: string } }) => ({
    product: getProduct(ctx.params.id),
    hreflang: buildHreflangLinks({
      url: ctx.url,
      lang: ctx.params.lang,
      availableLangs: ['en', 'es'],
      defaultLang: 'en',
    }),
  })
  static head = (data: { hreflang: HeadLinkTag[] }) => ({ link: data.hreflang })
  component = ProductView
}
```

For a request to `/es/products/widget`, this produces:

```
<link rel="alternate" hreflang="en" href="https://example.com/en/products/widget" />
<link rel="alternate" hreflang="es" href="https://example.com/es/products/widget" />
<link rel="alternate" hreflang="x-default" href="https://example.com/en/products/widget" />
```

**How `x-default` resolves**: it always points at `{origin}/{defaultLang}{rest}` — the `defaultLang`
version of the SAME page, with `lang`'s own segment stripped from `url.pathname` and replaced by
each language in turn. It is never the bare site root regardless of the current path, and a
standalone page always gets links to every one of its OTHER language variants, not only a
self-reference — `availableLangs` is always required input, so the full set is produced every time
this is called, independent of any global language registry.

Pure — no dependency on React/Preact or on a hook/context lookup, so it behaves identically under
either renderer. Called from `loader`, for the same reason `buildCanonicalLink` is.

#### `BuildHreflangLinksOptions`

| Field            | Type       | Required | Meaning                                                                   |
| ---------------- | ---------- | -------- | ------------------------------------------------------------------------- |
| `url`            | `URL`      | yes      | The current request's URL — `ctx.url`. Its `origin` anchors every `href`. |
| `lang`           | `string`   | yes      | The lang segment currently prefixing `url.pathname` — `ctx.params.lang`.  |
| `availableLangs` | `string[]` | yes      | Every language this app serves.                                           |
| `defaultLang`    | `string`   | yes      | Which of `availableLangs` the `x-default` entry points at.                |

### `robots.txt` — `buildRobotsTxt` / `registerRobots`

`defineSpaceApp({ robots })` registers `GET /robots.txt` automatically — an app that never declares
`robots` never registers the route at all, same "omitted = feature off" convention as
`assetsDir`/`messagesDir`/`sitemap`:

```ts
// space.app.ts
export default defineSpaceApp({
  name: 'storefront',
  robots: { rules: [{ userAgent: '*', disallow: ['/admin'] }] },
})
```

`robots` accepts either shape:

- **A raw `string`** is served byte-for-byte — not even a trailing newline is added — since passing
  one is an explicit choice to own the file's exact bytes.
- **A `RobotsConfig`** (`{ rules, includeSitemap? }`) is rendered as one `User-agent` block per
  `rules` entry, blank line between blocks. When `sitemap` is ALSO configured and `includeSitemap`
  wasn't set to `false`, a trailing `Sitemap: {origin}/sitemap.xml` line is auto-appended;
  `includeSitemap` is a no-op when `sitemap` isn't configured at all.

`buildRobotsTxt(config, { origin, hasSitemap })` is the pure function behind the route — useful
directly for testing the generated text without a real request. `registerRobots(config, hasSitemap)`
is what `defineSpaceApp` calls internally; calling it yourself is only needed outside that flow
(e.g. a manual `ZanixSsrController` setup that doesn't go through `defineSpaceApp`).

#### `RobotsRule`

| Field       | Type       | Required | Meaning                           |
| ----------- | ---------- | -------- | --------------------------------- |
| `userAgent` | `string`   | no       | Defaults to `'*'`.                |
| `allow`     | `string[]` | no       | `Allow:` paths for this block.    |
| `disallow`  | `string[]` | no       | `Disallow:` paths for this block. |

#### `RobotsConfig`

| Field            | Type           | Required | Meaning                                                                   |
| ---------------- | -------------- | -------- | ------------------------------------------------------------------------- |
| `rules`          | `RobotsRule[]` | yes      | One `User-agent` block per entry.                                         |
| `includeSitemap` | `boolean`      | no       | Auto-append `Sitemap:` when `sitemap` is also configured. Default `true`. |

#### `SpaceRobotsConfig`

`string | RobotsConfig` — `defineSpaceApp({ robots })`'s own accepted shape.

### `sitemap.xml` — `buildSitemapXml` / `registerSitemap`

```ts
// space.app.ts
export default defineSpaceApp({
  name: 'storefront',
  sitemap: async () => [
    { loc: '/en/products', priority: 0.9 },
    {
      loc: '/en/about',
      lastmod: '2026-08-15',
      alternates: [{ lang: 'en', href: '/en/about' }, { lang: 'es', href: '/es/about' }],
    },
  ],
})
```

**`sitemap.xml` is served as a real SSR route (`GET /sitemap.xml`), not generated as a static file
at build time — a deliberate design choice, not a limitation.** `@zanix/space` has no general
build-time data-generation phase (`zanix space build` only ever bundles the client — CSS/Comets/PWA
icons — nothing server-side or data-driven runs at that point), and a live route composes for free
with what `sitemap` already needs to support: a static array costs nothing extra per request, and a
function source genuinely needs per-request evaluation to stay correct for a live product catalog —
freezing that case at build time would go stale between deploys.

`sitemap` accepts a static array or a function, with two distinct, precisely-guaranteed behaviors:

- **A plain array is never recomputed, ever.** The exact same reference is kept for the process
  lifetime — mutating it after `defineSpaceApp()` returns is reflected on the very next request. The
  only per-request work is still building the XML string itself, since resolving relative
  `loc`/`alternates[].href` values needs the current request's own origin.
- **A function is called once, then cached in memory for the process lifetime** — the same pattern
  `loadMessages()` uses, so a function doing real work (a database query) doesn't repeat it on every
  crawler hit. What's cached is the resolved `SitemapEntry[]`, never the final XML — the XML is
  still rebuilt per request against the current origin. Concurrent requests racing before the first
  resolution settles share a single in-flight call. **Bypassed entirely under `znx space dev`**, so
  editing whatever backs the function is reflected on the next request, no restart needed. In
  production, a function source's result is only as fresh as the last process start — a data change
  isn't reflected until the next restart/redeploy, not the next request.

`buildSitemapXml(entries, origin)` is the pure function behind the route: standards-compliant
`urlset` XML (the `sitemaps.org` schema, plus the `xhtml` namespace for hreflang alternates), with
every `loc`/`href` XML-escaped. `registerSitemap(source)` is what `defineSpaceApp` calls internally
when `sitemap` is configured; calling it directly is only needed outside that flow.

#### `SitemapEntry`

| Field        | Type                                                                              | Required | Meaning                                                             |
| ------------ | --------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------- |
| `loc`        | `string`                                                                          | yes      | Relative or absolute — a relative value resolves against `origin`.  |
| `lastmod`    | `string`                                                                          | no       | ISO 8601 date, e.g. `'2026-08-15'`.                                 |
| `changefreq` | `'always' \| 'hourly' \| 'daily' \| 'weekly' \| 'monthly' \| 'yearly' \| 'never'` | no       | Standard sitemap hint.                                              |
| `priority`   | `number`                                                                          | no       | `0.0`–`1.0`.                                                        |
| `alternates` | `SitemapAlternate[]`                                                              | no       | This entry's own language siblings. Omit for a single-language URL. |

#### `SitemapAlternate`

| Field  | Type     | Required | Meaning                                                |
| ------ | -------- | -------- | ------------------------------------------------------ |
| `lang` | `string` | yes      | The language this alternate is for.                    |
| `href` | `string` | yes      | Relative or absolute — resolved the same way as `loc`. |

Include an entry for the URL's own language too — `buildSitemapXml` performs no implicit
self-inclusion, so each `<url>` block only ever lists exactly what its own `alternates` array names.

#### `SitemapSource`

`SitemapEntry[] | (() => SitemapEntry[] | Promise<SitemapEntry[]>)` —
`defineSpaceApp({ sitemap })`'s own accepted shape; see the array-vs-function behavior above.

## See also

- [`README.md`](../README.md#seo-helpers) — the "SEO helpers" section this guide is the full
  reference for.
- [`docs/theming.md`](./theming.md) — design tokens and per-request theme resolution.
- [`docs/validation.md`](./validation.md) — build-time document validation.
