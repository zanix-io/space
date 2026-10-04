## Client-side navigation ("Orbit"), and manual rendering

This is the full reference the README's
["Client-side navigation (\"Orbit\")"](../README.md#client-side-navigation-orbit) section points to
— Orbit's link interception/prefetch contract, plus the lower-level
`renderToResponse`/`useRequestCache`/ `readInitialState` surface a page controller normally hides.

### Turning it on

Already on by default — the auto-generated client entry every app gets (see
[`docs/comets.md`](./comets.md)) runs `initOrbit()` alongside `hydrateComets()`, via
`initClientEntry()`, with no configuration needed. Only relevant if you've set
`SpaceAppConfig.clientEntry` to your own file — call `initClientEntry(options)` once, which forwards
`options` straight to `initOrbit`:

```ts
// your own client entry, if you configured one
import { initClientEntry } from '@zanix/space/client'

initClientEntry({ prefetch: { onViewport: true } }) // same shape initOrbit itself takes
```

Need `initOrbit()` on its own, separate from `hydrateComets()`/`hydrateErrorBoundaries()`? It stays
independently exported too:

```ts
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

### Programmatic navigation (`navigate`)

`initOrbit()`'s click interception covers a real `<a>` click, and `popstate` covers back/forward —
neither covers a navigation with no click involved at all, e.g. a Comet's own event handler
navigating once a `fetch()` it made resolves and the destination is only known then. `navigate()` is
the public counterpart for exactly that case:

```ts
import { navigate } from '@zanix/space/client'

await navigate(`/products/${id}`) // pushes a new history entry, same as a real click
await navigate('/checkout', { replace: true }) // replaceState instead
```

`href` is resolved against the current page the same way a real link's own `href` is. A same-origin
destination runs through the exact same swap a real click uses — prefetch reuse, the CSP-signature
comparison, stylesheet loading, `persist`-tagged Comet retention, and the same graceful degradation
to a full navigation on any failure (a non-2xx fragment response, a network error, a CSP mismatch, a
missing outlet). A cross-origin `href`, or a same-document hash-only link, gets a real navigation
(`location.href = href`) instead — the same outcome an `<a>` pointing there would already produce on
its own, never Orbit's fragment swap.

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

A fragment response carries every stylesheet the destination route needs — the `styles` of each
layout in its chain (root layout first), its own `static styles`, plus any Comet it renders — as
real `<link rel="stylesheet">` tags in its body, resolved through the exact same logic a full
document render uses (see
[`docs/css.md`](./css.md#responsive-delivery-media-per-layout-and-per-page-styles-and-comet-scoped-css)
for the `global`/layout/page/comet contract itself). `global` is deliberately never repeated here —
it's an app-wide list, already present since the initial load.

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
of this — the fragment simply doesn't need any `<link>` insertion. Navigating between two pages of
one layout therefore requests nothing again (the layout's stylesheets are already in the document),
while entering another area, a different layout, inserts that layout's stylesheets and waits for
them before the swap: the new area never appears unstyled. A stylesheet declared through a layout's
`head` `<link>` is not part of this: a fragment carries no head links, so it neither inserts nor
waits for one — declare per-area CSS with the layout's `styles` export.

### CSP during navigation

A document's active `Content-Security-Policy` is fixed at the navigation that created it — no later
`fetch()` response, regardless of its own headers, is ever consulted by the browser to update it.
Before swapping a fetched (or prefetched) fragment in, the client compares that fragment's own
resolved CSP against the active document's own — both normalized so a per-request nonce alone never
counts as a real difference, since the overwhelming common case is two pages sharing the exact same
policy with only the nonce differing. A genuine mismatch (a stricter or looser per-page
`Page({ headers: { csp } })`, or a guard varying the policy per request) degrades to a real
navigation instead — the one thing that can actually apply a different CSP correctly. This needs no
configuration; it's automatic for every app, and a page with no CSP configured at all is unaffected
either way.

**Reading the nonce the active document is really enforcing** — for a Comet that bakes its own
`cspNonce` prop into freshly-generated, client-side inline content (a `<style nonce>` built to
insert into a sandboxed iframe's `srcDoc`, say), rather than just forwarding it straight through to
something that renders its own nonce'd element once, at first mount:

```ts
import { getActiveCspNonce } from '@zanix/space/client'

const nonce = getActiveCspNonce() // the ACTIVE document's own nonce, right now
```

A Comet's own `PageContext.cspNonce` prop reflects that fragment's own, separately-minted nonce —
never the still-active top document's, since Orbit only ever swaps the outlet, never the whole
document. Baking the prop value into new inline content works by accident on a hard reload (the same
response mints both), then produces a real CSP violation the first time the page is reached via an
Orbit navigation. `getActiveCspNonce()` reads the nonce a real, parsed element on the page already
carries instead — always accurate, regardless of how the current document was reached. `undefined`
on a page with no nonce-based CSP configured at all.

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

`initialState` here is the explicit option, always emitted. A page rendered by the framework carries
no state unless the app sets `serialization.state`; see "Controlling what crosses to the client"
below.

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

### Controlling what crosses to the client (`serialization.state`)

A page rendered by the framework hands nothing to its client by default. This section is the full
contract: what the state is, the four values `serialization.state` takes, how to choose, and what
the option does not touch.

#### What `__ZANIX_SPACE_STATE__` is

Every full-document render can carry one inline `<script>` that assigns the page's state to
`self.__ZANIX_SPACE_STATE__` before hydration. `readInitialState()` (from `@zanix/space/client`)
reads it back in the browser. For a page, that state is built from its `loader` result: the same
value the component renders with on the server.

Serializing the whole `loader` result is a trap, because the loader returns what the server needs to
render, not what the browser needs to know. In Space 1.x it was serialized in full, which has two
consequences. **Weight:** a page that returns its message catalog for `IntlProvider` ships every
message key inside its own HTML, which in a large app is most of the document. **Privacy:** any
value a `loader` returns for the server render, a person's profile, an email, a token a component
used to call a service, was also written into the HTML as readable JSON, whether or not any client
code used it. Since 1.17.0 a page serializes nothing unless the app asks.

#### The four values

```ts
defineSpaceApp({
  name: 'web',
  serialization: { state: 'none' }, // the default; shown only to be explicit
})
```

| `state`                  | What crosses to the client                                    | `readInitialState()`           |
| ------------------------ | ------------------------------------------------------------- | ------------------------------ |
| `'none'` (default)       | Nothing: no state script and no `self.__ZANIX_SPACE_STATE__`. | `undefined`                    |
| `'all'`                  | Everything the `loader` returned, as 1.x did.                 | the whole result               |
| `{ pick: ['a', 'b'] }`   | Only these top-level keys.                                    | an object with only those keys |
| `{ omit: ['messages'] }` | Every top-level key except these.                             | an object without those keys   |

```ts
// 1. Nothing crosses. Right for an app whose Comets get everything they need through props.
defineSpaceApp({ name: 'web' })

// 2. Everything crosses. The 1.x behavior; use it only to keep an old client working.
defineSpaceApp({ name: 'web', serialization: { state: 'all' } })

// 3. Only what the client reads crosses. The safest way to keep a client that calls
//    `readInitialState()`: a new key a loader starts returning stays on the server.
defineSpaceApp({ name: 'web', serialization: { state: { pick: ['lang', 'user'] } } })

// 4. Everything crosses except what only the server uses. Convenient, but a new key crosses by
//    default, so prefer `pick` for anything sensitive.
defineSpaceApp({ name: 'web', serialization: { state: { omit: ['messages'] } } })
```

`omit` and `pick` cannot be combined. Any invalid value, including a combination, an object with
neither list, a key that is not an option or a list that is not an array of strings, throws a
`InternalError` when the app starts, with a message that says what to use instead, so a typo never
reaches a request. The rules for what counts as a state:

- Keys are matched by name at the **top level** only. A nested key with the same name is part of its
  parent and is kept or dropped with it.
- `omit` and `pick` apply to a **plain object**. A `loader` result that is an array, a `Date`, a
  `Map` or a class instance is serialized as it is. A key listed but absent from the result is
  ignored. `pick: []` serializes an empty object.
- The component always renders with the **whole** `loader` result. Only the serialized copy changes:
  the value the `loader` returned is never mutated, and the page's ETag is still computed from all
  of it.
- It works together with `serialization.extendedTypes`: `Date`, `Map` and `Set` that cross still
  round-trip as real instances.

#### How to choose

Ask one question: does any client code read `readInitialState()` or `self.__ZANIX_SPACE_STATE__`?

- **No:** leave the default. This is the case for a Comet-based app, because a Comet receives its
  data as its own props (`data-comet-props`), not through the state.
- **Yes:** list what it reads with `pick`. If it reads everything, `'all'` keeps it working, with
  the weight and privacy cost above.

#### The message catalog

The usual victim of the old default is the catalog. A page's `loader` calls `loadMessages()` and
returns it so the server can format the page through `IntlProvider`. The browser rarely needs it: a
Comet hydrates as its own root, with no `IntlProvider` above it, so it cannot use the page's catalog
anyway and receives already-resolved strings as props. With the default nothing needs to be
configured, and the catalog stays on the server. If you must keep the rest of the state, leave only
the catalog out:

```ts
defineSpaceApp({ name: 'web', serialization: { state: { omit: ['messages'] } } })
```

When a Comet does have to format on the client (a plural or a date it computes after hydration),
pass it the small subset of keys it uses as a prop and mount its own `IntlProvider` inside it,
rather than shipping the page's whole catalog. For a larger, non-critical subset, see "Deliberately
deferred" in [`docs/i18n.md`](./i18n.md): a Comet fetching its own subset on hydration is the
natural fit.

#### What the option does not change

| Channel                                          | Affected?                                                                                                                           |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| The component's own props on the server          | No: it renders with the whole `loader` result.                                                                                      |
| A Comet's props (`data-comet-props`)             | No: a separate channel, serialized as always.                                                                                       |
| An explicit `renderToResponse({ initialState })` | No: it is explicit, so it is always emitted.                                                                                        |
| `data-error-messages` on an error boundary       | No: it carries the boundary's own catalog. The React renderer emits it on every boundary, the Preact renderer only after a failure. |
| An Orbit fragment                                | No: a fragment is not a document and never carried state.                                                                           |
| The page's ETag and the CSP nonce                | No.                                                                                                                                 |

`readInitialState()` returns `T | undefined`: `undefined` is its contract for a page that carries no
state, which is now the normal case for a page. Always handle it.

#### Migrating to 1.17.0

If your client reads `readInitialState()` or `self.__ZANIX_SPACE_STATE__` from a page the framework
rendered, it now gets `undefined`. Restore the data with the narrowest option that fits:

```ts
// before 1.17.0, implicit
defineSpaceApp({ name: 'web' })

// after: keep exactly the old behavior
defineSpaceApp({ name: 'web', serialization: { state: 'all' } })

// after: keep only what the client reads (recommended)
defineSpaceApp({ name: 'web', serialization: { state: { pick: ['lang', 'user'] } } })
```

To find the readers, search the app and its dependencies for `readInitialState` and
`__ZANIX_SPACE_STATE__`. A render that passes `initialState` to `renderToResponse` itself needs no
change.

## See also

- [`README.md`](../README.md#client-side-navigation-orbit) — the "Client-side navigation" section
  this guide is the full reference for.
- [`docs/comets.md`](./comets.md) — selective hydration; `persist` there keeps a Comet's DOM alive
  across an Orbit swap.
- [`docs/css.md`](./css.md) — the `global`/page/comet CSS contract this page's "CSS during
  navigation" section relies on.
- [`docs/routing.md`](./routing.md) — layout nesting and the document shell that defines what a
  navigation swap does and doesn't touch.
