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
import { defineComet } from '@zanix/space/comet'

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
// main.ts — load the manifests cometPlugin/clientEntryPlugin wrote during the client build,
// before serving anything
import { loadClientEntryManifest } from '@zanix/space'
import { loadCometManifest } from '@zanix/space/comet'
import { activateApps } from '@zanix/app/runtime'
import { bootstrapServers } from '@zanix/server'
import spaceApp from './space.app.ts'

await loadCometManifest('./.dist/client/comets-manifest.json')
await loadClientEntryManifest('./.dist/client/client-entry-manifest.json')
await activateApps([spaceApp])
await bootstrapServers({ ssr: { application: 'storefront' } })
```

Set `defineSpaceApp({ clientBuildDir: './.dist/client' })` instead to skip both calls (and every
other production manifest load — CSS, assets, PWA, sitemap): `setup()` loads
`comets-manifest.json`/`client-entry-manifest.json` automatically from there, in production only —
see `SpaceAppConfig.clientBuildDir`'s own doc for the exact ordering.

```tsx
// used from any page's component, same as any other component
import Counter from '../comets/counter.tsx'

<Counter initial={0} comet='visible' /> // hydrates once scrolled into view
<Counter initial={0} /> // hydrates immediately (comet defaults to 'load')
```

**No client entry to write.** Every full-document response's own bootstrap script
(`hydrateComets()`/`hydrateErrorBoundaries()`/`initOrbit()`, correctly `nonce`'d for a strict
`script-src` CSP) is generated and wired in automatically — the same reasoning that already makes a
Comet's own registration automatic (`'use comet'`, no manual step). `hydrateErrorBoundaries()`
attaches interactivity to any `error.tsx` Fallback the page's own SSR pass already rendered — see
[`docs/routing.md`](./routing.md#layouts-loading-and-error-segments) for the full recovery contract.
Only set `SpaceAppConfig.clientEntry` (a real source file of your own) when a project genuinely
needs EXTRA client-side code — analytics, a global error handler:

```ts
// space.app.ts — only if you need more than hydrateComets()/initOrbit()
export default defineSpaceApp({
  name: 'storefront',
  clientEntry: './src/main.client.ts', // replaces the auto-generated default entirely
})
```

```ts
// src/main.client.ts — your own file is then fully responsible for calling these itself
import { hydrateComets, hydrateErrorBoundaries, initOrbit } from '@zanix/space/client'

hydrateComets()
hydrateErrorBoundaries()
initOrbit()
```

> **Match the client barrel to your renderer.** `@zanix/space/client` is the **React** barrel; a
> `renderer: 'preact'` app imports `@zanix/space/client/preact` instead — same exports, same
> signatures, Preact's `hydrate`/`render` underneath rather than React's `hydrateRoot`/`createRoot`.
> An app imports one or the other, never both, since `renderer` selects one for the whole project.
> The auto-generated default already picks the right one for you — this only matters for a
> `clientEntry` override you write yourself.
>
> Getting this wrong would otherwise fail silently at runtime: the page server-renders correctly,
> every comet boundary and all its content appears in the DOM, nothing throws anywhere — yet no
> Comet is ever interactive. `spacePlugin({ renderer })` fails the client build with an explicit
> error instead if the entry imports the wrong barrel, so the mismatch never reaches a browser.

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
comet reappearing under a reused key, is simply discarded.

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

### Form draft persistence

A ready-made Comet restoring unsaved `<form>` input after an accidental refresh or a
navigate-away-and-back, with no server-side state to recover it from — a plain, no-JS-required
`<form>` still works without it; this only adds recovery on top for a browser that has JS:

```tsx
// used from any page's component — a page's own loader passes hasServerValues, never computed
// ad hoc elsewhere: `ctx.submitted` is `undefined` on a GET and on any successful action, present
// only on a `422` validation re-render, exactly the signal that should win over a stale draft
import FormDraftPersistence from '@zanix/space/comet/react' // or '@zanix/space/comet/preact'

<form id='new-trigger' method='post'>{/* ... */}</form>
<FormDraftPersistence
  formId='new-trigger'
  storageKey='triggers/new'
  hasServerValues={ctx.submitted !== undefined}
/>
```

Restores a saved draft on attach (unless `hasServerValues`), saves the whole form — generically, via
`form.elements`, covering a field added later with zero per-field wiring — debounced on every
`input`/`change`, and clears the draft on `submit`. `storageKey` is required, never derived from
`location.pathname`: this framework's own `[lang]`-segment routing renders the SAME logical form at
different pathnames per language, so a pathname-derived key would fragment one operator's own draft
across a language switch mid-form.

**Always excluded, not configurable**: the `_csrf` field (this framework's own CSRF form field —
restoring a stale token here produces nothing worse than a confusing 403), any `type="password"`
field, and any `type="file"` field (never `JSON.stringify`-able). A form author's own field-level
opt-out for anything else sensitive (an API secret typed into a plain `type="text"` input, say):

```tsx
<input name='webhookSecret' data-no-persist />
```

`storage` defaults to `'session'` (scoped to the tab's lifetime — the safe default for config an
operator types in, like webhook URLs) and accepts `'local'` as an explicit, visible opt-in for a
draft genuinely meant to survive a browser restart.

**A React/Preact-controlled field can't be restored by this Comet** — writing `.value` directly on a
controlled field's DOM node never notifies the framework's own tracked setter, and gets fought or
clobbered on the next render. Exclude it via `excludeFields`, and persist it separately with the
narrower, value-level primitives both ready-made Comets are themselves built on:

```tsx
'use comet'
import { useEffect, useState } from 'react'
import { defineComet, persistDraftValue, restoreDraftValue } from '@zanix/space/comet'

function TriggerConfigEditor({ storageKey, hasServerValues, initial }: Props) {
  const [config, setConfig] = useState(initial)

  // Restore once — deps are the option VALUES, never `config` itself, so this never re-fires on
  // a keystroke and never races a stale saved value back over what was just typed.
  useEffect(
    () => restoreDraftValue(setConfig, { storageKey, hasServerValues }),
    [storageKey, hasServerValues],
  )
  // Persist, debounced, on every change — `config` IS the dependency here; each re-run's cleanup
  // cancels the previous pending write before scheduling the next one. That re-run is the debounce
  // mechanism itself, not something to work around.
  useEffect(() => persistDraftValue(config, { storageKey }), [config, storageKey])

  // ...renders its own real widget over `config`/`setConfig`
}
export default defineComet(TriggerConfigEditor, import.meta.url)
```

`restoreDraftValue` and `persistDraftValue` are kept as two separate functions rather than one
combined read-and-write primitive precisely because they need different effect dependencies to
behave correctly — see the comments above.

`attachFormDraftPersistence` (`@zanix/space/comet`) is the hook-free primitive both
`FormDraftPersistence` Comets wire into their own `useEffect` — reach for it directly only when
composing a custom comet that needs more than the ready-made one provides.

## See also

- [`README.md`](../README.md#selective-hydration-comets) — the "Selective hydration" section this
  guide is the full reference for.
- [`docs/orbit.md`](./orbit.md) — client-side navigation; `persist` above keeps a Comet's DOM alive
  across an Orbit swap.
