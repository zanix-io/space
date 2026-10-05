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
  collide. A top-level named function/const keeps this name through `zanix space build`'s default
  minification and its `--obfuscate` pass — neither has a reason to touch an identifier that's also
  the module's own public export. A component that's instead a named function _expression_ returned
  from a factory (`function createWidget() { return function Widget() {...} }`) has no such
  protection: minification and `--obfuscate` can both strip that inner name, even though the exact
  same code works under `--no-minify` and `zanix space dev`. Pass the real export name as
  `defineComet`'s third argument for that case — `defineComet(Widget, import.meta.url, 'Widget')` —
  instead of relying on `Widget.name` to survive the build.
- **`import.meta.url`** — always written at this exact call site. It's this file's own identity,
  correlated to whatever hashed URL its client build actually produced.

### Wiring it up

No `vite.config.ts` needed — `zanix space build`/`zanix space dev` never read one at all
(`configFile: false`, every option passed inline) and compose `cometPlugin`/`spacePlugin`
internally. Writing the `'use comet'`-directive file above is the whole build-side setup: the plugin
discovers it and builds it as its own separate output chunk, rather than letting it get inlined into
whatever page imports it to render it server-side.

**Comets that ship in a dependency.** A production build gives a Comet its own chunk from three
sources, and the third is what makes a package's Comets work without any wiring from the app:

1. every file under the project root that starts with `'use comet'`;
2. every Comet the app's own source renders from a **named** import of a package (`<SubmitGuard />`,
   `<NavDrawer />`), found by reading the source;
3. every Comet module in the **static import graph of the app's pages and layouts**. The build
   imports each page to read its `styles` and `head`, so each Comet module they reach has already
   run its own `defineComet` by then, and that is read back instead of guessed. It covers what
   reading source cannot: a Comet a package exports as its default
   (`export default defineComet(...)`), one a package's own view is handed and calls without JSX
   (`@zanix/iam`'s `LoginEntryView` renders its `LoginTwoStep` that way), and one reached through
   another Comet.

Two limits follow from reading what ran. A Comet reached only by a runtime `import()` that no page
imports statically is not seen. And every Comet module in the graph gets a chunk, whether or not a
given request renders it: importing a barrel (`@zanix/space/comet/preact`) builds all of its Comets,
and a chunk nobody renders costs nothing at runtime. A module that `zanix space build` loaded
through a temporary rewritten copy (a local package outside the project root, linked into the
workspace) is left out, since the copy's URL names neither the real file nor anything that outlives
the import: such a Comet needs one of the first two sources.

When a Comet does not hydrate in production (`Failed to hydrate a Comet boundary`, or a request to
the package's own `https://jsr.io/...` URL blocked by a strict `script-src`), check that its module
appears in `comets-manifest.json`: a Comet missing from it was not in any source above.

Every manifest entry must be a file that exports the Comet, under its own name and as `default`:
client hydration imports that file and reads the export. `zanix space build` fails, naming the Comet
and the emitted file, when an entry chunk exports nothing. At runtime, a module that lacks the
export the markup names makes `hydrateComets` log
`Comet "<Name>" is not exported by its module
(<url>)` and leave the server-rendered markup as is.

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
(`initClientEntry()`, correctly `nonce`'d for a strict `script-src` CSP) is generated and wired in
automatically — the same reasoning that already makes a Comet's own registration automatic
(`'use comet'`, no manual step). Under the hood, `initClientEntry()` runs `hydrateComets()`, then
`hydrateErrorBoundaries()`, then `initOrbit()`. `hydrateErrorBoundaries()` attaches interactivity to
any `error.tsx` Fallback the page's own SSR pass already rendered — see
[`docs/routing.md`](./routing.md#layouts-loading-and-error-segments) for the full recovery contract.
Only set `SpaceAppConfig.clientEntry` (a real source file of your own) when a project genuinely
needs EXTRA client-side code — analytics, a global error handler:

```ts
// space.app.ts — only if you need more than initClientEntry() runs
export default defineSpaceApp({
  name: 'storefront',
  clientEntry: './src/main.client.ts', // replaces the auto-generated default entirely
})
```

```ts
// src/main.client.ts — your own file is then fully responsible for calling this itself
import { initClientEntry } from '@zanix/space/client'

initClientEntry()
// ...then your own extra code, e.g. analytics.init()
```

Need to interleave code between the three calls, or configure `initOrbit`'s own `prefetch` option?
`initClientEntry(options)` forwards `options` straight to `initOrbit` (so
`initClientEntry({ prefetch: false })` is the same as calling `initOrbit({ prefetch: false })`
directly) — but if you need the three calls separated, `hydrateComets`/`hydrateErrorBoundaries`/
`initOrbit` stay independently exported from the same barrel:

```ts
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

### Preloading a comet's chunks (`modulepreload`)

A comet's chunk imports other chunks (the client entry, the runtime, modules two comets share), and
those import more. A browser that learns about each level only after the level above it arrived
fetches the page's JavaScript as a chain of round trips, and the comets hydrate late. In a
production build every page therefore tells the browser what it will need, up front, with
`<link rel="modulepreload">`.

`zanix space build` writes `modulepreload-manifest.json` next to the other manifests: for every
chunk a page starts from (the client entry and each comet) the chunks it imports **statically**,
directly or through another chunk, nearest first. A dynamic `import()` is not listed: it loads when
the code asks for it. `defineSpaceApp({ clientBuildDir })` loads it at startup.

A comet boundary asks the renderer to preload the client entry and its own module, each with that
list. Because the request is made **at the comet**, a page with no comet preloads nothing of its
own:

|                        | React                                        | Preact                                                    |
| ---------------------- | -------------------------------------------- | --------------------------------------------------------- |
| How                    | `ReactDOM.preloadModule()`                   | a `<link rel="modulepreload">` where the boundary renders |
| Where                  | hoisted into `<head>`, after the stylesheets | in the body, at the comet                                 |
| A URL two comets share | linked once by React                         | linked once: the response drops the repeats               |

**After the stylesheets, never before.** A preload that precedes the page's stylesheets competes
with the CSS the first paint waits for. Measured in Chrome with a throttled network (`web`'s login,
cold cache, 4× slower CPU, HTTP/2), a preload placed after the stylesheets brought hydration forward
by 44 % on Slow 4G and by 61 % on Fast 3G; on its own it added 130 to 340 ms to the first paint,
which is why it matters that the stylesheets are few (see `styles` on a layout in
[`docs/css.md`](./css.md)): with them split by area the first paint was unchanged and hydration 52 %
to 64 % earlier. Over HTTP/1.1, where requests queue behind six connections, a preload placed before
the stylesheets delayed the first paint by 3 % to 25 %. These are numbers from one app on a local
machine with a simulated network, not a promise for another.

```ts
// On by default. Turn it off for the whole app:
defineSpaceApp({ name: 'web', modulepreload: false })
```

- **Development** emits none: `znx space dev` has no build and no hashed chunk names.
- **An older build** (no `modulepreload-manifest.json`) links none, without an error.
- **At most 24 imports per chunk** are listed, so an unusually deep graph cannot ask the browser for
  dozens of modules at once.
- **No nonce.** A same-origin `modulepreload` is allowed by the default policy
  (`script-src 'self' 'nonce-…'`): the real-browser check in `deno task spike:draft-probe` reports
  no violation. A policy that does not allow same-origin scripts needs its own allowance.
- **Orbit.** A fragment carries the preloads of the comets it renders, so their chunks start loading
  as the swap inserts them. The client entry and the runtime are already loaded by the document, so
  the browser reuses them and fetches nothing twice. The client only extracts stylesheets from a
  fragment; a preload stays where it renders.

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

### Ready-made Comets

`@zanix/space/comet/react` and `@zanix/space/comet/preact` export ready-made Comets for form and
page behavior. [`docs/form-drafts.md`](./form-drafts.md) covers `FormDraftPersistence`;
[`docs/form-behaviors.md`](./form-behaviors.md) covers `SubmitGuard`, `ScrollRestoration`,
`UnsavedChangesGuard`, `NetworkStatus`, asynchronous submit interception, and `ManagedForm`, which
composes the form-level ones under one `formId`.

## See also

- [`README.md`](../README.md#selective-hydration-comets) — the "Selective hydration" section this
  guide is the full reference for.
- [`docs/orbit.md`](./orbit.md) — client-side navigation; `persist` above keeps a Comet's DOM alive
  across an Orbit swap.
- [`docs/form-drafts.md`](./form-drafts.md) — `FormDraftPersistence`.
- [`docs/form-behaviors.md`](./form-behaviors.md) — the other ready-made form and page Comets.
