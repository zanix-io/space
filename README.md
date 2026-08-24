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
  above) a `page.tsx` wraps it automatically, nested per directory level. See
  [below](#layouts-loading-and-error-segments) for `error.tsx`'s real current limits during server
  rendering.
- ✅ **Document shell** — a root `routes/layout.tsx` renders `<html>`/`<body>` itself (same contract
  as Next.js's App Router); with none at all, a default spec-valid document wraps the page instead.
- ✅ **Not-found page** — `routesDir`'s own `not-found.tsx` renders for any unmatched route, via
  `createNotFoundHandler()`. See [below](#not-found-page) for the opt-in Orbit-fragment behavior.
- ✅ **Static `redirect`/`cacheControl`** on `SpacePageController` — `redirect` runs before
  `loader`/`component`; `cacheControl` computes an automatic `ETag` from the loader's own data
  (never buffers the stream), with `If-None-Match` support.
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
  the whole composition chain, most-specific-wins, deduplicated. See [below](#head-management) for
  the full precedence/dedup contract.
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

### Layouts, loading and error segments

```
routes/
  products/
    layout.tsx   # wraps page.tsx and every nested route below it — never a route of its own
    loading.tsx  # Suspense fallback for this segment and everything nested under it
    error.tsx    # error boundary for this segment (see the limitation below)
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

**A real limitation, not a bug**: React's server renderer only recovers a thrown error for content
inside a `Suspense` boundary (Space always adds one where `error.tsx` exists), so a failing segment
stays a `200` instead of a shell-breaking `500` — but the fallback's own content only becomes
visible once the whole page hydrates client-side, which this package's Comet-only hydration story
doesn't do. Until then, `error.tsx` is real protection against the response breaking; it just
doesn't render its own UI yet.

### Document shell

A root `layout.tsx` (directly under `routesDir`) owns the actual `<html>` document:

```tsx
// routes/layout.tsx
import type { LayoutProps } from '@zanix/space'

export default function RootLayout({ children }: LayoutProps) {
  return (
    <html lang='en'>
      <head>
        <meta charSet='utf-8' />
        <meta name='viewport' content='width=device-width, initial-scale=1' />
      </head>
      <body>{children}</body>
    </html>
  )
}
```

The layout above is written exactly the same way under `--renderer=preact` — `LayoutProps` is
renderer-neutral (`children` accepts `SpaceChildren`, a structural type both React's `ReactNode` and
Preact's `ComponentChildren` satisfy); naming a renderer's own type explicitly
(`LayoutProps<ReactNode>`) still works for the rarer case that needs it.

**A root layout owns the document's structure and nothing else.** It never receives, and never has
to render, anything head-related — `@zanix/space` places the resolved head into the document itself,
under either renderer, so the layout above is complete exactly as written.

If a root layout is present, it's trusted as-is — nothing checks that it actually returns `<html>`/
`<body>`, the same contract Next.js's own App Router uses. With no root layout at all,
`SpacePageController` wraps every page in a minimal default document (`<!DOCTYPE html>`, UTF-8
charset, a responsive viewport meta tag). `zanix generate layout ''` writes the full document shape
above for exactly this reason — a bare `<div>` wrapper would silently replace a valid document with
one that has no doctype, `lang`, charset or viewport.

Global UI that should appear on every page (a header, footer, navigation) belongs in this same root
layout — there's no separate mechanism; nested layouts already compose the way a "global" and a
"per-section" wrapper would.

### The document contract

Everything `@zanix/space` decides about a response other than the component tree is resolved once,
into a single renderer-agnostic value, and only then handed to a renderer to serialize:

```
page + layout chain + loader data
              ↓
        DocumentModel          ← resolved once: title/meta/link, css, theme, lang, PWA
       ↙            ↘
React serializer   Preact serializer
       ↘            ↙
        final document
              ↓
     renderer-agnostic validation
```

Three consequences worth stating plainly:

- **`DocumentModel` is renderer-agnostic.** It and every type it is built from carry no React or
  Preact type at all — head resolution (`resolveHead`) happens once, in one place; the serializers
  perform no merging, deduplication or reordering of their own.
- **React and Preact are two implementations of one contract.** Given the same page, layout chain
  and resolved data, both produce a document with the same semantics (title/meta/link set, `lang`,
  stylesheet links) — not the same bytes (attribute order, void-element closing and whitespace
  legitimately differ) — asserted directly, across React, Preact, and both combined with PWA.
- **PWA is an orthogonal capability, not a renderer.** No "PWA renderer" and no third document shape
  — it contributes a manifest link, `theme-color`, and a service-worker registration to whichever
  renderer's document is already being produced (the real matrix is `renderer × pwa`, four
  combinations), with its own artifacts validated separately from the HTML.

### Not-found page

`routesDir`'s own `not-found.tsx` (a plain component, same convention as `error.tsx`) is what a
request with no matching route serves — wrapped in the same root layout as every other page, going
through the same `DocumentModel`/head resolution as any other page under either renderer:

```tsx
// routes/not-found.tsx
export default function NotFound() {
  return <h1>Page not found</h1>
}

// Optional — omit and the framework's own default (`{ title: 'Page not found' }`) applies.
export const head = { title: 'Page not found', meta: [{ name: 'robots', content: 'noindex' }] }
```

```ts
// main.ts — opt in explicitly, same as application; @zanix/space never wires this up on its own
import { createNotFoundHandler } from '@zanix/space'
import { bootstrapServers } from '@zanix/server'

await bootstrapServers({
  ssr: { application: 'storefront', onError: createNotFoundHandler() },
})
```

`createNotFoundHandler()` only ever handles an actual `404` — any other error still falls through to
`@zanix/server`'s own default error response, unchanged. With no `not-found.tsx` at all, it renders
a minimal built-in default instead of failing.

**Orbit-aware, opt-in**: an Orbit navigation to a missing route gets just the outlet fragment, same
as any other page's own fragment response — but only once `ssr.attachRequestToErrors: true` is also
set (default `false`, since it's what makes `@zanix/server` hand the original `Request`, which can
carry `Authorization`/cookies, to `onError` at all). Without the flag, every 404 still gets the full
document — Orbit's own client runtime already degrades gracefully on any non-`ok` fragment response,
just one wasted round-trip slower.

### Selective hydration ("Comets")

A component that ships its own client bundle, hydrated independently of the rest of the page — a
directive, a named export, and its own `import.meta.url`:

```tsx
// comets/counter.tsx
'use comet'
import { defineComet } from '@zanix/space'

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

```ts
// client entry — call once, alongside hydrateComets()
import { initOrbit } from '@zanix/space/client'

initOrbit()
```

That's the entire integration — no server-side setup, no wiring into `vite.config.ts`. Every
same-origin `<a>` click now swaps in the next page's content instead of a full document reload,
updating the URL (`history.pushState`) and re-hydrating any comets in the new content. It degrades
safely (still a real `<a href>`, works with JS disabled or before this script loads) and warms links
ahead of a click via hover/viewport prefetch, on by default for hover.

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

loader = async (ctx: { params: { lang: string }; population?: string }) => ({
  messages: await loadMessages({ lang: ctx.params.lang, population: ctx.population }),
})
component = ({ messages }) => <h1>{messages['home/title']}</h1>
```

Reads `{messagesDir}/{lang}/index.json` (a base catalog) and, when `population` is given, an
override file, shallow-merging them — cached for the process lifetime, bypassed under
`znx space dev`. `loadMessages()` stays opaque to ICU/FormatJS on purpose — `@zanix/space-ui`'s
`IntlProvider`/`useIntl` is what actually formats a message. See [`docs/i18n.md`](./docs/i18n.md)
for the full contract.

### Head management

A page's `<title>`/`<meta>`/`<link>` declaration — a plain `HeadDescriptor`, or a function of
`loader`'s own resolved data (the same value `component` receives as props) when the head depends on
it:

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

A `layout.tsx` may declare its own `head` too — a plain descriptor, or a function of `params` (not
`loader`'s data, since a layout has no `loader` of its own):

```ts
// routes/products/layout.tsx
export const head = () => ({ title: 'Products' })
```

**Precedence**: the page wins over its nearest layout, which wins over the next one out, ... down to
the root layout — checked field by field (`title`) or per identity key (`meta`/`link`), never
whole-descriptor-replaces-whole-descriptor. **Deduplication**: `meta` by identity key (`name`,
`property`, or `httpEquiv`); `link` by `rel`+`href` (plus `hreflang`, when set — two `alternate`
links can legitimately share an `href`, e.g. `x-default` and another language's own entry, and both
survive). The most specific declaration for a given key wins; different keys all survive.

**Coexists with a hand-authored JSX `<title>`/`<meta>`/`<link>` inside `component` — neither is ever
suppressed**, since this declaration's resolved output always renders BEFORE `component`'s own tree
— the document's FIRST `<title>` under both renderers (React 19's own hoisting in encounter order;
Preact places the resolved head at the front of `<head>` after rendering), confirmed by a dedicated
test asserting the exact ordering, not just presence. A root `layout.tsx` never has to cooperate
with this placement, and receives no head-related prop to.

Deliberately excludes `style`/`script` in this first iteration — a `<script>` for JSON-LD structured
data is `@zanix/space-ui`'s `StructuredData` component instead, rendered inline in `component`'s own
tree; see [SEO helpers](#seo-helpers) below.

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
(`request`/`url`/`params`/`csrfToken`), typed against the page's own `Params` generic.
`renderPageForTest(Controller, params?, ctxOverrides?)` instantiates `Controller`, calls its real
`handleGet`, and resolves once the streamed response has fully settled — generic over that same
`Params`. `mockHandlerContext` is the lower-level `HandlerContext` builder both use internally;
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

- [`docs/comets.md`](./docs/comets.md) — selective hydration: wiring, mount modes, `persist`.
- [`docs/orbit.md`](./docs/orbit.md) — client-side navigation, prefetch, and manual rendering.
- [`docs/middleware.md`](./docs/middleware.md) — CSP/security headers, `csrfGuard`, language
  routing, population resolution.
- [`docs/i18n.md`](./docs/i18n.md) — `loadMessages`'s content-resolution contract.
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
