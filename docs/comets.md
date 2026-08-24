## Selective hydration ("Comets")

This is the full reference the README's
["Selective hydration (\"Comets\")"](../README.md#selective-hydration-comets) section points to — a
Comet is a component that ships its own client bundle, hydrated independently of the rest of the
page.

### The three required pieces

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

### Wiring it up

No `vite.config.ts` needed — `zanix space build`/`zanix space dev` never read one at all
(`configFile: false`, every option passed inline) and compose `cometPlugin`/`spacePlugin`
internally. Writing the `'use comet'`-directive file above is the whole build-side setup: the plugin
discovers it and builds it as its own separate output chunk, rather than letting it get inlined into
whatever page imports it to render it server-side.

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

### Mount modes and persistence

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

### Server-only code boundary

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

### Host-overridable presentation

**Making a Comet's own presentation host-overridable** (a different concern from theming — swapping
just ONE component's look, not app-wide tokens): a Comet is composed as part of a Zanix App
manifest, so it can resolve its own className/style via `@zanix/app`'s `resolveBehavior()` — see
`@zanix/app`'s own README, "Style-only overrides — keep the component's own logic, swap only its
presentation," for the full pattern and its one real precondition (the Comet's own author has to opt
in by adding that call; it's not retroactive).

## See also

- [`README.md`](../README.md#selective-hydration-comets) — the "Selective hydration" section this
  guide is the full reference for.
- [`docs/orbit.md`](./orbit.md) — client-side navigation; `persist` above keeps a Comet's DOM alive
  across an Orbit swap.
