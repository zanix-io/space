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

- ✅ **App manifest authoring** (`defineSpaceApp`) — identity, dependencies, and a `setup` escape
  hatch, forwarded to `@zanix/app`'s `defineZanixApp()`.
- ✅ **Streaming SSR core** (`renderToResponse`) — renders a React element tree to a streamed
  `Response` via `renderToReadableStream`, with a single serialized initial-state block and a
  request-scoped promise cache (`useRequestCache`) for `use()`.
- ✅ **Base Vite integration** (`spacePlugin`) — the two foundational Environment API targets
  (`client`/`ssr`) that later milestones (Comets, CSS) build on. `renderer: 'react'` (the default)
  always compiles through [React Compiler](https://react.dev/learn/react-compiler) too, via
  `@vitejs/plugin-react`'s own official `reactCompilerPreset()` — no opt-out flag. This is a
  build-time-only optimization (auto-memoization, no manual `useMemo`/`useCallback`/`React.memo`
  needed) strictly isolated to the React build path: `renderer: 'preact'` never loads, resolves, or
  executes any part of it — confirmed by a real spike before adoption (production build output,
  SSR/streaming output equivalence, and a real browser Fast Refresh session all verified directly,
  not assumed from documentation).
- ✅ **File-based page routing** (`SpacePageController`, `Page()`, `loadRoutes()`) — a
  `routes/**/page.tsx` file exports a `SpacePageController` subclass with
  `loader`/`component`/`action` as separate, independently testable members; `Page()` registers it
  on `@zanix/server`'s `'ssr'` handler type. `defineSpaceApp()` runs `loadRoutes()` automatically as
  part of this app's own `setup(ctx)` (via `@zanix/app`'s `activateApps()`) — an author never calls
  it directly — so nothing needs a manual route list. `@Page()` (no argument) infers the route from
  the file's own location under `routesDir`; an explicit `@Page('products/:id')` is still available
  as an escape hatch for a page reached outside that convention.
- ✅ **Layouts, loading and error segments** — a `layout.tsx`/`loading.tsx`/`error.tsx` sitting next
  to (or above) a `page.tsx` wraps it automatically, nested per directory level, with no
  registration of its own. See
  [Layouts, loading and error segments](#layouts-loading-and-error-segments) below for the real,
  current limits of `error.tsx` during server rendering.
- ✅ **Document shell** — a root `routes/layout.tsx` is trusted to render `<html>`/`<body>` itself,
  same contract as Next.js's own App Router; with no root layout at all, `SpacePageController` wraps
  the page in a default `<!DOCTYPE html>` document so it's still served as a real, spec-valid page.
- ✅ **Not-found page** — `routesDir`'s own `not-found.tsx` renders (wrapped in the same root
  layout) for any unmatched route, via `createNotFoundHandler()` passed as `bootstrapServers`'s own
  `ssr.onError` — a real per-server-type extension point. An Orbit navigation to a missing route
  gets just the outlet fragment instead of a full document, but only once
  `ssr.attachRequestToErrors` is also set — see [Not-found page](#not-found-page) below for why that
  stays opt-in.
- ✅ **Static `redirect`/`cacheControl`** on `SpacePageController` — `redirect` runs before
  `loader`/`component`, `cacheControl` sets the `Cache-Control` header and computes an automatic
  `ETag` (from the loader's own data, not the rendered HTML, so it never has to buffer the stream)
  with `If-None-Match` support.
- ✅ **Selective hydration ("Comets")** — a `'use comet'`-marked file gets forced into its own build
  output chunk by `cometPlugin` (`@zanix/space/vite`), correlated back to it via a manifest read at
  startup (`loadCometManifest`); `defineComet` marks a component hydratable at the point of use
  (`<Counter comet="visible" />`, not only by file location); `hydrateComets` (client-side) hydrates
  each boundary on its own declared timing. See
  [Selective hydration ("Comets")](#selective-hydration-comets) below for the full flow.
- ✅ **Client-side navigation ("Orbit")** — `initOrbit()` intercepts same-origin `<a>` clicks and
  swaps just the page's own outlet (never the root layout's header/footer) with a fragment fetched
  from the same route, via `document.startViewTransition()` when the browser supports it. Every link
  still works as a normal, full-page link with no JS at all. Hover/focus-based prefetch is on by
  default (viewport-based is opt-in) — see
  [Client-side navigation ("Orbit")](#client-side-navigation-orbit) below for what falls back to a
  real navigation and why, and for the full prefetch configuration.
- ✅ **Middleware (guards, default CSP and security headers)** — every page gets a nonce-based
  `Content-Security-Policy` and a small set of security headers (`X-Frame-Options`,
  `Referrer-Policy`, `X-Content-Type-Options`) automatically, customizable via a single
  `static headers` on the page class or, app-wide, via `defineSpaceApp({ headers })` — cross-origin
  isolation (COOP/COEP/CORP) is available there too, off by default; `csrfGuard()`
  (double-submit-cookie CSRF protection, opt-in), `populationGuard()` (resolves which segment/tenant
  content variant a request is for), and `defineMiddleware()` (other guards — rate limiting, custom
  checks — for every SSR page route) sit on `@zanix/server`'s own guard pipeline. See
  [Middleware (guards, default CSP and security headers)](#middleware-guards-default-csp-and-security-headers)
  below for what it can't do (per-`Application` scoping).
- ✅ **Language routing** (`langPreHandler` + `langGuard`) — a `PreHandler` (runs before route
  matching, not a guard) that 301-redirects any request missing its canonical `/{lang}/...` prefix,
  resolved from a persisted cookie, `Accept-Language`, or a configured default; its companion guard
  keeps that cookie fresh while browsing an already-prefixed URL, which the `PreHandler` can't do on
  its own. See
  [Language routing (`langPreHandler`, `langGuard`)](#language-routing-langprehandler-langguard)
  below.
- ✅ **Testing helpers** (`@zanix/space/testing`) — `mockPageContext`/`renderPageForTest` for a
  page's `unit`/`functional` levels, plus the lower-level `mockHandlerContext`; see
  [Testing](#testing) below.
- ✅ **CSS** (`@zanix/space/vite`'s `cssPlugin`) — Tailwind v4 + CSS Modules (typed, via a generated
  `*.module.css.d.ts` per file) by default, vanilla-extract opt-in; a `css-manifest.json` read back
  via `loadCssManifest` links a page's real, built stylesheet(s) automatically. See [CSS](#css)
  below for the static token-layer convention, and `defineSpaceApp({ theme: { resolve } })` for
  runtime, per-request token personalization (e.g. per-`population` branding) — no longer deferred.
- ✅ **PWA** (`@zanix/space/vite`'s `pwaPlugin` + `defineSpaceApp({ pwa })`) — real icon resizing
  (`sharp`), a computed Web App Manifest, and a small custom service worker (network-first
  navigations, cache-first everything else, precached CSS + offline fallback) — each served via its
  own explicit route. See [PWA](#pwa) below for what's deferred (Tier-2 manifest fields, maskable
  icons).
- ✅ **Assets** (`defineSpaceApp({ assetsDir })`) — static assets (images, fonts) served at
  `/assets/<relative-path>`, composable via a host override directory (array, first-match-wins, same
  precedent as `routesDir[]`) without forking the base app. Served over `@zanix/server`'s own
  trailing catch-all route, resolved once into a precomputed `Map` — the same mechanism in dev and
  production. Optional content hashing (`assetsPlugin`, `resolveAssetHref`) with real
  `immutable`/`ETag` caching for hashed responses, plus opt-in, build-time-only image/SVG
  optimization (`assetsPlugin({ optimize })` — responsive breakpoints, format conversion, never
  worsens an asset). See [Assets](#assets) below for the full convention and what's deliberately
  deferred (video/audio transcoding, module-aliased `import`s).
- ✅ **i18n content resolution** (`loadMessages`, `defineSpaceApp({ messagesDir })`) — resolves a
  flat message catalog for a `(lang, population)` pair: a base catalog plus an optional population
  override, shallow-merged, cached for the process lifetime (bypassed automatically under
  `znx space dev`, so an edited message file is reflected on the very next request). See
  [i18n content resolution (`loadMessages`)](#i18n-content-resolution-loadmessages) below for the
  full contract and what's deliberately deferred (a lazy/secondary content tier).
- ✅ **Head management** (`SpacePageController.head`, a `layout.tsx`'s own `head` export) — a
  page's/layout's `<title>`/`<meta>`/`<link>` declaration, merged across the whole composition chain
  (most-specific-wins, deduplicated by identity), resolved as plain data before either renderer ever
  runs. Coexists with a hand-authored JSX `<title>`/`<meta>`/`<link>` inside `component` — neither
  is ever suppressed. See [Head management](#head-management) below for the full precedence/dedup
  contract and the React-vs-Preact coexistence mechanism.
- ✅ **SEO helpers** (`buildHreflangLinks`, `buildCanonicalLink`,
  `defineSpaceApp({ sitemap, robots })`) — hreflang link generation (with a correct `x-default`,
  always self-referencing every configured language), a canonical-link builder, and
  `sitemap.xml`/`robots.txt` registered as real SSR routes, not build-time static files. Structured
  data (JSON-LD) lives in `@zanix/space-ui`'s `StructuredData` component instead — a UI-level
  concern, not a head-descriptor field. See [SEO helpers](#seo-helpers) below for the full contract
  and the real bugs this fixes over the legacy component these replace.
- ⏳ Not yet implemented: the CLI scaffolding (`znx new space`).

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

**A real limitation of server-side error boundaries, not a bug**: React's server renderer only
recovers a thrown error for content that lives inside a `Suspense` boundary — an `error.tsx`, on its
own, does keep a failing segment's response at `200` instead of a shell-breaking `500` (Space always
adds the `Suspense` boundary this requires), but the fallback's own content only becomes visible
once the page hydrates on the client — which needs this package's client hydration story, not
implemented yet. Until then, `error.tsx` is real protection against the whole response breaking; it
just doesn't render its own UI yet.

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
renderer-neutral, so the bare form (no type argument) is correct for both renderers. Its `children`
default is `SpaceChildren`, a structural type both React's `ReactNode` and Preact's
`ComponentChildren` accept; naming a renderer's own type explicitly (`LayoutProps<ReactNode>`,
`LayoutProps<ComponentChildren>`) still works and is what you reach for only if you need something
that type deliberately does not express (see its own JSDoc). Everything else, including everything
below, is identical.

**A root layout owns the document's structure and nothing else.** It never receives, and never has
to render, anything head-related — no `<title>`, no `<meta>` from props, no prop of any kind for
this. `@zanix/space` places the resolved head into the document itself, under either renderer, so
the layout above is complete exactly as written. If you have seen an older version of this framework
pass a `headExtras` prop that a Preact root layout was expected to render: that mechanism is gone,
and nothing depends on it any more.

If a root layout is present, it's trusted as-is — nothing checks that it actually returns `<html>`/
`<body>`, the same contract Next.js's own App Router uses for its root layout. With no root layout
at all, `SpacePageController` wraps every page in a minimal default document (`<!DOCTYPE html>`,
UTF-8 charset, a responsive viewport meta tag) so a brand new app still serves real, valid pages
before it defines any layout of its own. `zanix generate layout ''` writes the full document shape
above for exactly this reason — generating a bare `<div>` wrapper at the root would silently replace
a valid document with one that has no doctype, `lang`, charset or viewport.

Global UI that should appear on every page (a header, footer, or navigation) belongs in this same
root layout — there's no separate mechanism for it; nested layouts already compose the way a
"global" and a "per-section" wrapper would.

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

Three consequences worth stating plainly, because each one used to be untrue:

- **`DocumentModel` is renderer-agnostic.** It and every type it is built from carry no React or
  Preact type at all. Head resolution (`resolveHead`) happens once, in one place; the serializers
  perform no merging, deduplication or reordering of their own.
- **React and Preact are two implementations of one contract.** Given the same page, layout chain
  and resolved data, both produce a document with the same semantics — the same `<title>`, the same
  `<meta>`/`<link>` set, the same `lang`, the same stylesheet links. Not the same bytes: the two
  serializers legitimately differ on attribute order, void-element closing and whitespace, and none
  of that carries meaning. This is asserted directly, across React, Preact, React + PWA and Preact +
  PWA.
- **PWA is an orthogonal capability, not a renderer.** There is no "PWA renderer" and no third
  document shape. A PWA app contributes a manifest link, a `theme-color` and a service-worker
  registration to whichever renderer's document is already being produced; the real matrix is
  `renderer × pwa`, four combinations. Its own artifacts — the Web App Manifest and the service
  worker — are separate files, validated separately from the HTML.

### Not-found page

`routesDir`'s own `not-found.tsx` (a plain component, same convention as `error.tsx`) is what a
request with no matching route serves — wrapped in the same root layout as every other page:

```tsx
// routes/not-found.tsx
export default function NotFound() {
  return <h1>Page not found</h1>
}

// Optional — a `head` export, exactly like a `layout.tsx` may declare one. Omit it and the
// framework's own default (`{ title: 'Page not found' }`) applies.
export const head = { title: 'Page not found', meta: [{ name: 'robots', content: 'noindex' }] }
```

A not-found response is an ordinary document: it goes through the same `DocumentModel` and the same
head resolution as any page, and works identically under React and Preact. There is no
not-found-specific rule about `<title>` or headings anywhere in this framework.

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

**Orbit-aware, opt-in**: an Orbit navigation (see
[Client-side navigation (Orbit)](#client-side-navigation-orbit)) to a missing route gets just the
outlet fragment, same as any other page's own fragment response — but only once
`ssr.attachRequestToErrors` is also set:

```ts
await bootstrapServers({
  ssr: {
    application: 'storefront',
    onError: createNotFoundHandler(),
    attachRequestToErrors: true, // required for the Orbit-aware branch below
  },
})
```

This stays opt-in, default `false`, because it's what makes `@zanix/server` hand the original
`Request` to `onError` at all — and a `Request` can carry `Authorization`/cookies, so it's not
attached unless a consumer has deliberately decided to read it. Without the flag,
`createNotFoundHandler()` still works exactly as before: every 404 gets the full document, and
Orbit's own client runtime already degrades gracefully on any non-`ok` fragment response (a plain
`location.href` navigation), just one wasted round-trip slower.

```ts
// main.ts — activation is always @zanix/app's/@zanix/server's responsibility, never this package's
import spaceApp from './space.app.ts'
import { activateApps } from '@zanix/app/runtime'
import { bootstrapServers } from '@zanix/server'

// Registers this app's routes/dependencies/setup (loadRoutes() runs here, internally) and runs
// onStart — see @zanix/app's own docs for activateApps()/deactivateApps().
await activateApps([spaceApp])
// `application` must match the app's own `name` — @zanix/space never assumes a default Application.
await bootstrapServers({ ssr: { application: 'storefront' } })
```

### Selective hydration ("Comets")

A comet file needs three things — a directive, a named export, and its own `import.meta.url`:

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

- **`'use comet'`** — the file's first statement (same grammar slot `'use client'` uses in React
  Server Components). It's how `cometPlugin` finds this file and forces it into its own build output
  chunk, without needing it to live under any particular directory.
- **`export function Counter`** — a _named_ export, never anonymous. `defineComet` reads
  `Counter.name` to know what the client should import back out of this same module once it's
  fetched; the wrapped version below becomes the file's default export instead, so the two never
  collide.
- **`import.meta.url`** — always written at this exact call site. It's this file's own identity,
  correlated to whatever hashed URL its client build actually produced.

```ts
// vite.config.ts — required so a comet's file is actually built as its own separate output chunk,
// rather than getting inlined into whatever page imports it to render it server-side
import { defineConfig } from 'vite'
import { cometPlugin, spacePlugin } from '@zanix/space/vite'

export default defineConfig({
  plugins: [spacePlugin(), cometPlugin()],
})
```

```ts
// main.ts — load the manifest cometPlugin wrote during the client build, before serving anything
import { loadCometManifest } from '@zanix/space'
import { activateApps } from '@zanix/app/runtime'
import { bootstrapServers } from '@zanix/server'
import spaceApp from './space.app.ts'

await loadCometManifest('./dist/client/comets-manifest.json')
await activateApps([spaceApp])
await bootstrapServers({ ssr: { application: 'storefront' } })
```

```tsx
// used from any page's component, same as any other component
import Counter from '../comets/counter.tsx'

<Counter initial={0} comet='visible' /> // hydrates once scrolled into view
<Counter initial={0} /> // hydrates immediately (comet defaults to 'load')
```

```ts
// client entry — call once, after the page loads
import { hydrateComets } from '@zanix/space/client'

hydrateComets()
```

> **Match the client barrel to your renderer.** `@zanix/space/client` is the **React** barrel; a
> `renderer: 'preact'` app imports `@zanix/space/client/preact` instead — same exports, same
> signatures, Preact's `hydrate`/`render` underneath rather than React's `hydrateRoot`/`createRoot`.
> An app imports one or the other, never both, since `renderer` selects one for the whole project.
>
> Getting this wrong used to fail silently: the page server-rendered correctly, every comet boundary
> and all its content appeared in the DOM, nothing threw anywhere — and no Comet was ever
> interactive. `spacePlugin({ renderer })` now fails the client build with an explicit error if the
> entry imports the wrong one, so the mismatch cannot reach a browser.

**Why this needs a manifest at all**: the same comet source file gets evaluated twice — once during
server rendering (a direct Deno import, producing real HTML) and once in the client build (its own
bundled chunk) — two separate module instances in two different environments. A value read during
the server-side evaluation, like `import.meta.url` there, does not by itself resolve to the client
chunk's own hashed URL. `cometPlugin` closes that gap: during the client build it writes
`comets-manifest.json` (source file → real built URL), and `loadCometManifest` reads it back at
startup so `defineComet` can resolve the right URL per request. In development, no manifest is
needed at all — Vite's dev server already serves every project file at its own root-relative path,
so `defineComet` derives a working URL directly, with zero build step involved.

`comet="only"` mounts fresh on the client (`createRoot`, never `hydrateRoot`) instead of rendering
server-side at all — used for something that only ever makes sense running in a browser.

**Preserving state across Orbit navigation**: add `persist` with a stable key to keep a comet's real
DOM node (and its component state) alive across an Orbit swap, instead of tearing it down and
re-hydrating it fresh every time — useful for something like an in-progress form or an open dropdown
that shouldn't reset just because the user navigated away and back:

```tsx
<Counter initial={0} comet='visible' persist='home-counter' />
```

Retained per `persist` key, bounded to the 5 most recently used — reused only when the SAME comet
(same module + export) reappears under that key later; anything beyond the cap, or a mismatched
comet reappearing under a reused key, is simply discarded, same as before this existed.

**Server-only code can never leak into a Comet's client bundle, enforced at build time**: mark a
module `'server-only'` (same directive-prologue mechanism as `'use comet'`) and `cometPlugin` fails
the build — a real, fatal error, not a warning — if that module is ever reachable from a Comet, even
transitively through other modules, printing the exact import chain so the fix is obvious:

```ts
// db/client.ts
'server-only'
export function query() {/* ... */}
```

Nothing here adds a runtime check to the shipped bundle; this only ever runs during `cometPlugin`'s
own build step.

**Making a Comet's own presentation host-overridable** (a different concern from theming, above —
swapping just ONE component's look, not app-wide tokens): a Comet is composed as part of a Zanix App
manifest, so it can resolve its own className/style via `@zanix/app`'s `resolveBehavior()` — see
`@zanix/app`'s own README, "Style-only overrides — keep the component's own logic, swap only its
presentation," for the full pattern and its one real precondition (the Comet's own author has to opt
in by adding that call; it's not retroactive).

### Client-side navigation ("Orbit")

```ts
// client entry — call once, alongside hydrateComets()
import { initOrbit } from '@zanix/space/client'

initOrbit()
```

That's the entire integration — no server-side setup, no wiring into `vite.config.ts`. Every
same-origin `<a>` click now swaps in the next page's content instead of a full document reload,
updating the URL (`history.pushState`) and re-hydrating any comets in the new content. Nothing here
requires a page to opt in, and nothing breaks if it never runs: a link is a real `<a href>` either
way, so it still fully works with JavaScript disabled, before this script loads, or if the fetch
itself fails.

**What gets swapped, and what doesn't**: only what's inside the page's own composed tree — a
header/footer/nav declared in the root `layout.tsx` (see [Document shell](#document-shell)) sits
outside that boundary and is never re-fetched or re-rendered on navigation. What Orbit does _not_ do
yet: preserve a shared _nested_ layout across sibling routes (`/products/1` → `/products/2` still
re-renders everything under the root layout, not just the leaf page) — that needs comparing route
trees between the current and target URL, a real follow-up, not implemented here.

**Escape hatches**: add `data-orbit-hard` to a specific `<a>` to force a real navigation for it. A
modified click (<kbd>Cmd</kbd>/<kbd>Ctrl</kbd>/<kbd>Shift</kbd>/middle-click), `target="_blank"`, a
cross-origin `href`, or a same-document hash-only link (`<a href="#section">`, or the current path
plus a hash) are never intercepted either — exactly the cases a plain link's own default behavior
already handles correctly (the last one specifically preserves the browser's native "scroll to this
element" behavior instead of re-fetching identical content). Any non-successful fragment response (a
`404`, a `500`, a network failure) degrades to a real navigation rather than risking invalid markup
in the page.

**Back/forward navigation** (`popstate`) is handled the same way as a link click — a `popstate`
event re-fetches and swaps the outlet for the URL the browser navigated back/forward to, so the
back/forward buttons stay instant too, not just forward navigation via clicks.

**Caching**: every response `SpacePageController`/`createNotFoundHandler` produce sets
`Vary: x-space-navigate` unconditionally (whether or not the page also declares `cacheControl`) —
the response body genuinely differs (full document vs. bare outlet fragment) depending on that
request header, so any HTTP cache sitting in front of the app needs to key on it too, not just
Orbit's own client runtime.

**Prefetch**: `initOrbit()` warms a link's fragment ahead of a click, so the actual navigation often
finds it already cached. Two independent triggers, each can be on, off, or both:

```ts
initOrbit() // default: hover/focus prefetch on, viewport prefetch off
initOrbit({ prefetch: { onViewport: true } }) // adds viewport, hover/focus still on by default
initOrbit({ prefetch: { onHover: false, onViewport: true } }) // viewport only
initOrbit({ prefetch: false }) // disables prefetch entirely — Orbit itself is unaffected
```

- **`onHover`** (`mouseenter`/`focusin`, **on by default**) — a real intent signal: the user is
  pointing at or has focused the link, not just scrolling past it. Debounced (~120ms) so quickly
  passing the cursor over several links doesn't fire one request per link.
- **`onViewport`** (`IntersectionObserver`, **opt-in**) — a lower-intent signal than hover: a page
  with many links would otherwise prefetch aggressively during an ordinary scroll, for links the
  user may never actually visit. Off by default for exactly that reason.

Both triggers share the same eligibility rules as a real click (`data-orbit-hard`, same-origin,
`target="_self"`, never a same-document hash-only link) plus one more: prefetch never starts at all
when `navigator.connection.saveData` is on, or `effectiveType` reports `'slow-2g'`/`'2g'` — a silent
guard on the OPTIMIZATION only. Real navigation (an actual click, or `popstate`) is never affected
by connection quality or anything else about prefetch — it's not in this decision at all.

**Prefetching is a pure optimization, deliberately isolated from navigation semantics**: at most 4
prefetches run concurrently (a 5th trigger while at capacity is simply dropped, no queue, no retry),
each result is cached for a short window and deduplicated per URL, and a prefetch that fails,
expires before it's used, or was never attempted changes nothing about what a click does —
`swapOutlet` only ever _consults_ the prefetch cache before falling back to the exact same fetch it
always made. A failed prefetch is evicted from the cache immediately (not left around for the rest
of its own window), so a click on a link whose prefetch already failed still gets a genuinely fresh
`fetch()` of its own — never a guaranteed repeat of a failure that might have only been transient.
Uses the same `x-space-navigate` header a real navigation does, so on a page with `cacheControl`,
the browser's own HTTP cache (revalidated by `ETag`) can serve the real navigation from the very
same entry the prefetch already warmed — no separate cache needed for that case.

Rendering an element directly, without going through a page controller:

```tsx
import { renderToResponse, useRequestCache } from '@zanix/space/react'

function ProductView({ id }: { id: string }) {
  const product = useRequestCache(`product:${id}`, () => getProduct(id))
  return <h1>{product.name}</h1>
}

const response = await renderToResponse(<ProductView id='1' />, {
  initialState: { id: '1' },
})
```

`useRequestCache` is React-only — Preact core has no `Suspense`/`use()`, so there's no way for it to
suspend a component the way this needs. Under `--renderer=preact`, resolve the data inside the
page's own `loader` instead and pass it down as a prop; calling `useRequestCache` there throws a
clear error immediately, before touching the fetcher.

On the client, read back the state a server render handed off (import from `@zanix/space/client`,
never from the root entry point, to avoid pulling `react-dom/server` into the browser bundle):

```ts
import { readInitialState } from '@zanix/space/client'

const { id } = readInitialState<{ id: string }>() ?? {}
```

**What's safe to put in `initialState` (or a Comet's own props)**: plain JSON only — the same values
`JSON.stringify`/`JSON.parse` round-trip losslessly (strings, finite numbers, booleans, `null`, and
plain arrays/objects of the same). `undefined`/functions are silently dropped, `Date` serializes to
an ISO string (never revived back into a real `Date`), `Map`/`Set` both serialize to `{}` — every
entry is lost, so convert to a plain object/array first. A circular reference or `BigInt` fails
outright: `renderToResponse` resolves a `500` (calling `onError`, if given) instead of throwing; a
Comet's own unserializable prop throws a clear error naming the Comet instead.

**Carrying `Date`, `Map` and `Set`** — opt in per app, off by default:

```ts
defineSpaceApp({ name: 'storefront', serialization: { extendedTypes: true } })
```

Those three then round-trip as real instances, through both `initialState` and Comet props, on both
renderers. Everything else above is unchanged: `undefined`/functions are still dropped, and a
circular reference or `BigInt` still fails exactly the same way. Scoped to those three types on
purpose — Space does not ship a general richer-than-JSON wire format, and this option is not a step
toward one. With it off, the bytes on the wire are byte-for-byte what they were before it existed.

### Middleware (guards, default CSP and security headers)

Every page gets `Content-Security-Policy` and a small set of security headers automatically, with no
configuration:

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

The default CSP is **nonce-based**, not `'unsafe-inline'`: `renderToResponse` always emits an inline
`<script>` for the page's initial-state block, so a naive default (`script-src 'self'` with no
exception) would make the framework block its own hydration. Instead, `SpacePageController`
generates a fresh, cryptographically random nonce on every request, puts it in both the CSP header
and that `<script>` tag's `nonce` attribute (via React's own `renderToReadableStream({ nonce })`
option), so the policy stays strict without needing `'unsafe-inline'`. Verified end to end in
`page-default-security.test.tsx` — the header's nonce and the rendered script's `nonce` attribute
are asserted to match, not just each existing independently.

**Customize per page** via a single `static headers` on the page class (or `@Page({ headers })`) —
`csp` is just one field among the rest, not a separate option, since it's still fundamentally a
response header:

```tsx
export default class CheckoutPage extends SpacePageController {
  static headers = {
    // A custom, static CSP — loses the automatic nonce coordination; permit 'unsafe-inline' or
    // build your own nonce-based policy with cspGuard's function form if this page also needs the
    // initial-state script to survive a strict script-src.
    csp: {
      'default-src': ["'self'"],
      'frame-src': ['https://payments.example.com'],
    },
    frameOptions: 'DENY' as const, // overrides just this one field; the rest keep their own default
  }
  component = CheckoutView
}
```

`headers: false` disables everything (CSP included) for that page. `headers: { csp: false }`
disables just CSP while keeping the rest of the defaults.

**Customize app-wide, once, instead of repeating it on every page** — CSP/security headers are
conventionally configured once per app in practice (this is what `helmet`/Next.js middleware/etc.
do), not per page, so `defineSpaceApp()` — the one file every app already writes — takes the same
`headers` shape as a page's own `static headers`:

```ts
// space.app.ts
import { defineSpaceApp } from '@zanix/space'

export default defineSpaceApp({
  name: 'storefront',
  headers: { frameOptions: 'DENY', csp: { 'default-src': ["'self'"] } },
})
// every page now gets this policy — unless that specific page sets its own `headers`, which still
// wins (precedence: page's own `headers` > this app-wide default > the framework's built-in default)
```

**A page overriding one field never loses the rest of the app-wide default** — the two levels are
merged field by field, not swapped as whole objects:

```ts
// app-wide (above): { frameOptions: 'DENY', csp: {...} }

export default class SomePage extends SpacePageController {
  static headers = { noSniff: false } // only this one field is touched
  // frameOptions stays 'DENY' and csp stays the app-wide policy — neither reverts to the
  // framework's own built-in defaults just because this page customized something else.
}
```

`csp` itself is the one field merged as a whole, not directive-by-directive — a page setting its own
`csp` replaces the app-wide policy entirely (still leaving every _other_ field, like `frameOptions`,
merged normally).

There's no separate `<Helmet>`-style component for this, deliberately — an HTTP response header has
to be decided _before_ the response body starts streaming, so nothing rendered by the component tree
can ever influence it in time; a component-based API would be actively misleading here. (Document
`<head>` tags — `<title>`/`<meta>`/`<link>` — are a different, already-solved problem: React 19
hoists those natively from anywhere in the tree, no Helmet needed for that either.)

**For a guard that isn't CSP/security headers** (rate limiting, custom auth-like checks), reuse
`@zanix/server`'s real guard mechanism directly — `@zanix/space` doesn't wrap or reimplement it:

```ts
import { Guard } from '@zanix/server'
import { rateLimitGuard } from '@zanix/auth'
import { Page, SpacePageController } from '@zanix/space'

@Page('checkout')
@Guard(rateLimitGuard({ windowSeconds: 60, anonymousLimit: 20 }))
export default class CheckoutPage extends SpacePageController {
  component = CheckoutView
}
```

`defineMiddleware(guards)` registers one or more `MiddlewareGuard`s for every SSR page route in the
process at once, via `@zanix/server`'s own `registerGlobalGuard`, scoped to `'ssr'` routes only —
the right tool for something that isn't CSP/security headers and genuinely needs to apply everywhere
(there's no per-`Application` scoping: a guard passed here applies to every `'ssr'` route in the
process, regardless of which `Application` owns it).

**Every security header this framework manages — CSP included — resolves through the same three-tier
chain**: this page's own explicit config (via `Page({ headers })`, or the app-wide
`defineSpaceApp({ headers })` default when this page sets none of its own) beats a guard registered
via `defineMiddleware`/`@Guard` (`cspGuard()`/`securityHeadersGuard()`), which in turn beats this
page's own zero-config default — the same order each header resolves in when nothing else is
configured at all. Applies uniformly to `csp`, `frameOptions`, `referrerPolicy`, `noSniff`, and
every other field `securityHeadersGuard()` manages:

```ts
defineMiddleware([
  cspGuard({ 'default-src': ["'self'"] }),
  securityHeadersGuard({ frameOptions: 'DENY' }),
])

export default class SomePage extends SpacePageController {
  static headers = { csp: { 'default-src': ["'unsafe-inline'"] } }
}
// → Content-Security-Policy: default-src 'unsafe-inline' (this page's own policy, tier 1)
// → X-Frame-Options: DENY (this page configured nothing for this field — the guard's, tier 2)

export default class OtherPage extends SpacePageController {}
// → Content-Security-Policy: default-src 'self' (the guard's policy, tier 2)
// → X-Frame-Options: DENY (the guard's policy, tier 2)
```

`false` is tier 1 too, for every field that accepts it — an explicit "no header for this page" that
wins even over a registered guard, ending up with that header **completely absent** from the
response (never an empty value, never the guard's policy, and never the two combined into one
comma-joined value):

```ts
export default class CheckoutPage extends SpacePageController {
  static headers = { csp: false, frameOptions: false }
}
// → no Content-Security-Policy header at all, even with the guard above registered
// → no X-Frame-Options header at all, even with the guard above registered
```

A page in an app with no guard registered for a given field at all falls through to tier 3, that
field's own zero-config default (nonce-based for CSP;
`SAMEORIGIN`/`strict-origin-when-cross-origin`/ `nosniff` for
`frameOptions`/`referrerPolicy`/`noSniff` — the three that have one at all), exactly as before this
precedence chain existed. A field with no zero-config default of its own
(`permissionsPolicy`/`strictTransportSecurity`/the three cross-origin-isolation fields, all off by
default) simply stays absent in that case, same as always.

**Cross-origin isolation** (`SharedArrayBuffer`, precise timers) is available but off by default —
`crossOriginOpenerPolicy`/`crossOriginEmbedderPolicy`/`crossOriginResourcePolicy` on `headers` (or
`securityHeadersGuard`'s own options) — off by default because the strict values break ordinary
OAuth/payment popups and third-party embeds unless the whole app is updated for it.

### CSRF protection (`csrfGuard`)

Real, standalone code — the double-submit-cookie pattern, not something reused from elsewhere. Not
applied by default (unlike CSP/security headers, this can reject a real request outright, so an
automatic default risks silently breaking any existing `action` that doesn't render the token yet):

```tsx
import { Guard } from '@zanix/server'
import { csrfGuard, Page, SpacePageController } from '@zanix/space'

@Page('checkout')
@Guard(csrfGuard())
export default class CheckoutPage extends SpacePageController {
  loader = (ctx) => ({ csrfToken: ctx.csrfToken })
  component = CheckoutView
  action = async (
    ctx,
  ) => {/* csrfGuard already validated by the time this runs */}
}

function CheckoutView({ csrfToken }: { csrfToken?: string }) {
  return (
    <form method='post'>
      <input type='hidden' name='_csrf' value={csrfToken} />
      {/* ... */}
    </form>
  )
}
```

On a `GET`, the guard issues (or reuses) a token in an `HttpOnly` cookie and makes it available as
`ctx.csrfToken` inside `loader` — hand it to `component` to render as the hidden field above. On any
other method, the request is rejected unless the submitted token (that `_csrf` field, or an
`x-csrf-token` header for a fetch/XHR-based action) matches the cookie.

**The cookie name must start with `X-Znx-`** (default: `X-Znx-Csrf`) — `@zanix/server`'s own
`cookiesGuard` filters `ctx.cookies` down to only that prefix before any guard runs; anything else
is silently invisible to `csrfGuard` no matter what's actually on the wire. This was a real bug
caught during development — a cookie named `znx-csrf` (lowercase, no `X-` prefix) issued and echoed
back correctly at the HTTP level, but the guard could never see it.

`@zanix/auth`'s own session cookies already default to `SameSite=Strict`, which mitigates most
classic CSRF on its own — `csrfGuard` is real defense-in-depth on top of that, or a substitute for
an app not using `@zanix/auth`'s cookies at all.

### Language routing (`langPreHandler`, `langGuard`)

A **`PreHandler`**, not a guard — `@zanix/server`'s pre-route-matching hook, since guards (and a
page's own `static headers`) only ever run AFTER a route has already matched, too late for a
redirect keyed on the URL not matching a language-prefixed route at all:

```ts
import { bootstrapServers } from '@zanix/server'
import { langPreHandler } from '@zanix/space'

await bootstrapServers({
  ssr: {
    preHandler: langPreHandler({ availableLangs: ['en', 'es'], defaultLang: 'en' }),
  },
})
```

Every page is expected to live under a `routes/[lang]/...` folder — `Space`'s own `[param]` folder
convention already maps that to a `:lang` route segment, nothing new there. A request whose first
path segment is already one of `availableLangs` falls through unchanged; otherwise it resolves a
language — a persisted `X-Znx-Lang` cookie, then `Accept-Language`, then `defaultLang` — and
301-redirects to that same path with it prepended (`/products` → `/en/products`, `/` → `/en`),
setting the cookie on that same response. Never redirects a framework-internal route (`/health`,
`/ready`, `/assets/`, `/icons/`, `/manifest.webmanifest`, `/sw.js`) — `ignorePrefixes` extends that
list for an app's own non-i18n routes, never replaces it.

The `PreHandler` alone only ever updates the cookie on an actual redirect — it can only return a
full `Response` or `null`, so an already-correctly-prefixed request (the common case: someone
browsing entirely under `/es/...` via a language switcher's own links) has no way to refresh a stale
cookie from an earlier visit through this hook. `langGuard` closes exactly that gap: it runs AFTER
route matching, where a guard's returned `headers` DO get merged into the response, and reads the
language back out of the matched route's own `:lang` param:

```tsx
import { defineMiddleware, langGuard } from '@zanix/space'

export default defineMiddleware([langGuard()])
```

Purely additive, same as `populationGuard` — never rejects a request, so it's safe to apply app-wide
via `defineMiddleware`. Pass it the same `cookieName` given to `langPreHandler` if that was
customized; both default to `X-Znx-Lang`. Requires `@zanix/server >= 3.2.0` — an earlier version has
a bug where two guards returning the same header (here, `Set-Cookie`) on the same route silently
clobber each other, which would break `populationGuard` and `langGuard` coexisting on one page (see
that package's own CHANGELOG).

**No per-route opt-out** — unlike the legacy mechanism this replaces (which let individual pages
skip the language prefix), every route is prefixed uniformly. Simpler, and nothing in `@zanix/space`
today has a proven need for mixing prefixed and unprefixed pages in the same app; that flexibility
can be added if a real case shows up, rather than built speculatively now.

### Population resolution (`populationGuard`)

Resolves which population (segment/tenant content variant) the current request is for — route param,
then query string, then a persisted cookie, in that order — and exposes it as `ctx.population`
inside `loader`. Purely additive, unlike `csrfGuard`: it never rejects a request, so (like
`cspGuard`/`securityHeadersGuard`) it's safe to apply to every page at once via `defineMiddleware`,
not just per-page:

```tsx
import { defineMiddleware, populationGuard } from '@zanix/space'

export default defineMiddleware([populationGuard()])
```

```tsx
loader = (ctx) => ({ population: ctx.population })
component = ({ population }) => <p>Showing content for: {population ?? 'default'}</p>
```

Resolved **on the server**, not just the client — `@zanix/space` is SSR-first specifically to avoid
a client-side-only personalization step causing a flash of the wrong content after hydration, so a
request carrying only the cookie (no param, no query) still gets the right population from the very
first response. When the value came from the param or query string and doesn't already match the
cookie, the response also sets it (`Set-Cookie`) — so the next visit, with neither in the URL, still
resolves correctly. **The cookie name must start with `X-Znx-`** (default: `X-Znx-Population`), same
constraint and same reason as `csrfGuard`'s own cookie — but deliberately **not** `HttpOnly`: unlike
the CSRF token, client-side code is expected to be able to read this one too.

If a shared HTTP cache ever sits in front of `@zanix/space`, that layer needs `Vary` on this cookie
— an SSR response that varies per-visitor cookie can't be cached the same way a uniform one can.
Nothing in `@zanix/space` itself assumes a shared cache exists today.

This guard only resolves _which_ population a request belongs to — the actual population-specific
_content_ (message/override files, merge precedence, caching) is `loadMessages`'s own job, see
below.

### i18n content resolution (`loadMessages`)

The content-resolution half of i18n — given a `(lang, population)` pair (from `langPreHandler`'s own
`:lang` route segment and `populationGuard`'s own `ctx.population`), resolves the actual message
catalog to render:

```ts
// space.app.ts
export default defineSpaceApp({ name: 'storefront', messagesDir: './messages' })
```

```
messages/
  en/
    index.json                 # base catalog: { "home/title": "Welcome" }
    populations/
      zanix.json                # override: only the keys that differ from the base
  es/
    index.json
```

```tsx
import { loadMessages } from '@zanix/space'

loader = async (ctx: { params: { lang: string }; population?: string }) => ({
  messages: await loadMessages({ lang: ctx.params.lang, population: ctx.population }),
})
component = ({ messages }) => <h1>{messages['home/title']}</h1>
```

Reads `{messagesDir}/{lang}/index.json` (the base catalog) and, when `population` is given,
`{messagesDir}/{lang}/populations/{population}.json` (an override), then shallow-merges them:
`{ ...base, ...override }`. This is only correct because catalogs are **flat**,
namespaced-string-key objects — never nested; a nested shape would silently lose sibling keys on any
collision instead of merging.

A missing override file is the normal case (not every population overrides every language) and
resolves silently to the base catalog. A missing base file logs a warning and resolves to `{}` —
language-level fallback (redirecting to `defaultLang`) is `langPreHandler`'s job, not this
function's; by the time a `loader` calls this, the URL's `lang` is already valid. A malformed file
(invalid JSON, or not a flat object) logs an error and is skipped — the base and override are each
read and validated **independently**, so a broken override degrades to base-only instead of
discarding an otherwise-valid base render.

Cached for the process lifetime, keyed by `${lang}:${population ?? ''}`. Concurrent calls for the
same not-yet-cached key share a single in-flight resolution instead of each redoing the same file
I/O — this de-duplication still applies under `znx space dev` too (see below).

**The cache is bypassed entirely under `znx space dev`** — editing a message file while the dev
server is running is reflected on the very next request, no restart needed, the same live-edit
experience `assetsDir` already gives. Automatic, driven by the same dev-mode flag every other Space
dev-time behavior already reads — not an opt-in flag a caller has to remember to pass (the legacy
component this replaces had the equivalent plumbed through end to end but never actually triggered
by anything in that repo).

`messagesDir` accepts an array too — same first-match-wins host-composition precedent as
`routesDir`/`assetsDir`, resolved independently for the base file and the override file.

**Deliberately deferred, not implemented here**: a secondary "lazy content" tier fetched after first
paint. The legacy component this replaces had one — client-side, fetched over HTTP after hydration —
but it existed to solve a problem specific to a CSR-first app bolting SSR on: `@zanix/space` is
SSR-first, so a page's `loader` already resolves (and embeds in the initial serialized state)
whatever it calls `loadMessages()` for; there's no post-hydration gap to fill the same way. If a
real page ever needs to defer a genuinely large, non-critical message subset, a Comet fetching its
own subset on hydration is the natural fit — not a bespoke fetch layer copied from the legacy.

No `react-intl` (or any formatting library) coupling anywhere in this resolution path — it returns
plain strings. Formatting (plurals, dates, ICU) is entirely the consuming app's own concern.

**`Messages` is opaque on purpose.** `loadMessages()` never inspects what a catalog's values
actually are — a string, or a precompiled AST — it only reads, merges and caches whatever JSON is on
disk. That's what makes the rest of this pipeline possible without `@zanix/space` itself ever
depending on ICU/FormatJS:

- `@zanix/cli`'s `zanix space build` compiles a configured `messagesDir`'s ICU strings into AST, in
  place, before formatting ever runs — see that package's own `docs/space.md`. A catalog may freely
  mix already-compiled and not-yet-compiled values across keys; both resolve identically.
- `@zanix/space-ui`'s `IntlProvider`/`useIntl`/`createFormatter` (React and Preact, independent
  bindings, never `preact/compat`) is what actually formats a message — wrapping `@formatjs/intl`'s
  own `createIntl()`. This is the ONE package in this stack that depends on FormatJS at all:

  ```tsx
  import { IntlProvider, useIntl } from '@zanix/space-ui' // or '@zanix/space-ui/preact'

  function Home() {
    const { formatMessage } = useIntl()
    return <h1>{formatMessage('home/title')}</h1>
  }

  component = ({ messages }) => (
    <IntlProvider locale={lang} messages={messages}>
      <Home />
    </IntlProvider>
  )
  ```

`znx space dev` never runs the compiler — `loadMessages()`'s own dev-mode cache bypass (above)
already means an edited message file is reflected on the very next request, and `space-ui`'s
formatter accepts a raw ICU string exactly as it accepts precompiled AST, so there is nothing dev
mode needs to compile.

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
the root layout — checked field by field (`title`), or per identity key (`meta`/`link`), never
whole-descriptor-replaces-whole-descriptor. **Deduplication**: `meta` by identity key (`name`,
`property`, or `httpEquiv` — whichever the tag declares; a tag with none of the three is never
deduplicated against another); `link` by `rel`+`href` (plus `hreflang`, when set — two `alternate`
links can legitimately share an `href`, e.g. an `x-default` entry pointing at the same URL as
another language's own entry, and both must survive). The most specific declaration for a given key
wins; different keys all survive.

**Coexists with a hand-authored JSX `<title>`/`<meta>`/`<link>` inside `component` — neither is ever
suppressed.** This declaration's resolved output always renders BEFORE `component`'s own tree. Under
React, that ordering is what makes it the document's FIRST `<title>` (React 19 hoists both into
`<head>` in encounter order, and the HTML Living Standard defines `document.title` as the first
`<title>` element in the document) — confirmed with a dedicated test that asserts this exact
ordering, not just presence. Under Preact (no hoisting at all) the resolved head is placed at the
FRONT of the real `<head>` after rendering, which produces the same outcome for the same reason: it
is the document's first `<title>`. A hand-authored `<title>` inside `component` is never suppressed
under either renderer — under Preact it simply renders wherever it is in `<body>` and never becomes
`document.title` at all.

This placement is the framework's own job in both renderers. A root `layout.tsx` never has to
cooperate with it, and receives no head-related prop to cooperate with — see
[The document contract](#the-document-contract).

Deliberately excludes `style`/`script` in this first iteration — no real use case has come up yet
that a page/layout can't already cover another way (a `<script>` for JSON-LD structured data is
`@zanix/space-ui`'s `StructuredData` component, rendered inline in `component`'s own tree; see
[SEO helpers](#seo-helpers) below).

### SEO helpers

Hreflang links, a canonical-link builder, and `sitemap.xml`/`robots.txt` — built on
[Head management](#head-management) above, deliberately NOT ports of the legacy components these
replace (both were `react-helmet-async`-coupled and had real bugs — see each function's own doc for
the full comparison):

```tsx
import { buildCanonicalLink, buildHreflangLinks } from '@zanix/space'

@Page({ path: ':lang/products/:id' })
export default class ProductPage extends SpacePageController<{ lang: string; id: string }> {
  loader = (ctx: { url: URL; params: { lang: string; id: string } }) => ({
    product: getProduct(ctx.params.id),
    link: [
      ...buildHreflangLinks({
        url: ctx.url,
        lang: ctx.params.lang,
        availableLangs: ['en', 'es'],
        defaultLang: 'en',
      }),
      buildCanonicalLink({ url: ctx.url }),
    ],
  })
  static head = (data: { link: HeadLinkTag[] }) => ({ link: data.link })
  component = ProductView
}
```

Both are called from `loader` (not `head` directly) — `SpacePageController.head`'s own function form
only ever receives `data`, never `ctx`, so `ctx.url`/`ctx.params` reach `head` through `loader`'s
own return value, same as any other loader-derived data `head` depends on.

**`buildHreflangLinks`** produces one `alternate` link per `availableLangs` (always including a
self-reference for the current language — the Google-recommended practice) plus an `x-default` entry
pointing at the default language's own version of the SAME page. Real fixes over the legacy
component this replaces (a React hook consumer, unusable outside a render): that one hardcoded
`x-default` to the bare site root regardless of the current path, and a standalone page only ever
self-referenced, never linking to its other language variants.

**`buildCanonicalLink`** strips the query string by default (`keepParams` opts specific ones back
in, e.g. `['page']` for paginated content) and always uses `url.origin` — never a
separately-configured domain. Genuinely new, not a port: the legacy component this replaces had no
canonical-link mechanism at all.

**`sitemap.xml`/`robots.txt`**, registered as real routes via `defineSpaceApp`:

```ts
// space.app.ts
export default defineSpaceApp({
  name: 'storefront',
  sitemap: async () => [
    { loc: '/en/products', priority: 0.9 },
    {
      loc: '/en/about',
      alternates: [{ lang: 'en', href: '/en/about' }, { lang: 'es', href: '/es/about' }],
    },
  ],
  robots: { rules: [{ userAgent: '*', disallow: ['/admin'] }] },
})
```

**`sitemap.xml` is served as a real SSR route, not generated as a static file at build time — this
is a deliberate architectural decision, not an accidental limitation.** `@zanix/space` has no
general build-time data-generation phase at all today (`zanix space build` only ever bundles the
client — CSS/Comets/PWA icons — nothing server-side or data-driven runs at that point); adding one
just to freeze a sitemap would mean building new, genuinely separate machinery for a single,
low-traffic use case. This was evaluated explicitly against a legacy Zanix stack that DID generate
sitemap output at build/CLI time (via an external tool, never re-run per request) before concluding
the live-route design is the correct one to keep.

`sitemap` accepts a static array or a function, with two different, precisely-guaranteed behaviors:

- **A plain array is never recomputed, ever.** The exact same reference is kept for the process
  lifetime — no snapshot at registration, nothing to re-invoke (arrays aren't callable to begin
  with). Mutating the array after `defineSpaceApp()` returns is reflected on the very next request
  (verified by a dedicated test). The only per-request work is building the XML string itself, which
  always runs regardless of source kind — it has to, since resolving relative `loc`s needs the
  request's own origin.
- **A function is called once, then cached in memory for the process lifetime** (verified by a
  dedicated call-counter test) — same pattern `loadMessages()` already uses, applied here so a
  function doing real work (a database query for a live product catalog) doesn't repeat it on every
  crawler hit. What's cached is the resolved entries, never the final XML string — the XML is still
  rebuilt per request against the current origin, so a cached result stays correct even under
  multiple origins. Concurrent requests racing before the first resolution settles share a single
  in-flight call (verified by a dedicated test). **Bypassed entirely under `znx space dev`**, so
  editing whatever backs the function is reflected on the next request, no restart needed. The
  accepted trade-off in production: a function's result is only as fresh as the last process start —
  a data change isn't reflected until the next restart/redeploy, not the next request. This was
  decided deliberately, evaluated against a build-time-static-freeze alternative and against a
  legacy Zanix stack that generated its own sitemap once at server-startup (not per request either)
  — see this package's own CHANGELOG/roadmap for the full comparison. An app that genuinely needs
  sub-restart freshness can still manage its own invalidation inside the function itself.

Every `loc`/`alternates[].href` may be relative or absolute — a relative one resolves against the
request's own origin, so an app never has to know/configure its own domain separately (a real legacy
footgun: a `SITE_DOMAIN`-style env var read independently in 2-3 places, silently producing invalid
relative `<loc>` values wherever one was unset). Real fixes over the legacy sitemap builder this
replaces (a Node CLI generator writing a static file to disk, not a live route): every value is
XML-escaped (the legacy used raw, unescaped template-string interpolation); redirected routes are
never mixed into the same `<urlset>` as real, indexable URLs (the legacy emitted non-standard
`<redirect>`/`<target>` tags real crawlers don't recognize); and an entry's `alternates`
cross-reference every language, not just itself (the legacy's own multi-language support only ever
self-referenced, even though it clearly intended full cross-referencing).

`robots` accepts a raw string (served byte-for-byte, no processing at all) or a structured
`{ rules, includeSitemap? }` config, which auto-appends a `Sitemap:` line when `sitemap` is also
configured. Genuinely new, not a port — the legacy had no `robots.txt` mechanism at all.

Both routes are an explicit opt-in — an app that never declares `sitemap`/`robots` never registers
either route, same "omitted = feature off" convention as `assetsDir`/`messagesDir`.

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
`renderPageForTest(Controller, params?, ctxOverrides?)` is generic over that same `Params` — a page
declared as `SpacePageController<{ id: string }>` requires `{ id: string }` for `params`, not just
any `Record<string, string>` — and instantiates `Controller`, calls its real `handleGet`, and
resolves once the streamed response has fully settled. `mockHandlerContext` (also exported from this
subpath) is the lower-level `HandlerContext` builder both of the above use internally — reach for it
directly only when testing something below the page level, e.g. a custom `@Guard`.

### CSS

Tailwind v4 and CSS Modules by default, vanilla-extract as an opt-in — all three resolve to 100%
static CSS at build time, the property that matters most for a streaming-SSR framework (no runtime
style injection to coordinate with content arriving out of order via Suspense):

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { cometPlugin, cssPlugin, spacePlugin } from '@zanix/space/vite'

export default defineConfig({
  plugins: [spacePlugin(), cometPlugin(), cssPlugin()],
})
```

```ts
// main.ts — after activateApps(), before bootstrapServers(), same convention as loadCometManifest
import { loadCssManifest } from '@zanix/space'

await loadCssManifest('./dist/client/css-manifest.json')
```

`cssPlugin()` writes `css-manifest.json` next to the client build's other assets, listing every
built stylesheet's real, hashed URL; `loadCssManifest` reads it back so a full-document response
links to it automatically (`<link rel="stylesheet">`, hoisted into `<head>` via React 19's own
resource hoisting regardless of whether the root layout or the default shell owns `<head>`) — an
Orbit fragment never repeats it, since its styles are already loaded on the page it swaps into.
There's no dev-mode equivalent yet: live CSS delivery in development belongs to the not-yet-built
Development Server module, not to this manifest.

**Options** (all default to Tailwind + CSS Modules on, vanilla-extract off):

```ts
cssPlugin({ tailwind: true, modules: true, vanillaExtract: false })
```

`modules: false` disables the built-in `*.module.css` → JS class-map behavior app-wide — a
`.module.css` file becomes a plain side-effect CSS import at that point, same as any other
stylesheet, never a source of typed classes.

**Typed CSS Modules**: every `*.module.css` file gets a matching `*.module.css.d.ts` written next to
it (dev and build alike), so `import styles from './card.module.css'` is checked by `deno check`/CI
— a renamed or misspelled class is a real compile error, not a silently-dropped override the way it
was in the legacy Node stack's own runtime-computed styling system.

**Design tokens**: no seeded palette shipped by default (a disconnected, unused default is worse
than none) — declare CSS custom properties directly in your own global stylesheet, imported once
from the root layout:

```css
/* app.css */
@import "tailwindcss";

:root {
  --space-blue-500: #2563eb; /* primitive — a raw value */
  --space-color-primary: var(--space-blue-500); /* semantic — a role, referencing a primitive */
  --space-space-md: 1rem;
}
```

Reference them from Tailwind (`bg-[var(--space-color-primary)]`), CSS Modules, or vanilla-extract
alike — a shared `--space-*` naming convention keeps all three from drifting apart over time.
[Open Props](https://open-props.style) is a reasonable way to seed a fuller scale without hand
writing one.

**Overriding a base app's tokens from a host — no new mechanism, same `globalCss` composition
already covered above**: a host's own `defineSpaceApp({ globalCss: ['./host-tokens.css'] })` call
composes AFTER the base app's own (`addGlobalCssPaths`, declaration order), so a host stylesheet
that redeclares just `--space-color-primary` overrides it via normal cascade, without ever
referencing the base app's own file or its underlying primitive scale.

**Runtime, per-request personalization** (e.g. per-tenant branding) — the one thing a static
stylesheet can't express — is `defineSpaceApp({ theme: { resolve } })`:

```ts
export default defineSpaceApp({
  name: 'storefront',
  theme: {
    resolve: ({ population }) =>
      population === 'tenant-b' ? { '--space-color-primary': '#16a34a' } : undefined,
  },
})
```

Injected as a nonced `<style>` block on every full-document response, sanitized before
interpolation, and folded into `cacheControl`'s own `ETag` automatically so two populations sharing
identical `loader` data never collide on the same ETag. See
[`docs/theming.md`](./docs/theming.md#runtime-per-request-personalization) for the exact
`resolve(ctx)` contract, the CSP `style-src` requirement for a custom policy, and what this
deliberately does NOT do (make caching population-aware in general, or handle a shared/CDN cache's
own partitioning — see `populationGuard`'s own doc for that boundary).

See [`docs/theming.md`](./docs/theming.md) for the full static convention too — primitive vs.
semantic tokens, base → host precedence, light/dark, and what a component should/shouldn't do with a
token.

**Recommended lint setup** (optional — not installed or enforced by this package):

```sh
npm install -D stylelint stylelint-config-standard stylelint-config-tailwindcss stylelint-declaration-strict-value
```

```js
// stylelint.config.js
export default {
  extends: ['stylelint-config-standard', 'stylelint-config-tailwindcss'],
  plugins: ['stylelint-declaration-strict-value'],
  rules: {
    'scale-unlimited/declaration-strict-value': [
      ['/color$/'],
      { ignoreValues: ['inherit', 'transparent', 'currentColor'] },
    ],
  },
}
```

That last rule rejects a raw color literal outside the `--space-*` token layer — verify
`stylelint-config-tailwindcss` against your exact Tailwind version before relying on it, it's a
third-party config, not maintained by Tailwind Labs itself.

**Styling the framework's own markup**: `SpacePageController`'s Orbit outlet and every Comet
boundary are already targetable with plain CSS attribute selectors — `[data-space-outlet]`,
`[data-comet]`, `[data-comet-strategy="visible"]` — no override prop needed, a direct benefit of CSS
being fully static now (the legacy Node stack needed a whole runtime override API precisely because
its classes were computed per-render). Both wrappers default to `display: contents` inline, so they
never break a parent `display: grid`/`flex` layout by inserting an extra box — override with more
specific CSS if a real box is genuinely needed there.

**Fonts and other critical resources**: use `react-dom`'s own `preload`/`preinit`/`preconnect`
directly in a layout or page component — no framework-specific API needed, and verified to survive
`renderToResponse`'s own wrapper end-to-end:

```tsx
import { preload } from 'react-dom'

function RootLayout({ children }) {
  preload('/fonts/inter-var.woff2', {
    as: 'font',
    type: 'font/woff2',
    crossOrigin: 'anonymous',
  })
  return <html>...</html>
}
```

**Not implemented yet**: runtime, per-request personalization of token values or content
(`population`/`theme.resolve` in the design doc) — deferred until the `population`/i18n subsystem
itself exists; today's tokens are static, declared once at build time.

### Assets

Static assets (images, fonts) a component/page references by a stable public path, served at
`/assets/<relative-path>`:

```ts
// space.app.ts
export default defineSpaceApp({ name: 'shop', assetsDir: './assets' })
```

```tsx
// any component — referenced by path, never by import (see below for why that distinction matters)
<img src='/assets/logo.svg' alt='Logo' />
```

`assetsDir` is resolved once, automatically, as part of this app's own `setup(ctx)` (same timing as
`routesDir`) — an author never scans or registers anything by hand. Omitted entirely by default: no
directory scanned, no route registered, zero cost — unlike `routesDir` (every app has pages, so it
defaults to `'./routes'`), not every app has assets beyond what Comets/`globalCss` already cover, so
this stays an explicit opt-in.

**Composing a host's own assets with a base app's — no new mechanism, same array precedent
`routesDir[]` already established**:

```ts
defineSpaceApp({
  name: 'shop-custom',
  assetsDir: ['./assets-override', './node_modules/@acme/shop-app/assets'],
})
```

First-match-wins by relative path: `assets-override/logo.svg`, if present, wins outright; any asset
the override doesn't declare falls back to the base app's own directory. Every file is resolved into
one precomputed `Map<relativePath, absolutePath>` — the ONLY source of truth for what actually gets
served, and served via a single route (`@zanix/server`'s own trailing catch-all,
`Get('/assets/:path*')`) that looks the requested path up directly against that Map, never
concatenating it against the filesystem — a path that was never actually resolved simply isn't a key
there and 404s like any other unmatched route. The exact same resolution/serving code runs in
`znx space dev` and production, with no separate build-time-only path to keep in sync.

#### Content-hashed assets (`assetsPlugin`, `resolveAssetHref`)

Opt-in, on top of everything above — the stable `/assets/logo.svg` path keeps working exactly as
described whether or not you use this. `assetsPlugin` (`@zanix/space/vite`) hashes every file
`assetsDir` resolves during a real `zanix space build`, writing `assets-manifest.json`:

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { assetsPlugin, spacePlugin } from '@zanix/space/vite'

export default defineConfig({
  plugins: [...spacePlugin(), assetsPlugin({ assetsDir: './assets' })],
})
```

```ts
// main.ts, before activateApps()/bootstrapServers() — same convention as
// loadCssManifest/loadCometManifest/loadPwaBuildOutput
import { loadAssetsBuildOutput, loadAssetsManifest } from '@zanix/space'

await loadAssetsManifest('./dist/client/assets-manifest.json')
loadAssetsBuildOutput('./dist/client')
```

```tsx
import { resolveAssetHref } from '@zanix/space'

<img src={resolveAssetHref('logo.svg')} alt='Logo' />
```

`resolveAssetHref('logo.svg')` returns the real hashed URL (`/assets/logo-a1b2c3.svg`) when a
manifest was loaded, falling back to the stable `/assets/logo.svg` path otherwise (dev, no build
yet, or a path the manifest simply doesn't have) — never throws, never asserts the file exists.

**The serving route tries two independent lookups, in order**: a request is first checked directly
against the loaded build output directory — a hit there is served with
`Cache-Control: public, max-age=31536000, immutable` and a real `ETag` (the hash IS the filename,
genuinely free — no separate computation). A miss falls through to the original, unhashed lookup
above, with no special caching (that content could change without its stable URL changing, unlike
the hashed one). Real fix over the legacy server this replaces: confirmed by reading its source, its
own equivalent set `Cache-Control: max-age=31536000` with neither `immutable` nor a real per-file
`ETag` (only a `Last-Modified` timestamped once at server startup) — despite its own assets already
being content-hashed by that stack's own build tool, the exact same missed opportunity this closes.

#### Image/SVG optimization (`assetsPlugin({ optimize })`)

Opt-in, on top of everything above — omitting `optimize` entirely keeps `assetsPlugin`'s behavior
byte-for-byte unchanged. Real `sharp`/`svgo`-based optimization, ported from a legacy Zanix stack's
own production-used media pipeline (breakpoints/qualities reused verbatim), build-time only —
neither dependency ever runs in the deployed server, same boundary `pwaPlugin`'s own `sharp` usage
already establishes:

```ts
// vite.config.ts
assetsPlugin({
  assetsDir: './assets',
  optimize: {
    images: { breakpoints: ['msm', 'mlg', 'dlg'], formats: ['webp'] },
    svg: true,
    include: ['img/**'], // omit to optimize every eligible asset
  },
})
```

**The one rule every code path obeys: an optimized output only replaces, or gets added next to, its
reference when it is strictly smaller in bytes** — measured, never assumed. Equal-or-larger always
keeps the reference bytes exactly.

- **`images: true`** (no `breakpoints`/`formats`) — the only shape that touches the original key's
  own bytes: recompresses in place (same dimensions/format, metadata stripped by sharp's own default
  — no `.withMetadata()` call), replacing `logo.jpg`'s bytes only if strictly smaller.
- **`images: { breakpoints }`** — additive only, the original key is never touched. Each named
  preset (`thum`/`msm`/`mlg`/`dmd`/`dlg`, the same legacy sizes/qualities, overridable via
  `quality`/`width`) or raw pixel width (`720`, under a `w720` key) resizes with
  `withoutEnlargement: true` (a small source never upscales) and is compared against the **global
  original** — emitted as `logo.msm.jpg` only if it wins.
- **`images: { formats }`** (no `breakpoints`) — each requested format (`webp`/`avif`/...) is
  encoded at the ORIGINAL dimensions and compared independently against the **global original** —
  `webp` is never compared against `avif`, only each against the source.
- **`images: { breakpoints, formats }`** — a three-tier reference: each breakpoint's own same-format
  resize is the reference its OWN requested formats are compared against — never the global
  original, never another breakpoint, never another format. `logo.msm.webp` must beat `logo.msm.jpg`
  specifically, not merely beat `logo.jpg`.
- **`svg: true`** — `svgo` (confirmed to run cleanly under Deno, no native binary), safe transforms
  only (strip dimensions/metadata/comments, minify inline styles/ids) — deliberately **not** the
  legacy CSS-selector purge (a whole-app source scan, a bigger, separate concern) and unrelated to a
  sprite `<use>` icon pattern. Same in-place, same-key, strictly-smaller-or-kept rule as
  `images: true`.
- **`include`** — glob patterns matched against the same relative path the manifest keys on;
  omitted, every eligible asset is considered; a file outside the filter (or with an unsupported
  extension) is always left completely untouched.
- **`useWorker`** — offloads the actual sharp/svgo work to a real worker pool (`@zanix/utils`'s own
  `WorkerManager`, already a dependency — no new one added) instead of the same thread the build
  already runs on. `true` sizes a pool to the detected CPU count, a `number` is an explicit pool
  size. Purely an execution strategy — produces the exact same emit/discard decisions as leaving it
  off (the default), verified directly rather than assumed.

Every generated variant is just another `assets-manifest.json` entry — resolved the exact same way
via `resolveAssetHref('logo.msm.jpg')`, no new runtime API. Composing variants into
`<picture>`/`srcset`/responsive-selection markup is deliberately left to the rendering layer (a
future `space-ui` component), not this plugin — confirmed against a real legacy `Media`/`Image`
component: it resolves variants by breakpoint NAME against a `<picture>` + `<source media="...">`
pattern, never a `srcset` `w`-descriptor/`sizes` one, so it never needed each variant's real pixel
dimensions, and neither does this plugin.

Video/audio transcoding is deliberately out of scope for now — a legacy Zanix stack had a real,
production-used `fluent-ffmpeg`-based pipeline for this, but a real spike found `fluent-ffmpeg`
deprecated upstream and `ffmpeg-static`'s install-time binary download blocked by Deno's own default
npm-script sandboxing — an infrastructure/provisioning decision (a vendored binary via explicit
opt-in, a system/Docker-provided `ffmpeg`, or an external transcoding service), not an
implementation one, left for separate, future work once that's decided.

**An asset is only overridable if referenced by this stable public path** — never via a bare
`import logo from './logo.svg'` inside a component, which resolves through Vite's own module graph,
entirely independent of `assetsDir`'s own resolution. A component meant to be host-overridable must
reference its asset by path; module-aliasing for the `import` case is a different, bigger mechanism,
deliberately not built here.

**Case-sensitive, like a real filesystem**: `/assets/Logo.svg` and `/assets/logo.svg` resolve to
different files if both genuinely exist on disk — the catch-all preserves the request's own casing.

**Not this mechanism**: PWA icons/favicon — those stay under `pwaPlugin`/`registerPwa` (below), a
separate, already-working pipeline for site identity, not general component-referenced content.
Module-aliasing for the `import`-based case above is deliberately deferred — separate, future work
if a real need appears, never assumed to already work. Hashing/manifest for production caching is no
longer deferred — see [Content-hashed assets](#content-hashed-assets-assetsplugin-resolveassethref)
above.

### PWA

Real icon resizing (via `sharp`), a computed Web App Manifest, and a small, dependency-free service
worker — no `workbox-strategies`/`generateSW`, since this framework's own build already knows
exactly which assets are the real app shell. `manifest.webmanifest`/icons/`sw.js` are each
registered as their own explicit routes — the same underlying mechanism `Page()` itself uses
internally.

```ts
// vite.config.ts — build-time: generates icons + sw.js
import { defineConfig } from 'vite'
import { cometPlugin, cssPlugin, pwaPlugin, spacePlugin } from '@zanix/space/vite'

export default defineConfig({
  plugins: [
    spacePlugin(),
    cometPlugin(),
    cssPlugin(),
    pwaPlugin({
      icons: { source: './public/icon-source.png' },
      offlineFallback: '/offline',
    }),
  ],
})
```

```ts
// space.app.ts — runtime: registers routes + injects <link rel="manifest">/theme-color/SW script
import { defineSpaceApp } from '@zanix/space'

export default defineSpaceApp({
  name: 'storefront',
  pwa: {
    name: 'Storefront',
    themeColor: '#2563eb',
    offlineFallback: '/offline',
    iconsDir: './dist/client/icons', // must match pwaPlugin's own build output
    swPath: './dist/client/sw.js', // omit for no service worker at all
  },
})
```

`pwaPlugin`'s `icons`/`offlineFallback` and `defineSpaceApp({ pwa })`'s `iconsDir`/`iconSizes`/
`swPath`/`offlineFallback` genuinely need to agree — one runs at build time (a Vite/Node process),
the other at request time (the deployed Deno server) — there's no shared memory between them to
enforce it automatically, the same reason `loadCssManifest`/`loadCometManifest` already need an
explicit path passed from `main.ts`.

Only the two icon sizes Chrome's own installability criteria check (`192`/`512`, "any" purpose) are
generated by default — no maskable-icon variant yet, since a naive resize of an arbitrary square
source would crop real content under Android's own mask shapes; a real one needs a safe-zone-aware
source this package doesn't try to validate yet.

The service worker precaches this app's real, hashed CSS (scanned directly from the build output,
not read from `cssPlugin`'s own manifest — Rollup gives no ordering guarantee between two
same-priority plugins) plus the `offlineFallback` route, if set. Fetch handling: network-first for
navigations (so a live deploy is never masked by a stale cached page), falling back to cache, then
to the offline fallback; cache-first for everything else.

**Not implemented yet**: `protocolHandlers`/`fileHandlers`/`shareTarget`/`push` (Tier-2, mostly
Chromium-only manifest fields) and maskable icons — deferred, not silently dropped, since none of
them are blocking and each deserves its own real verification before shipping.

## Documentation

- [`docs/theming.md`](./docs/theming.md) — design tokens: declaring/naming, primitive vs. semantic,
  base → host precedence, light/dark, component authoring rules, and runtime per-request
  personalization (`theme.resolve`).
- [`docs/validation.md`](./docs/validation.md) — build-time document validation: what it checks,
  what it deliberately cannot, the three independent axes (severity, opt-in, strict), and how to
  configure it per project.
- [`docs/see-more.md`](./docs/see-more.md) — additional notes.

## Contributing

If you'd like to contribute to the project, follow these steps:

1. **Report Issues**: If you find any bugs or have suggestions, open an issue on the GitHub
   repository.
2. **Fork the Repo**: Fork the project and create a branch for your changes.
3. **Make Changes**: Develop new features or fix bugs while adhering to the project's coding
   guidelines.
4. **Submit a Pull Request**: Once your changes are ready, submit a pull request with a clear
   description of what you've done.

## Changelog

For a detailed list of changes, refer to the [CHANGELOG](./CHANGELOG.md).

## License

This project is licensed under the **MIT License**. See the [LICENSE](./LICENSE) file for more
details.

benchmark tests use
