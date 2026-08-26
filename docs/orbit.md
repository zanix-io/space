## Client-side navigation ("Orbit"), and manual rendering

This is the full reference the README's
["Client-side navigation (\"Orbit\")"](../README.md#client-side-navigation-orbit) section points to
— Orbit's link interception/prefetch contract, plus the lower-level
`renderToResponse`/`useRequestCache`/ `readInitialState` surface a page controller normally hides.

### Turning it on

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
header/footer/nav declared in the root `layout.tsx` (see
[Document shell](./routing.md#document-shell)) sits outside that boundary and is never re-fetched or
re-rendered on navigation. What Orbit does _not_ do yet: preserve a shared _nested_ layout across
sibling routes (`/products/1` → `/products/2` still re-renders everything under the root layout, not
just the leaf page) — that needs comparing route trees between the current and target URL, a real
follow-up, not implemented here.

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
`Vary: X-Znx-Space-Navigate` unconditionally (whether or not the page also declares `cacheControl`)
— the response body genuinely differs (full document vs. bare outlet fragment) depending on that
request header, so any HTTP cache sitting in front of the app needs to key on it too, not just
Orbit's own client runtime.

### Prefetch

`initOrbit()` warms a link's fragment ahead of a click, so the actual navigation often finds it
already cached. Two independent triggers, each can be on, off, or both:

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
Uses the same `X-Znx-Space-Navigate` header a real navigation does, so on a page with
`cacheControl`, the browser's own HTTP cache (revalidated by `ETag`) can serve the real navigation
from the very same entry the prefetch already warmed — no separate cache needed for that case.

### CSS during navigation

A fragment response carries every stylesheet the destination page needs — its own `static styles`
plus any Comet it renders — as real `<link rel="stylesheet">` tags in its body, resolved through the
exact same logic a full document render uses (see
[`docs/css.md`](./css.md#responsive-delivery-media-per-page-styles-and-comet-scoped-css) for the
`global`/page/comet contract itself). `global` is deliberately never repeated here — it's an
app-wide list, already present since the initial load.

Before completing a swap, the client extracts every `<link rel="stylesheet">` from the fragment,
dedupes by `href` against what the current document already has anywhere in it (not just `<head>` —
a Comet can leave its own `<link>` in `<body>`), and inserts only what's missing into `<head>`,
synchronously and in order (`media` preserved), waiting for each to load (`load`/`error`, or a 4s
timeout that never rejects — the swap always proceeds) before the visual swap happens. This is what
avoids a flash of unstyled content on navigation into a page whose CSS the current document doesn't
have yet. Two overlapping navigations that need the same missing stylesheet share one in-flight load
instead of inserting a duplicate `<link>`; nothing here is a client-side registry of "what CSS
exists" — that stays the server's manifest, read fresh from each fragment.

A page whose CSS is already fully covered by what's already loaded (the common case) triggers none
of this — the fragment simply doesn't need any `<link>` insertion.

### Manual rendering (`renderToResponse`, `useRequestCache`)

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

## See also

- [`README.md`](../README.md#client-side-navigation-orbit) — the "Client-side navigation" section
  this guide is the full reference for.
- [`docs/comets.md`](./comets.md) — selective hydration; `persist` there keeps a Comet's DOM alive
  across an Orbit swap.
- [`docs/css.md`](./css.md) — the `global`/page/comet CSS contract this page's "CSS during
  navigation" section relies on.
- [`docs/routing.md`](./routing.md) — layout nesting and the document shell that defines what a
  navigation swap does and doesn't touch.
