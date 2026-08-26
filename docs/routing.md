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
default) never receives more than `ErrorBoundaryProps.error` — nothing this framework decided is
safe to persist/report on its own behalf.

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
