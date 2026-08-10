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
  (`client`/`ssr`) that later milestones (Comets, CSS) build on.
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
  still works as a normal, full-page link with no JS at all — see
  [Client-side navigation ("Orbit")](#client-side-navigation-orbit) below for what falls back to a
  real navigation and why.
- ✅ **Middleware (guards, default CSP and security headers)** — every page gets a nonce-based
  `Content-Security-Policy` and a small set of security headers (`X-Frame-Options`,
  `Referrer-Policy`, `X-Content-Type-Options`) automatically, customizable via a single
  `static headers` on the page class or, app-wide, via `defineSpaceApp({ headers })` — cross-origin
  isolation (COOP/COEP/CORP) is available there too, off by default; `csrfGuard()`
  (double-submit-cookie CSRF protection, opt-in) and `defineMiddleware()` (other guards — rate
  limiting, custom checks — for every SSR page route) sit on `@zanix/server`'s own guard pipeline.
  See
  [Middleware (guards, default CSP and security headers)](#middleware-guards-default-csp-and-security-headers)
  below for what it can't do (per-`Application` scoping, pre-route-matching i18n redirects).
- ✅ **Testing helpers** (`@zanix/space/testing`) — `mockPageContext`/`renderPageForTest` for a
  page's `unit`/`functional` levels, plus the lower-level `mockHandlerContext`; see
  [Testing](#testing) below.
- ✅ **CSS** (`@zanix/space/vite`'s `cssPlugin`) — Tailwind v4 + CSS Modules (typed, via a generated
  `*.module.css.d.ts` per file) by default, vanilla-extract opt-in; a `css-manifest.json` read back
  via `loadCssManifest` links a page's real, built stylesheet(s) automatically. See [CSS](#css)
  below for the token-layer convention and what's still deferred (runtime personalization via
  `population`).
- ✅ **PWA** (`@zanix/space/vite`'s `pwaPlugin` + `defineSpaceApp({ pwa })`) — real icon resizing
  (`sharp`), a computed Web App Manifest, and a small custom service worker (network-first
  navigations, cache-first everything else, precached CSS + offline fallback) — all served via
  explicit routes, since `@zanix/server` has no generic static-file serving. See [PWA](#pwa) below
  for what's deferred (Tier-2 manifest fields, maskable icons).
- ⏳ Not yet implemented: i18n/population, and the CLI scaffolding (`znx new space`).

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
import { defineSpaceApp } from '@zanix/space'

export default defineSpaceApp({ name: 'storefront' })
```

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
  loader = async (ctx: { params: { id: string } }) => ({ product: await getProduct(ctx.params.id) })
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
      </head>
      <body>{children}</body>
    </html>
  )
}
```

If a root layout is present, it's trusted as-is — nothing checks that it actually returns `<html>`/
`<body>`, the same contract Next.js's own App Router uses for its root layout. With no root layout
at all, `SpacePageController` wraps every page in a minimal default document (`<!DOCTYPE html>`,
UTF-8 charset, a responsive viewport meta tag) so a brand new app still serves real, valid pages
before it defines any layout of its own. Global UI that should appear on every page (a header,
footer, or navigation) belongs in this same root layout — there's no separate mechanism for it;
nested layouts already compose the way a "global" and a "per-section" wrapper would.

### Not-found page

`routesDir`'s own `not-found.tsx` (a plain component, same convention as `error.tsx`) is what a
request with no matching route serves — wrapped in the same root layout as every other page:

```tsx
// routes/not-found.tsx
export default function NotFound() {
  return <h1>Page not found</h1>
}
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
trees between the current and target URL, a real follow-up, not implemented here. Prefetch on
hover/viewport (reusing the same `IntersectionObserver` strategy comets already use) is also not
implemented yet.

**Escape hatches**: add `data-orbit-hard` to a specific `<a>` to force a real navigation for it. A
modified click (<kbd>Cmd</kbd>/<kbd>Ctrl</kbd>/<kbd>Shift</kbd>/middle-click), `target="_blank"`, or
a cross-origin `href` are never intercepted either — exactly the cases a plain link's own default
behavior already handles correctly. Any non-successful fragment response (a `404`, a `500`, a
network failure) degrades to a real navigation rather than risking invalid markup in the page.

Rendering an element directly, without going through a page controller:

```tsx
import { renderToResponse, useRequestCache } from '@zanix/space'

function ProductView({ id }: { id: string }) {
  const product = useRequestCache(`product:${id}`, () => getProduct(id))
  return <h1>{product.name}</h1>
}

const response = await renderToResponse(<ProductView id='1' />, {
  initialState: { id: '1' },
})
```

On the client, read back the state a server render handed off (import from `@zanix/space/client`,
never from the root entry point, to avoid pulling `react-dom/server` into the browser bundle):

```ts
import { readInitialState } from '@zanix/space/client'

const { id } = readInitialState<{ id: string }>() ?? {}
```

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
    csp: { 'default-src': ["'self'"], 'frame-src': ['https://payments.example.com'] },
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

**Don't configure the same header through both `defineMiddleware` and a page's own `static headers`
at the same time** — a page's own value is applied inside `handleGet`, and `defineMiddleware`'s
guard-collected headers are merged in separately by `@zanix/server`'s own pipeline; the two don't
cleanly override each other for the same header (they can end up combined into one comma-joined,
ambiguous value). Pick one mechanism per page.

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
  action = async (ctx) => {/* csrfGuard already validated by the time this runs */}
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

There is currently no pre-route-matching hook for locale-aware redirects/rewrites (guards, and a
page's own `static headers`, only ever run after a route already matched) — an i18n-aware routing
layer is not implemented yet.

### Testing

Helpers for testing a page at the `unit`/`functional` levels of the same
`unit`/`functional`/`integration` convention used across the Zanix ecosystem — imported from the
`@zanix/space/testing` subpath, never from the package's root entry point:

```ts
import { mockPageContext, renderPageForTest } from '@zanix/space/testing'

// unit — loader as a plain function, no rendering involved
Deno.test('ProductPage.loader returns the product', async () => {
  const data = await new ProductPage().loader(mockPageContext({ params: { id: '1' } }))
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
  --space-color-primary: #2563eb;
  --space-space-md: 1rem;
}
```

Reference them from Tailwind (`bg-[var(--space-color-primary)]`), CSS Modules, or vanilla-extract
alike — a shared `--space-*` naming convention keeps all three from drifting apart over time.
[Open Props](https://open-props.style) is a reasonable way to seed a fuller scale without hand
writing one.

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
  preload('/fonts/inter-var.woff2', { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' })
  return <html>...</html>
}
```

**Not implemented yet**: runtime, per-request personalization of token values or content
(`population`/`theme.resolve` in the design doc) — deferred until the `population`/i18n subsystem
itself exists; today's tokens are static, declared once at build time.

### PWA

Real icon resizing (via `sharp`), a computed Web App Manifest, and a small, dependency-free service
worker — no `workbox-strategies`/`generateSW`, since this framework's own build already knows
exactly which assets are the real app shell. `@zanix/server` has no generic static-file serving at
all, so `manifest.webmanifest`/icons/`sw.js` are each registered as real, explicit routes — the same
underlying mechanism `Page()` itself uses internally.

```ts
// vite.config.ts — build-time: generates icons + sw.js
import { defineConfig } from 'vite'
import { cometPlugin, cssPlugin, pwaPlugin, spacePlugin } from '@zanix/space/vite'

export default defineConfig({
  plugins: [
    spacePlugin(),
    cometPlugin(),
    cssPlugin(),
    pwaPlugin({ icons: { source: './public/icon-source.png' }, offlineFallback: '/offline' }),
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
