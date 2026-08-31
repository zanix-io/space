## Routing, layouts and the document — layout nesting, the document shell, and error/not-found recovery

This is the full reference the README's
["Routing, layouts and the document"](../README.md#routing-layouts-and-the-document) section points
to — how `routes/**/page.tsx` files compose with nested layouts, how the root document is produced,
and how an unmatched route or a thrown `loader` recover into a real rendered document instead of
ever leaking raw JSON.

### Layouts, loading and error segments

```
routes/
  products/
    layout.tsx   # wraps page.tsx and every nested route below it — never a route of its own
    loading.tsx  # Suspense fallback for this segment and everything nested under it
    error.tsx    # error boundary for this segment (see how recovery works below)
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

`layout.tsx`/`loading.tsx`/`error.tsx` are never restricted to `routesDir`'s own root — each can
live at any directory level, scoping to that segment and everything nested below it. A route's error
is resolved by walking from its own matched leaf up toward the root, using the nearest `error.tsx`
found along the way — so a project can have one `error.tsx` at the root as a catch-all default, and
another, more specific one a few levels deeper for a segment that needs its own recovery UI. See "A
thrown `loader` never leaks raw JSON" below for the exact same leaf-to-root lookup, reused unchanged
for a data-phase throw.

**How a React failure actually recovers**: React's server renderer only recovers a thrown error for
content inside a `Suspense` boundary (Space always adds one where `error.tsx` exists), so a failing
segment stays a `200` instead of a shell-breaking `500` — but `render()`'s own `hasError` branch
never actually runs during that same server response: React instead ships a postponed-recovery
marker and finishes that one segment on the client. Every auto-generated client entry already calls
`hydrateErrorBoundaries()` alongside `hydrateComets()`/`initOrbit()` (see
[`docs/comets.md`](./comets.md#wiring-it-up)) for exactly this — it finds that marker and mounts the
real `error.tsx` Fallback fresh, no extra wiring needed. Preact has no such gap to begin with:
`preact-render-to-string`'s synchronous render recovers into an already-mounted boundary directly,
so the Fallback's real markup is already correct and visible with zero client JS;
`hydrateErrorBoundaries` still runs there too, purely to attach a working `reset` handler. Either
way, `error.tsx`'s own `reset` prop is always `retryOutlet` once interactive — a real re-fetch/swap
of the current page, not a local re-render of the segment's original children: this Fallback was
mounted fresh, with no live reference to whatever originally threw, so only a real round-trip to the
server can actually recover.

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

### Redirecting a page

`SpacePageController.redirect` sends a page's own request elsewhere before `loader`/`component` ever
run — evaluated on every `GET`, so a redirecting page never fetches data or renders anything:

```tsx
// routes/old-products/page.tsx
import { Page, SpacePageController } from '@zanix/space'

@Page()
export default class OldProductsPage extends SpacePageController {
  public static override redirect = { to: '/products', code: 301 }

  // Required by the base class even though it's never reached at runtime — an unconditional
  // redirect always wins before `component` is ever read.
  public override component = () => null
}
```

```ts
export type RedirectConfig = {
  to: string
  code?: 301 | 302 | 307 | 308 // defaults to 301
  condition?: (ctx: PageContext<unknown>) => boolean // defaults to always-true
}
```

`to` resolves against the incoming request's own URL when relative, so `'/products'` and
`'https://example.com/products'` both work. `condition`, when given, is evaluated against the
request first — the redirect applies only when it returns `true`; omit it entirely for an
unconditional redirect:

```tsx
public static override redirect = {
  to: '/en',
  condition: (ctx) => !ctx.request.headers.get('accept-language')?.startsWith('es'),
}
```

An unconditional redirect is inferred at build time — `zanix space build`'s own document validation
(see [`docs/validation.md`](./validation.md#exempting-a-route)) treats that page as never producing
a document, so it's exempt from the usual per-route head/SEO checks. A `condition`-gated redirect
isn't inferrable that way (whether it fires depends on the request), so it stays subject to the
normal checks.

**Always a `static` field** — `RedirectConfig` lives on the class itself
(`SpacePageController.redirect`), never on an instance. Declaring `public override redirect = {...}`
without `static` compiles (TypeScript's `override` check only validates instance members against the
base class's own instance members, and silently ignores the mismatch here) but is never read:
`handleGet` reads the class's own static `redirect`, not `this.redirect`, so a redirect declared
this way never actually happens.

### Not-found page

`routesDir`'s own `not-found.tsx` is what a request with no matching route serves — wrapped in the
same root layout as every other page, going through the same `DocumentModel`/head resolution as any
other page under either renderer. Unlike `error.tsx` above, this one is a **whole-app singleton, not
a per-segment file**: it's only ever discovered at `routesDir`'s own root — a copy placed under a
nested directory (`routes/products/not-found.tsx`) is never found, since there's no per-route
"unmatched" segment to walk up from the way a thrown error has one. This holds even in an app routed
under `[lang]` (see [`docs/i18n.md`](./i18n.md)): `routes/[lang]/not-found.tsx` is never discovered
either — the file stays at the literal `routes/not-found.tsx`, and the SAME one serves every
language's own unmatched request, regardless of which `[lang]` prefix the URL carried:

```tsx
// routes/not-found.tsx
import type { NotFoundProps } from '@zanix/space'

export default function NotFound({ lang, messages }: NotFoundProps) {
  return <h1>Page not found</h1>
}

// Optional — omit and the framework's own default (`{ title: 'Page not found' }`) applies.
export const head = { title: 'Page not found', meta: [{ name: 'robots', content: 'noindex' }] }
```

`NotFoundProps` is entirely optional to declare — a `NotFound` that takes no props at all, as the
plain example above, works exactly the same way. `messages`, when the app declares `messagesDir`, is
a pre-resolved catalog for the request's own `lang` — see
[`docs/i18n.md`](./i18n.md#error-and-not-found-pages) for how it resolves without a matched route to
read `:lang` from.

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

### A thrown `loader` never leaks raw JSON

A page's own `loader`, or a nested layout segment's own `loader`, throwing is recovered into a real,
rendered document — never left to propagate to `@zanix/server`'s own generic JSON error response,
even though a data-phase throw happens before render (and its own `Suspense`-boundary recovery) ever
starts:

- **`HttpError('NOT_FOUND')`** renders this app's `not-found.tsx` — the exact same lookup/render
  path the section above already uses, so "how do we find and render this app's `not-found.tsx`" has
  only one implementation, reached from either a genuinely unmatched route or a `loader` that
  decided its own data doesn't exist.
- **Any other error** renders this route's own nearest `error.tsx`, wrapped directly in the app's
  root layout — the same leaf-to-root resolution order a render-phase throw already uses, with the
  real HTTP status preserved (`error.status.value` for an `HttpError`, `500` otherwise).
- **A route with no `error.tsx` anywhere in its own composition chain** still gets a real document —
  this package's own built-in `DefaultErrorView`, the exact counterpart to the not-found page's own
  built-in default above.

The real error is always logged before any of this returns; `error.tsx` (custom or the built-in
default) only ever receives `ErrorBoundaryProps.error` plus, when the app declares `messagesDir`, a
pre-resolved `messages` catalog (see [`docs/i18n.md`](./i18n.md#error-and-not-found-pages)) —
nothing else this framework decided is safe to persist/report on its own behalf.

### Serving JSON instead of a document — `defineSpaceApp({ errorResponse: 'json' })`

`errorResponse` decides what this package's own BUILT-IN not-found/error fallback renders when a
route declares none of its own — `'view'` (the default) renders a real HTML document, `'json'`
returns a plain, redacted JSON body instead (`serializeError`'s own safe allowlist, never `stack`),
for an app built on `@zanix/space` purely for its routing, with no document shell of its own:

```ts
export default defineSpaceApp({ name: 'api-only', errorResponse: 'json' })
```

It never overrides an app's OWN `error.tsx`/`not-found.tsx` — declaring one is already an explicit
choice to render a real page, regardless of this flag; it only decides what happens when a route
declares none at all. It also never applies to a render-phase failure with no `error.tsx` anywhere
in a page's own composition chain (`DefaultErrorView` above) — by the time that fallback is reached,
the response has typically already started streaming as `text/html`, with no way to retroactively
become JSON.

Both this package's own built-in `DefaultNotFoundView` and `DefaultErrorView` carry a stable
`data-space="not-found"`/`data-space="error"` attribute on their root element — an optional
stylesheet can target either without a bare element selector (`zanix new space --template themed`,
`@zanix/cli`, is the first real consumer).

## See also

- [`README.md`](../README.md#routing-layouts-and-the-document) — the "Routing, layouts and the
  document" section this guide is the full reference for.
- [`docs/head.md`](./head.md) — the `<title>`/`<meta>`/`<link>` resolution that feeds into
  `DocumentModel` above.
- [`docs/orbit.md`](./orbit.md) — client-side navigation swaps this same composed page tree; a
  header/ footer/nav declared in the root layout above sits outside that swap boundary and is never
  re-fetched.
- [`docs/validation.md`](./validation.md) — build-time validation of the documents this contract
  produces.
