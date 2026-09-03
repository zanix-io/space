# Zanix - Space

[![Version](https://img.shields.io/jsr/v/@zanix/space?color=blue&label=jsr)](https://jsr.io/@zanix/space/versions)

[![Release](https://img.shields.io/github/v/release/zanix-io/space?color=blue&label=git)](https://github.com/zanix-io/space/releases)

[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://opensource.org/licenses/MIT)

## Table of Contents

1. [Description](#description)
2. [Current status](#current-status)
3. [Features](#features)
4. [Installation](#installation)
5. [Basic Usage](#basic-usage)
6. [Documentation](#documentation)
7. [Contributing](#contributing)
8. [Changelog](#changelog)
9. [License](#license)

## Description

Zanix Space is the Deno-native, React 19 frontend framework in the **Zanix** ecosystem — streaming
server-side rendering, selective hydration ("Comets"), and installable/offline-first apps, built
directly on Web APIs instead of adapting a Node-era stack. A `@zanix/space` app is a Zanix App: it
declares its manifest through `@zanix/app`'s `defineZanixApp()` and is activated by `@zanix/server`
(`Deno.serve()`), the same composition model any backend Zanix App already uses.

## Current status

This package is under active, incremental development. Only what's listed below is implemented —
nothing else is stubbed ahead of time:

- ✅ **App manifest authoring** (`defineSpaceApp`) — identity, dependencies, a `setup` escape hatch,
  forwarded to `@zanix/app`'s `defineZanixApp()`.
- ✅ **Streaming SSR core** (`renderToResponse`) — a React element tree to a streamed `Response`,
  one serialized initial-state block, a request-scoped promise cache (`useRequestCache`) for
  `use()`.
- ✅ **Base Vite integration** (`spacePlugin`) — `client`/`ssr` Environment API targets Comets/CSS
  build on; `renderer: 'react'` always compiles through
  [React Compiler](https://react.dev/learn/react-compiler), strictly isolated from the Preact path.
- ✅ **File-based page routing** (`SpacePageController`, `Page()`, `loadRoutes()`) — a
  `routes/**/page.tsx` file exports a `loader`/`component`/`action` triple, registered automatically
  during `defineSpaceApp()`'s own `setup(ctx)`; `@Page('products/:id')` is an escape hatch for a
  route outside the file-location convention.
- ✅ **Layouts, loading and error segments** — a `layout.tsx`/`loading.tsx`/`error.tsx` next to (or
  above) a `page.tsx` wraps it automatically, nested per directory level, recovering client-side via
  `hydrateErrorBoundaries()` on both renderers. See
  [`docs/routing.md`](./docs/routing.md#layouts-loading-and-error-segments) for the full recovery
  contract, including `error.tsx`'s own `reset` behavior.
- ✅ **Document shell** — a root `routes/layout.tsx` renders `<html>`/`<body>` itself (same contract
  as Next.js's App Router); with none at all, a default spec-valid document wraps the page instead.
  See [`docs/routing.md`](./docs/routing.md#document-shell) for the full contract.
- ✅ **Not-found page** — `routesDir`'s own `not-found.tsx` renders for any unmatched route, via
  `createNotFoundHandler()`. See [`docs/routing.md`](./docs/routing.md#not-found-page) for the
  opt-in Orbit-fragment behavior.
- ✅ **`globalErrorHandler()`** — composes `createNotFoundHandler()` with other
  `server.ssr.onError`-shaped recovery handlers, since that slot only ever accepts one. See
  [`docs/routing.md`](./docs/routing.md#composing-multiple-onerror-handlers) for the full contract.
- ✅ **`defineSpaceApp({ errorResponse: 'json' })`** — an app that never wants to serve a rendered
  HTML page for its own built-in not-found/error fallback, for a pure API/backend built on
  `@zanix/space` purely for its routing. See
  [`docs/routing.md`](./docs/routing.md#serving-json-instead-of-a-document--definespaceapp-errorresponse-json-)
  for the full contract.
- ✅ **Static `redirect`/`cacheControl`** on `SpacePageController` — `redirect` runs before
  `loader`/`component`; `cacheControl` computes an automatic `ETag` from the loader's own data
  (never buffers the stream), with `If-None-Match` support. See
  [`docs/routing.md`](./docs/routing.md#redirecting-a-page) for the full `redirect` contract.
- ✅ **Selective hydration ("Comets")** — a `'use comet'`-marked file gets its own build output
  chunk (`cometPlugin`), hydratable at the point of use (`<Counter comet="visible" />`). See
  [`docs/comets.md`](./docs/comets.md) for the full flow.
- ✅ **Client-side navigation ("Orbit")** — `initOrbit()` intercepts same-origin `<a>` clicks and
  swaps just the page's own outlet, with hover/focus prefetch on by default. See
  [`docs/orbit.md`](./docs/orbit.md) for what falls back to a real navigation and the full prefetch
  contract.
- ✅ **Middleware** — a nonce-based default CSP + security headers on every page, plus `csrfGuard`,
  `langPreHandler`/`langGuard`, and `populationGuard`. See
  [`docs/middleware.md`](./docs/middleware.md) for the full precedence chain and each guard's own
  contract.
- ✅ **Testing helpers** (`@zanix/space/testing`) — `mockPageContext`/`renderPageForTest` for a
  page's `unit`/`functional` levels, plus the lower-level `mockHandlerContext`; see
  [Testing](#testing) below.
- ✅ **CSS** (`@zanix/space/vite`'s `cssPlugin`) — Tailwind v4 + typed CSS Modules by default,
  vanilla-extract opt-in, plus `defineSpaceApp({ theme: { resolve } })` for runtime, per-request
  token personalization. See [`docs/css.md`](./docs/css.md)/[`docs/theming.md`](./docs/theming.md).
- ✅ **PWA** (`defineSpaceApp({ pwa })`) — real icon resizing, a computed Web App Manifest, a small
  custom service worker. See [`docs/pwa.md`](./docs/pwa.md) for what's deferred.
- ✅ **Assets** (`defineSpaceApp({ assetsDir })`) — static files at `/assets/<relative-path>`,
  composable across a host/base-app pair, plus opt-in content-hashing and real image/video/
  thumbnail/voice-audio transformation. See [`docs/assets.md`](./docs/assets.md) for the full
  convention and what's deliberately deferred.
- ✅ **i18n content resolution** (`loadMessages`, `defineSpaceApp({ messagesDir })`) — a
  `(lang, population)` base+override catalog, cached, bypassed under `znx space dev`. See
  [`docs/i18n.md`](./docs/i18n.md) for the full contract.
- ✅ **Head management** (`SpacePageController.head`) — `<title>`/`<meta>`/`<link>` merged across
  the whole composition chain, most-specific-wins, deduplicated. See
  [`docs/head.md`](./docs/head.md) for the full precedence/dedup contract.
- ✅ **SEO helpers** (`buildHreflangLinks`, `buildCanonicalLink`,
  `defineSpaceApp({ sitemap, robots })`) — hreflang/canonical builders plus
  `sitemap.xml`/`robots.txt` as real SSR routes. See [`docs/seo.md`](./docs/seo.md) for the full
  contract.
- ✅ **CLI scaffolding** (`znx new space`/`znx new spacecraft`, from `@zanix/cli`) — seeds a whole
  new project with `--renderer`/opt-in `--icons`; `spacecraft` pairs it with a `@zanix/server`
  backend. See `@zanix/cli`'s own `docs/new.md` for the full scaffold contract.

## Features

- **Deno-native**: no Node runtime dependency, no CommonJS, no polyfills — built on `Deno.serve()`
  and Web Streams.
- **React 19 streaming SSR**: `renderToReadableStream` end to end, resolved natively by Deno's own
  export conditions — no adapter layer.
- **One serialized state block**: a single, predictable global carries server state to the client,
  instead of scattering multiple ad hoc globals.
- **Composes into the same Zanix App model as the backend**: embedded or remote, with no separate
  activation mechanism of its own — `@zanix/server` is the only thing that calls `Deno.serve()`.
  Running several Zanix Apps behind one origin (only one can own the whole domain — see
  `@zanix/app`'s own
  [Gateway](https://github.com/zanix-io/app/blob/master/docs/distributed-runtime.md#gateway-runtime))
  is that same package's concern, not a separate mechanism this one adds.

## Installation

```ts
import { defineSpaceApp } from 'jsr:@zanix/space@[version]'
```

**Requirements**: [Deno](https://docs.deno.com/runtime/getting_started/installation) 2.x.

## Basic Usage

```ts
// space.app.ts
import '@zanix/space/react' // or '@zanix/space/preact' — install exactly one, once
import { defineSpaceApp } from '@zanix/space'

export default defineSpaceApp({ name: 'storefront' }) // renderer: 'react' is the default
```

**`@zanix/space` itself ships no renderer.** Importing the framework never evaluates `react`,
`react-dom/server` or `preact`; the entry point you import decides which one your process loads, and
`defineSpaceApp({ renderer })` remains the single place your project declares its choice. The two
are checked against each other at startup, so declaring one renderer and importing the other's entry
point fails immediately with a message naming both.

A page, registered on a route inferred from its own file location (`routes/products/[id]/page.tsx`
resolves to `products/:id`):

```tsx
// routes/products/[id]/page.tsx
import { Page, SpacePageController } from '@zanix/space'

function ProductView({ product }: { product: { name: string } }) {
  return <h1>{product.name}</h1>
}

@Page()
export default class ProductPage extends SpacePageController<{ id: string }> {
  static cacheControl = 'public, max-age=60' // automatic ETag, computed from loader's own data
  loader = async (ctx: { params: { id: string } }) => ({
    product: await getProduct(ctx.params.id),
  })
  component = ProductView
}
```

### Routing, layouts and the document

A `layout.tsx`/`loading.tsx`/`error.tsx` next to (or above) a `page.tsx` wraps it automatically,
nested per directory level:

```
routes/
  products/
    layout.tsx   # wraps page.tsx and every nested route below it — never a route of its own
    loading.tsx  # Suspense fallback for this segment and everything nested under it
    error.tsx    # error boundary for this segment
    page.tsx
    [id]/
      page.tsx   # wrapped by both routes/products/layout.tsx AND any layout.tsx here too
```

```tsx
// routes/products/layout.tsx
import type { LayoutProps } from '@zanix/space'

export default function ProductsLayout({ children }: LayoutProps) {
  return <section className='products'>{children}</section>
}
```

A root `routes/layout.tsx` owns the actual `<html>` document (same contract as Next.js's App
Router); with none at all, `SpacePageController` wraps every page in a minimal spec-valid default
instead. `routesDir`'s own `not-found.tsx` renders for any unmatched route, and a thrown `loader`
recovers into a real rendered document — the nearest `error.tsx`, or `not-found.tsx` for
`HttpError('NOT_FOUND')` — instead of ever leaking raw JSON.

See [`docs/routing.md`](./docs/routing.md) for the full contract: `LayoutProps`'s renderer-neutral
typing, the renderer-agnostic `DocumentModel` both React and Preact serialize from, `error.tsx`'s
real current limits during server rendering, `createNotFoundHandler()`'s Orbit-aware behavior, and
the full loader-error recovery path.

### Selective hydration ("Comets")

A component that ships its own client bundle, hydrated independently of the rest of the page — a
directive, a named export, and its own `import.meta.url`:

```tsx
// comets/counter.tsx
'use comet'
import { defineComet } from '@zanix/space/comet'

export function Counter({ initial }: { initial: number }) {
  const [count, setCount] = useState(initial)
  return <button onClick={() => setCount((c) => c + 1)}>{count}</button>
}

export default defineComet(Counter, import.meta.url)
```

```tsx
// used from any page's component, same as any other component
import Counter from '../comets/counter.tsx'

<Counter initial={0} comet='visible' /> // hydrates once scrolled into view
```

See [`docs/comets.md`](./docs/comets.md) for the full contract: wiring, mount modes,
cross-navigation state persistence (`persist`), and the build-time `'server-only'` boundary.

### Client-side navigation ("Orbit")

Already on by default — every app's auto-generated client entry calls `initOrbit()` alongside
`hydrateComets()`, no configuration needed:

```ts
// your own client entry, only if you set SpaceAppConfig.clientEntry
import { initOrbit } from '@zanix/space/client'

initOrbit()
```

That's the entire integration — no server-side setup, no wiring into `vite.config.ts`. Every
same-origin `<a>` click now swaps in the next page's content instead of a full document reload,
updating the URL (`history.pushState`) and re-hydrating any comets in the new content. It degrades
safely (still a real `<a href>`, works with JS disabled or before this script loads) and warms links
ahead of a click via hover/viewport prefetch, on by default for hover.

For a navigation with no click to intercept — a Comet's own event handler navigating once a
`fetch()` it made resolves — call `navigate()` directly:

```ts
import { navigate } from '@zanix/space/client'

await navigate(`/products/${id}`)
await navigate('/checkout', { replace: true }) // replaceState instead of pushState
```

Runs through the exact same swap a real click does, byte-for-byte: prefetch reuse, the CSP-signature
check, stylesheet loading, `persist`-tagged Comet retention, and the same fallback to a real
navigation on any failure. A cross-origin `href` or a same-document hash link gets a real navigation
too, exactly like the equivalent `<a>` would.

See [`docs/orbit.md`](./docs/orbit.md) for the full contract: escape hatches, prefetch eligibility,
`Vary` caching, and the lower-level `renderToResponse`/`useRequestCache`/`readInitialState` surface
for rendering an element manually.

### Middleware (guards, default CSP and security headers)

Every page gets `Content-Security-Policy` and a small set of security headers automatically, with no
configuration — nonce-based, not `'unsafe-inline'`, coordinated with `renderToResponse`'s own inline
initial-state `<script>`:

```tsx
@Page('products/:id')
export default class ProductPage extends SpacePageController<{ id: string }> {
  loader = async (ctx) => ({ product: await getProduct(ctx.params.id) })
  component = ProductView
}
// → Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-<random, per request>'
// → X-Frame-Options: SAMEORIGIN
// → Referrer-Policy: strict-origin-when-cross-origin
// → X-Content-Type-Options: nosniff
```

`@zanix/space` also ships three more guard/pre-handler mechanisms: `csrfGuard` (double-submit-cookie
CSRF protection, opt-in), `langPreHandler`/`langGuard` (locale-prefixed routing, cookie-backed), and
`populationGuard` (resolves which segment/tenant a request is for, as `ctx.population`). See
[`docs/middleware.md`](./docs/middleware.md) for the full contract on all four.

### i18n content resolution (`loadMessages`)

The content-resolution half of i18n — given a `(lang, population)` pair (from `langPreHandler`'s own
`:lang` route segment and `populationGuard`'s own `ctx.population`), resolves the actual message
catalog to render:

```ts
// space.app.ts
export default defineSpaceApp({ name: 'storefront', messagesDir: './messages' })
```

```tsx
import { loadMessages } from '@zanix/space'
import { IntlProvider, useIntl } from '@zanix/space-ui'

loader = async (ctx: { params: { lang: string }; population?: string }) => ({
  lang: ctx.params.lang,
  messages: await loadMessages({ lang: ctx.params.lang, population: ctx.population }),
})
// NEVER interpolate `messages[key]` directly — once `zanix space build` compiles this app's
// `messagesDir`, a catalog value is precompiled AST, not a plain string, and rendering it as a
// JSX child crashes at runtime. Always format through `IntlProvider`/`useIntl` (below), which
// accepts either shape.
component = ({ lang, messages }) => (
  <IntlProvider locale={lang} messages={messages}>
    <PageContent />
  </IntlProvider>
)
function PageContent() {
  const { formatMessage } = useIntl()
  return <h1>{formatMessage('home/title')}</h1>
}
```

Reads `{messagesDir}/{lang}/index.json` (a base catalog) and, when `population` is given, an
override file, shallow-merging them — cached for the process lifetime, bypassed under
`znx space dev`. `loadMessages()` stays opaque to ICU/FormatJS on purpose — `@zanix/space-ui`'s
`IntlProvider`/`useIntl` is what actually formats a message. See [`docs/i18n.md`](./docs/i18n.md)
for the full contract.

### Head management

A page's `<title>`/`<meta>`/`<link>` declaration — a plain `HeadDescriptor`, or a function of
`loader`'s own resolved data (the same value `component` receives as props) when the head depends on
it — merges across the whole layout chain into one resolved value, most-specific-wins, deduplicated:

```tsx
@Page()
export default class ProductPage extends SpacePageController<{ id: string }> {
  loader = async (ctx: { params: { id: string } }) => ({ product: await getProduct(ctx.params.id) })
  static head = (data: { product: { name: string } }) => ({
    title: data.product.name,
    meta: [{ name: 'description', content: data.product.name }],
  })
  component = ProductView
}
```

See [`docs/head.md`](./docs/head.md) for the full contract: layout-chain precedence, `meta`/`link`
deduplication rules, coexistence with a hand-authored JSX `<title>`/`<meta>`/`<link>`, and what's
deliberately excluded (`style`/`script`) — see [SEO helpers](#seo-helpers) below for what's built on
top of it instead.

### SEO helpers

Hreflang links, a canonical-link builder, and `sitemap.xml`/`robots.txt` — built on
[Head management](#head-management) above, implemented as plain functions rather than React hooks,
so they can be called from `loader` (not just from inside a render tree):

```tsx
loader = (ctx: { url: URL; params: { lang: string } }) => ({
  link: [
    ...buildHreflangLinks({ url: ctx.url, lang: ctx.params.lang, availableLangs: ['en', 'es'] }),
    buildCanonicalLink({ url: ctx.url }),
  ],
})
static head = (data: { link: HeadLinkTag[] }) => ({ link: data.link })
```

`sitemap.xml`/`robots.txt` are registered as real SSR routes (never a build-time static file — this
app's own live data, always in sync, with `sitemap`'s array-vs-function caching bypassed under
`znx space dev`):

```ts
// space.app.ts
export default defineSpaceApp({
  name: 'storefront',
  sitemap: async () => [{ loc: '/en/products', priority: 0.9 }],
  robots: { rules: [{ userAgent: '*', disallow: ['/admin'] }] },
})
```

See [`docs/seo.md`](./docs/seo.md) for the full contract: the `x-default` hreflang resolution rule,
`buildCanonicalLink`'s `keepParams`, the array-vs-function caching guarantees for `sitemap`
(including the dev-mode bypass and production freshness trade-off), relative-vs-absolute URL
resolution, and every associated type.

### Testing

Helpers for testing a page at the `unit`/`functional` levels of the same
`unit`/`functional`/`integration` convention used across the Zanix ecosystem — imported from the
`@zanix/space/testing` subpath, never from the package's root entry point:

```ts
import { mockPageContext, renderPageForTest } from '@zanix/space/testing'

// unit — loader as a plain function, no rendering involved
Deno.test('ProductPage.loader returns the product', async () => {
  const data = await new ProductPage().loader(
    mockPageContext({ params: { id: '1' } }),
  )
  // ...assert on `data`
})

// functional — the real loader → component → handleGet pipeline, in-process, no HTTP
Deno.test('ProductPage renders the product', async () => {
  const { response, html } = await renderPageForTest(ProductPage, { id: '1' })
  // ...assert on `response`/`html`
})
```

`mockPageContext<Params>(overrides?)` builds the exact object shape a `loader`/`action` receives
(`request`/`url`/`params`/`csrfToken`/`population`/`session`), typed against the page's own `Params`
generic. `renderPageForTest(Controller, params?, ctxOverrides?)` instantiates `Controller`, calls
its real `handleGet`, and resolves once the streamed response has fully settled — generic over that
same `Params`. `mockHandlerContext` is the lower-level `HandlerContext` builder both use internally;
reach for it directly only when testing something below the page level, e.g. a custom `@Guard`.

### CSS

Tailwind v4 and CSS Modules by default, vanilla-extract as an opt-in — all three resolve to 100%
static CSS at build time (no runtime style injection to coordinate with content arriving out of
order via Suspense), plus real, per-request token personalization on top:

No server-side setup, no wiring into `vite.config.ts` — `zanix space build`/`zanix space dev` never
read one at all (`configFile: false`, every option passed inline) and compose `cssPlugin`
internally:

```ts
export default defineSpaceApp({
  name: 'storefront',
  theme: {
    resolve: ({ population }) =>
      population === 'tenant-b' ? { '--space-color-primary': '#16a34a' } : undefined,
  },
})
```

Global CSS accepts a `media` per entry (`{ href, media }`), a page controller can declare its own
`static styles`, and a Comet's own `*.module.css` ships only on a page that actually renders that
Comet — never globally. See [`docs/css.md`](./docs/css.md) for the build plugin's full contract,
including that responsive-delivery/scoping story, and [`docs/theming.md`](./docs/theming.md) for the
design-token convention, including the `theme.resolve` contract above in full (sanitization, CSP
`style-src`, `ETag` folding per population).

### Assets

Static assets (images, fonts) a component/page references by a stable public path, served at
`/assets/<relative-path>`:

```ts
// space.app.ts
export default defineSpaceApp({ name: 'shop', assetsDir: './assets' })
```

```tsx
// any component — referenced by path, never by import (see docs/assets.md for why that matters)
<img src='/assets/logo.svg' alt='Logo' />
```

`assetsDir` is resolved once, automatically (composable across a host/base-app pair, same
first-match-wins precedent as `routesDir[]`), and served over `@zanix/server`'s own trailing
catch-all route — same mechanism in dev and production. Opt-in on top of that: content-hashing with
real `immutable`/`ETag` caching (`assetsPlugin`, `resolveAssetHref`), build-time-only image/SVG
optimization, and real system-ffmpeg video/thumbnail/voice-audio transcoding
(`mediaPlugin({ optimize })`). See [`docs/assets.md`](./docs/assets.md) for the full contract.

#### Assets HTTP API

A separate concern from the static-file serving above: `@zanix/space/assets-api` is a real HTTP
upload/transform/download API for user-submitted assets (voice recordings, images, video) — a
`ZanixController` composed over `AssetService`, with deny-by-default guards and a configurable
per-kind upload size cap. See [`docs/assets-api.md`](./docs/assets-api.md) for the full contract.

### PWA

Real icon resizing (via `sharp`), a computed Web App Manifest, and a small, dependency-free service
worker — `manifest.webmanifest`/icons/`sw.js` each registered as their own explicit routes:

```ts
// space.app.ts — runtime: registers routes + injects <link rel="manifest">/theme-color/SW script
import { defineSpaceApp } from '@zanix/space'

export default defineSpaceApp({
  name: 'storefront',
  pwa: {
    name: 'Storefront',
    themeColor: '#2563eb',
    icon: './public/icon-source.png', // required — same source pwaPlugin resizes at build time
  },
})
```

See [`docs/pwa.md`](./docs/pwa.md) for the full contract: wiring `pwaPlugin`/`loadPwaBuildOutput`,
icon-size defaults, the service worker's precache/fetch strategy, and what's deferred.

### Logging

Client-bundled code (Comet hydration) never imports the server `@zanix/logger` directly — it logs
through a shared, browser-safe instance (`@zanix/utils@3.1.0`'s `createClientLogger`) that POSTs
each entry to `POST /api/log`, a route every `@zanix/space` app registers automatically. The handler
relays it into the server's own already-configured `@zanix/logger` via `Logger#ingest`, so a
browser-originated log persists through whatever backend (file, Elasticsearch, a custom sink) that
instance already uses — no extra wiring, and nothing to opt into. No full auth on this route (the
same genuinely-public posture `sitemap.xml`/`robots.txt` use), but it's not unprotected either — a
mandatory default `rateLimitGuard` bounds anonymous write volume. See
[`docs/logging.md`](./docs/logging.md) for the full request/response contract.

## Documentation

- [`docs/routing.md`](./docs/routing.md) — file-based routing, layout nesting, the document shell,
  and error/not-found recovery.
- [`docs/comets.md`](./docs/comets.md) — selective hydration: wiring, mount modes, `persist`.
- [`docs/orbit.md`](./docs/orbit.md) — client-side navigation, prefetch, and manual rendering.
- [`docs/middleware.md`](./docs/middleware.md) — CSP/security headers, `csrfGuard`, language
  routing, population resolution.
- [`docs/i18n.md`](./docs/i18n.md) — `loadMessages`'s content-resolution contract.
- [`docs/head.md`](./docs/head.md) — `<title>`/`<meta>`/`<link>` precedence and deduplication.
- [`docs/css.md`](./docs/css.md) — the `cssPlugin` build mechanics (Tailwind, CSS Modules, fonts).
- [`docs/theming.md`](./docs/theming.md) — design tokens, base → host precedence, light/dark, and
  runtime per-request personalization (`theme.resolve`).
- [`docs/assets.md`](./docs/assets.md) — content-hashing, image/SVG optimization, and the
  image/video/thumbnail/voice-audio transformation pipeline.
- [`docs/assets-api.md`](./docs/assets-api.md) — the Asset HTTP upload/transform/download API:
  composition, guards, size limits, magic-byte verification, and storage/repository adapters.
- [`docs/pwa.md`](./docs/pwa.md) — icons, Web App Manifest, and the service worker.
- [`docs/logging.md`](./docs/logging.md) — the browser-safe client logger and its `POST /api/log`
  relay.
- [`docs/seo.md`](./docs/seo.md) — canonical links, hreflang alternates, `robots.txt`/`sitemap.xml`.
- [`docs/validation.md`](./docs/validation.md) — build-time document validation and its three
  independent axes (severity, opt-in, strict).
- [`docs/data-fetching.md`](./docs/data-fetching.md) — REST/GraphQL clients server-side from a
  `loader`, plain `fetch()` client-side from a Comet, and the CSP `connect-src` grant either needs.

## Contributing

If you'd like to contribute to the project, follow these steps:

1. **Report Issues**: If you find any bugs or have suggestions, open an issue on the GitHub
   repository.
2. **Fork the Repo**: Fork the project and create a branch for your changes.
3. **Make Changes**: Develop new features or fix bugs while adhering to the project's coding
   guidelines.
4. **Submit a Pull Request**: Once your changes are ready, submit a pull request with a clear
   description of what you've done.

### Running tests locally

`deno test --min-dep-age=0 --allow-all` runs the whole suite — including the S3/ffmpeg-gated
functional tests below, which `ignore` themselves automatically when their real dependency isn't
available, so this works with zero setup for everything else.

To also exercise the S3-backed functional suite (`src/@tests/functional/assets-api/*-s3.test.ts`),
matching exactly what `.github/workflows/publish.yml` does in CI:

```sh
docker run -d -p 8333:8333 chrislusf/seaweedfs server -s3
curl -X PUT http://localhost:8333/zanix-objects/ # registers the default bucket — see publish.yml's
                                                  # own comment for why an implicit write isn't enough
RUN_S3_TESTS=true deno test --min-dep-age=0 --allow-all
```

The audio/video/calibration suite additionally needs a real `ffmpeg`/`ffprobe` on `PATH` with
`libvmaf`/`libvpx-vp9`/`libopus` support — a Homebrew install (`brew install ffmpeg`) has all three;
a plain `apt install ffmpeg` on Debian/Ubuntu commonly lacks `libvmaf`. Run the suite without either
requirement met and those tests simply report themselves as `ignore`d, same as the S3 ones above.

## Changelog

For a detailed list of changes, refer to the [CHANGELOG](./CHANGELOG.md).

## License

This project is licensed under the **MIT License**. See the [LICENSE](./LICENSE) file for more
details.
