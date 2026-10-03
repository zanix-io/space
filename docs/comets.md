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
// Always a NAMED import — this subpath carries more than one ready-made Comet.
import { FormDraftPersistence } from '@zanix/space/comet/react' // or '@zanix/space/comet/preact'

<form id='new-trigger' method='post'>{/* ... */}</form>
<FormDraftPersistence
  formId='new-trigger'
  storageKey='triggers/new'
  hasServerValues={ctx.submitted !== undefined}
/>
```

Restores a saved draft on attach (unless `hasServerValues`), saves the whole form — generically, via
`form.elements`, covering a field added later with zero per-field wiring — debounced on every
`input`/`change`, and clears the draft on `submit`. A failed submit that redirects back to the form
therefore comes back empty by default; see "Recovering after a failed submit" below. `storageKey` is
required, never derived from `location.pathname`: this framework's own `[lang]`-segment routing
renders the SAME logical form at different pathnames per language, so a pathname-derived key would
fragment one operator's own draft across a language switch mid-form.

**Recovering after a failed submit.** `ctx.submitted` only exists on a `422` re-render, so a page
whose action fails for any other reason and redirects back to the form (a declined payment, a
downstream service refusing the request) has no server values to show, and the draft was already
cleared on `submit`. Pass `returnedFromFailure`, derived from the page's own signal, to keep the
submitted form recoverable:

```tsx
<FormDraftPersistence
  formId='new-trigger'
  storageKey='triggers/new'
  hasServerValues={ctx.submitted !== undefined}
  returnedFromFailure={ctx.url.searchParams.has('error')}
/>
```

Setting the option, to `true` or `false`, opts the form in: `submit` stores a snapshot of the form
instead of dropping it. The next attach restores that snapshot when `returnedFromFailure` is `true`
and always discards it afterwards, so a later fresh visit never resurrects an already-sent form.
`hasServerValues` wins when both are set. The snapshot follows the same exclusions and `storage`
choice as the draft. A network or server failure that never reaches a redirect is covered when the
page is reloaded with the same signal. Omit the option to keep the default of discarding on
`submit`. A controlled value follows the same lifecycle once it is given its form's `formId`; see
"Controlled values" below.

**Marking the form while it restores.** The restored fields appear after the page hydrates, so a
render that follows a failed submit shows the form empty for a moment first. While such a render
restores, the Comet renders a hidden `<span data-draft-restoring="{formId}">` marker, server-side,
so it is part of the first paint, and removes it once the draft is back. A stylesheet can hold the
form back until then, with nothing but CSS:

```css
@media (scripting: enabled) {
  :root:has([data-draft-restoring='new-trigger']) #new-trigger {
    opacity: 0.4;
    pointer-events: none;
  }
}
```

The marker only exists when there is something to wait for: `returnedFromFailure` is `true` and
`hasServerValues` is `false`; a visit that comes back to an unsent form is marked by the draft
probe, see below. When the page already carries the submitted values (`hasServerValues` wins, as it
does for restoring), the form is filled in directly and there is no marker, whatever
`returnedFromFailure` says. Keep the style to a skeleton or a reduced opacity; hiding the form
outright leaves a visitor without JavaScript, or whose Comet fails to load, with no form, which the
`scripting` media feature only partly guards against. The marker is also removed after a short
timeout (2 seconds), so a form is never held back indefinitely. `ManagedForm` renders the same
marker for its `draft`.

**Marking the form when a draft is saved.** The server cannot read `sessionStorage`, so on a visit
that comes back to an unsent form it cannot tell whether the form will be repainted after the first
paint. `DraftProbe` is a server component that renders one small inline `<script>`: as the page is
parsed, before the first paint, it reads the same storage the draft was saved to and, when a draft
with content is there, sets `data-draft-restoring="{formId}"` on itself. The same stylesheet that
holds a form back after a failed submit holds it back here, and a clean form is never marked.

```tsx
import { DraftProbe } from '@zanix/space/comet'
import { ManagedForm } from '@zanix/space/comet/react'

loader = (ctx) => ({
  draft: {
    storageKey: 'triggers/new',
    hasServerValues: ctx.submitted !== undefined,
    returnedFromFailure: ctx.url.searchParams.has('error'),
    awaitValues: ['triggers/new/config'],
  },
  nonce: ctx.cspNonce,
})

component = ({ draft, nonce }) => (
  <>
    <form id='new-trigger' method='post'>{/* ... */}</form>
    <DraftProbe formId='new-trigger' draft={draft} nonce={nonce} />
    <ManagedForm formId='new-trigger' draft={draft} submitGuard />
  </>
)
```

The probe takes the form's own `draft` object, so it reads the same `storageKey`, `storage` and
`awaitValues` the form persists with: a draft saved only by a controlled value, under its own
`storageKey`, marks the form too. It renders nothing when the page already carries the submitted
values (`hasServerValues`) or follows a failed submit (`returnedFromFailure`), because the form's
own Comet renders the marker itself then. The form's Comet removes the marker once the draft is back
(and, with `awaitValues`, once each controlled value is back too); the probe removes it by itself
after 2 seconds when no Comet does, so a form is never held back indefinitely.

The probe is a server component and not a Comet, and `nonce` is its prop and never a Comet's: a
Comet's props are written into the page for the browser to read, and the nonce would then be
readable by any script that runs there. Pass `ctx.cspNonce` on a page with the default CSP; the
script carries the request's nonce, so `script-src 'self' 'nonce-…'` allows it. On a page with no
nonce-based CSP, omit it.

The script is `probeDraft` (`draft-probe.ts`) serialized, about 800 bytes before compression for
each form, and it is the only definition of what a draft with content is: a text field with
something typed, an object with at least one such field, or any other value that is set. It does
nothing when the storage cannot be read or a value is not JSON.

Orbit navigations run it too. A fragment's inline scripts are replaced by fresh elements carrying
the active document's nonce when the fragment is applied, which is what makes them run; the probe's
script is one of them, so a form reached by a client-side navigation is marked in the same
synchronous step that puts it on the page.

Limits of the probe:

- The marker is set when the parser reaches the script. Place `<DraftProbe>` right after the
  `<form>` (or anywhere before the form's Comet): a browser that paints the first chunk of a
  streamed response before the script's chunk arrives paints the form once without the marker.
- `sessionStorage` is per tab. A draft saved in another tab is not seen, so a tab that opens the
  form fresh is not marked by it.
- A page whose CSP forbids the nonce (a custom `csp` without it) blocks the script: the form is
  still restored from the browser's storage after the first paint, with no marker.
- Each form adds its script to the response. Forms whose flicker does not matter can omit it.
- Comets that hold a field's state themselves restore from their own `storageKey` after they
  hydrate; list those keys in `awaitValues` so the marker covers them as well.

**Checking the probe in a real browser.** `deno task spike:draft-probe` drives the installed Google
Chrome through the shipped client, `ManagedForm`, Orbit and the default nonce-based CSP, with the
client bundle delayed so the first paint happens before hydration. It checks that a clean form is
never marked, that a form with an unsent draft is marked before the first paint and still marked at
it, that no CSP violation is reported, that the field and the marker are restored and removed after
hydration, that the same holds after an Orbit navigation without a new document load, and that a
page without the probe is not marked. `deno task spike:draft-probe -- --serve` serves the same pages
instead and prints a URL (`--preact` serves the Preact build). Open it in any Chrome, type into the
field, wait a second and reload: the log under the form shows `MARK SET` before the `PAINT` lines,
and `MARK REMOVED` after them. The same harness checks `focusFirstInvalid` (`/errors`, 2200px tall
with a disabled invalid control before the real one): the first enabled invalid control has the
focus and is in view after a full load, once; a form with no invalid control focuses nothing; a
restored draft is focused after the mark is gone, on the restored text; a field the visitor is
already in is not taken; the scroll is instant under `prefers-reduced-motion` and animated
otherwise; the control stays in view with `ScrollRestoration` before, after and later (`idle`) than
the form's comet; and an Orbit navigation focuses it again on each visit without a document load.
`--serve` prints the pages with `?mode=clean|draft|steal` and `?scroll=before|after|idle` to try
each by hand. The harness is a manual script and runs neither under `deno test` nor in CI.

**Controlled values.** `restoreDraftValue` and `persistDraftValue` accept the form's `formId`, and
with it follow the same lifecycle as the form's own fields: submitting the form clears the saved
value, `returnedFromFailure` keeps it recoverable after a failed submit, and a value saved without
having been submitted (the visitor left and came back) restores as usual. Without `formId` they
behave exactly as before, and a saved value outlives a submit. List the `storageKey` of each such
value in `awaitValues`, so the form's marker stays until each one has restored, not only the form's
own fields:

```tsx
<FormDraftPersistence
  formId='new-trigger'
  storageKey='triggers/new'
  hasServerValues={ctx.submitted !== undefined}
  returnedFromFailure={ctx.url.searchParams.has('error')}
  awaitValues={['triggers/new/config']}
  excludeFields={['config']}
/>
```

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

**What recovers, and what does not.** Space keeps no form state on the server, so every case below
is recovered from the browser's own storage; what the server can add is whatever the application
keeps itself and passes back as `hasServerValues`.

| Case                                                                              | What restores it                                                                             | Marker                                      |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------- |
| The server re-renders the form with the submitted values (`422`, `ctx.submitted`) | The page itself (`hasServerValues`), which always wins over a saved draft                    | None                                        |
| A submit fails for another reason and redirects back                              | The snapshot taken at `submit`, restored when `returnedFromFailure` is `true`                | Rendered by the form's Comet, on the server |
| The visitor leaves the form and comes back without submitting                     | The draft saved while editing, restored on attach                                            | Set by `DraftProbe` before the first paint  |
| A controlled value (a field a Comet holds itself) in either case above            | `restoreDraftValue`/`persistDraftValue` with the form's `formId`, under its own `storageKey` | Held until it is back with `awaitValues`    |
| The form was submitted and the submit worked                                      | Nothing: the draft and the snapshot are dropped                                              | None                                        |

Limits that apply to every case:

- **The browser's storage must be readable.** Where it throws (some private-browsing and quota
  policies) nothing is saved or restored, no error is raised, and no marker is set.
- **A restore always happens after the first paint.** The marker only keeps it from being seen: a
  page with no stylesheet that uses `[data-draft-restoring]` shows the form empty for an instant
  before the fields fill in. A visit with JavaScript disabled restores nothing and has no marker;
  the plain `<form>` still works.
- **The marker never holds a form back for more than 2 seconds.** A Comet that hydrates later than
  that restores its value into a form that is no longer marked.
- **`sessionStorage` is per tab and ends with it.** A draft typed in one tab is not seen in another,
  and closing the tab drops it. `storage: 'local'` survives a browser restart, is shared by every
  tab, and is readable by anyone who uses that browser profile, which is why it is an explicit
  opt-in.
- **Drafts are stored as plain text.** Nothing is encrypted. The exclusions above (`_csrf`,
  `type="password"`, `type="file"`, `data-no-persist`) are what keeps a secret out; a field a Comet
  holds itself is saved only when the Comet calls `persistDraftValue`.
- **Only the form's own named fields are saved.** The Comet reads the form's `form.elements`, which
  holds the named controls associated with the form, including one outside the `<form>` that points
  at it with the `form` attribute. A value a Comet holds as state, with no named control, is saved
  only when the Comet calls `persistDraftValue`.
- **A render that follows a failed submit restores only when the page says so.** The snapshot is
  restored when `returnedFromFailure` is `true` and discarded at the next attach either way, so the
  same form never comes back twice and a later fresh visit never resurrects a sent form.
- **The server cannot know whether a draft exists.** Only the browser can read its storage, so a
  server-rendered form is always rendered clean; the probe is what tells the stylesheet, from the
  client, before the first paint. An application that must paint the form from the server has to
  keep the values itself and pass them in, with the privacy cost of holding what a person typed and
  never sent.

**A React/Preact-controlled field restores correctly, as long as it's wired through a real
`onChange`/`onInput` handler** — after writing `.value`/`.checked` directly, this Comet also
dispatches a real, bubbling `input` (text-like fields) or `change` (`checkbox`/`radio`/`<select>`)
event on that same field, the same event a genuine keystroke or click already produces. Any
component wrapping the field — including `@zanix/space-ui`'s own `Input`/`Select`/`RadioGroup`,
which always track a `value` internally even when the page author never passes one — picks this up
through its own change handler and syncs its state to match, instead of the DOM write silently
getting reverted on the field's next re-render.

**What still genuinely needs `excludeFields` + the value-level primitives**: a field whose real
state isn't a plain string a dispatched DOM event can carry — a widget storing a structured value
(an object, a list) that no native `input`/`change` event represents on its own. Exclude it via
`excludeFields`, and persist it separately with the narrower, value-level primitives both ready-made
Comets are themselves built on:

```tsx
'use comet'
import { useEffect, useState } from 'react'
import { defineComet, persistDraftValue, restoreDraftValue } from '@zanix/space/comet'

function TriggerConfigEditor(
  { storageKey, formId, hasServerValues, returnedFromFailure, initial }: Props,
) {
  const [config, setConfig] = useState(initial)

  // Restore once — deps are the option VALUES, never `config` itself, so this never re-fires on
  // a keystroke and never races a stale saved value back over what was just typed.
  useEffect(
    () =>
      restoreDraftValue(setConfig, { storageKey, formId, hasServerValues, returnedFromFailure }),
    [storageKey, formId, hasServerValues, returnedFromFailure],
  )
  // Persist, debounced, on every change — `config` IS the dependency here; each re-run's cleanup
  // cancels the previous pending write before scheduling the next one. That re-run is the debounce
  // mechanism itself, not something to work around. `formId` ties it to the form's own submit.
  useEffect(
    () => persistDraftValue(config, { storageKey, formId, returnedFromFailure }),
    [config, storageKey, formId, returnedFromFailure],
  )

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

### Double-submit prevention

A ready-made Comet stopping a second real `<form>` submission from ever reaching the server — an
impatient double-click, or a slow first response, firing another `submit` before the first one's
navigation has even started:

```tsx
import { SubmitGuard } from '@zanix/space/comet/react' // or '@zanix/space/comet/preact'

<form id='checkout' method='post'>{/* ... */}</form>
<SubmitGuard formId='checkout' />
```

On the form's first real `submit`, disables every submit-triggering control inside it (a `<button>`
with no `type` or `type="submit"`, an `<input type="submit">`) — pass `disableControls={false}` to
guard only against a second `submit` EVENT (e.g. Enter pressed twice in a text field) and leave
button state to the page itself. Any further `submit` while still in flight is rejected outright,
never reaching the server a second time.

Relies on this framework's own "Real HTTP, not an RPC" contract: a submission that goes through
always ends in a real navigation — the next page, or a freshly re-rendered `422` — so the whole
document, including this Comet's own in-flight flag, is torn down and reloaded fresh regardless of
outcome. There is deliberately no reset/timeout path for THAT case — a real form submission never
leaves this Comet's own state stale to clean up on its own.

**Resets on a real browser back/forward-cache (bfcache) restore, too** — the one case where a
guarded page's own frozen state genuinely would otherwise go stale: the ORIGIN page (the one
`SubmitGuard` is attached to) can itself come back from bfcache after a visitor navigates back to
it, with its disabled controls and in-flight state frozen exactly as they were the instant `submit`
fired — nothing re-runs a React/Preact `useEffect`/its cleanup on a bfcache restore, since the whole
realm is frozen and thawed rather than torn down and remounted. `attachSubmitGuard` also listens for
`pageshow`, and resets both the disabled controls and the in-flight flag on a real restore
(`event.persisted === true`) — a fresh load (`persisted: false`) leaves both untouched, since
nothing has been disabled yet on a fresh instance — without it, a guarded form's submit button would
stay disabled forever after a "back" navigation.

`attachSubmitGuard` (`@zanix/space/comet`) is the hook-free primitive both `SubmitGuard` Comets wire
into their own `useEffect`.

### Scroll-position restoration

A ready-made Comet restoring window (or a single container's) scroll position across a refresh or an
Orbit navigation, WITH a reset to `(0, 0)` on a page that has no saved position yet — Orbit
(`initOrbit()`) never manages scroll itself, so without this a page reached via Orbit keeps whatever
position the PREVIOUS page left the viewport at, including a page never visited this session, which
has nothing to restore and would otherwise just keep inheriting that leftover offset:

```tsx
import { ScrollRestoration } from '@zanix/space/comet/react' // or '@zanix/space/comet/preact'

// usually once, near the root layout — restores the WHOLE page's own scroll position
<ScrollRestoration />
```

On attach: restores a saved position if one exists, otherwise resets to `(0, 0)` (skipped entirely
when the current URL already carries a `#fragment` — an explicit anchor link wins over both), saves
the current position on every `scroll` (debounced). `storageKey` defaults to
`location.pathname + location.search` — unlike `FormDraftPersistence`'s own `storageKey`
(deliberately required, never derived), a scroll position's real identity genuinely IS the page
being viewed: `/en/products` and `/es/products` are two distinct viewed pages, each with its own
real scroll position, so the `[lang]`-segment reasoning that rules out a pathname-derived key for a
shared FORM doesn't apply here.

Pass `targetId` to track one scrollable container instead of the whole window (a chat panel, a
sidebar list) — a page can mix a whole-window instance with one or more container-scoped instances,
each under its own `storageKey`:

```tsx
<div id='sidebar'>{/* ... */}</div>
<ScrollRestoration targetId='sidebar' storageKey='sidebar-scroll' />
```

`attachScrollRestoration` (`@zanix/space/comet`) is the hook-free primitive both `ScrollRestoration`
Comets wire into their own `useEffect`.

### Unsaved-changes warning

A ready-made Comet warning before a page unload discards unsaved `<form>` input — the browser's own
native "leave site?" prompt, shown only once the form has actually changed:

```tsx
import { UnsavedChangesGuard } from '@zanix/space/comet/react' // or '@zanix/space/comet/preact'

<form id='new-trigger' method='post'>{/* ... */}</form>
<UnsavedChangesGuard formId='new-trigger' />
```

Marks the form dirty on any `input`/`change`, clears it on `submit` — composes naturally alongside
`FormDraftPersistence` on the same form (one avoids losing the typed data locally, the other warns
before the tab/window closes with it still unsaved), but neither depends on the other.
`excludeFields` opts a field out of counting as "unsaved" at all (a live-search/filter box inside
the same form, say). No custom message option: every modern browser ignores a custom `beforeunload`
string and shows its own fixed wording regardless.

**Known gap, not solved here**: this only ever intercepts a real full-page unload (tab close, back/
forward, a typed URL) — Orbit intercepts same-origin `<a>` clicks itself, client-side, with no
exposed "confirm before navigating" hook of its own, so clicking an in-app link away from a dirty
form navigates immediately, unprompted. Closing that gap is Orbit's own job, not this primitive's.

`attachUnsavedChangesGuard` (`@zanix/space/comet`) is the hook-free primitive both
`UnsavedChangesGuard` Comets wire into their own `useEffect`.

### Live network status

A ready-made Comet exposing `navigator.onLine` plus real `online`/`offline` transitions as a
`data-*` attribute, rather than a prop callback — a Comet's own props must be plain JSON, so there
is no function to hand it:

```tsx
import { NetworkStatus } from '@zanix/space/comet/react' // or '@zanix/space/comet/preact'

// usually once, near the root layout
<NetworkStatus />
```

```css
[data-network-status="offline"] .requires-network {
  display: none;
}
```

Writes `data-network-status="online"|"offline"` on `document.documentElement` by default; pass
`targetId` to write it on a different element instead, and `attribute` to use a different attribute
name. A consumer wanting real `useState` instead of a DOM attribute composes the underlying
primitive directly:

```tsx
'use comet'
import { useEffect, useState } from 'react'
import { attachNetworkStatus, defineComet } from '@zanix/space/comet'

function ConnectionBanner() {
  const [online, setOnline] = useState(true)
  useEffect(() => attachNetworkStatus(setOnline), [])
  return online ? null : <p>You are offline.</p>
}
export default defineComet(ConnectionBanner, import.meta.url)
```

`attachNetworkStatus` (`@zanix/space/comet`) is the callback-based primitive both `NetworkStatus`
Comets wire their own DOM write into.

### Asynchronous submit interception

A hook-free primitive letting a Comet intercept a `<form>`'s real submission ASYNCHRONOUSLY —
decide, after awaiting a `fetch()` or other async work, whether the submission should proceed for
real or was already fully handled in place (e.g. a second step revealed, never navigating at all):

```tsx
// login-two-step.comet.tsx
'use comet'
import { defineComet } from '@zanix/space/comet'
import { useSubmitIntercept } from '@zanix/space/comet/react' // or '@zanix/space/comet/preact'

function LoginTwoStep({ formId }: { formId: string }) {
  useSubmitIntercept({
    formId,
    intercept: async (form) => {
      const hasPassword = await checkHasPassword(form)
      if (hasPassword) {
        revealPasswordStep()
        return 'handled'
      }
      return 'proceed'
    },
  })
  return null
}
export default defineComet(LoginTwoStep, import.meta.url)
```

On the form's first real `submit`: calls `event.preventDefault()` unconditionally, disables every
submit-triggering control itself while `intercept` is pending (the same double-submit protection
`SubmitGuard` gives, coordinated with the async work instead of blind to it — a second real `submit`
while `intercept` is still pending is rejected outright), then calls `intercept(form)`. `'handled'`
re-enables the controls and stops there. `'proceed'` — or a REJECTED promise, treated identically,
the same never-the-authoritative-decision fallback a network-dependent `intercept` should already
follow — re-enables the controls and calls `form.submit()`, **never** `form.requestSubmit()`.

**Why `form.submit()`, specifically**: `requestSubmit()` needs a real, enabled submit control to act
as the submitter and silently no-ops without one; `form.submit()` neither requires nor looks at any
control's `disabled` state at all. This is the actual fix for a real, confirmed bug — a Comet
intercepting `submit` with its own raw listener, doing async work, then calling
`form.requestSubmit()` once it resolved, on a form that also had `SubmitGuard` disabling every
submit control SYNCHRONOUSLY on that same first `submit`. By the time the async work resolved, the
only control was already disabled and `requestSubmit()` silently no-oped — the submission never
fired, the button stuck forever, nothing thrown anywhere. `form.submit()` also never dispatches a
second, cancelable `submit` event, so there is no re-entrancy into this same handler to guard
against.

`useSubmitIntercept` (unlike `SubmitGuard`/`ManagedForm`) is a **plain hook, not a `defineComet`
boundary** — `intercept` is a real function, and a Comet's own props must cross the server/client
boundary as plain JSON, so there is no way to hand a rendered Comet boundary a callback prop at all.
Call it from within your own `'use comet'` file's component body instead, the same way
`useCometStableId` already works.

**Compatible with `SubmitGuard`/`ManagedForm({ submitGuard: true })` on the same form, but usually
redundant with it**: `SubmitGuard` never sees this primitive's own final `form.submit()` call (it
doesn't dispatch a `submit` event at all), so the two don't fight over the final submission — but a
consumer using `SubmitIntercept` almost certainly doesn't need `submitGuard: true` too, since this
primitive already gives the same double-submit protection on its own, coordinated with the async
decision.

`attachSubmitIntercept` (`@zanix/space/comet`) is the hook-free primitive `useSubmitIntercept` wires
into its own `useEffect`.

### Composing form behaviors: `ManagedForm`

A ready-made Comet composing `FormDraftPersistence`/`SubmitGuard`/`UnsavedChangesGuard`, and the
focus on the first invalid control (`focusFirstInvalid`, below), under one `formId`, so enabling
more than one doesn't mean repeating it across separate call sites:

```tsx
import { ManagedForm } from '@zanix/space/comet/react' // or '@zanix/space/comet/preact'

<form id='new-trigger' method='post'>{/* ... */}</form>
<ManagedForm
  formId='new-trigger'
  draft={{ storageKey: 'triggers/new', hasServerValues: ctx.submitted !== undefined }}
  submitGuard
  unsavedChanges
/>
```

`draft` takes `FormDraftPersistenceOptions` minus `formId` (omit to leave draft persistence disabled
— it has no default-enabled state, since `storageKey`/`hasServerValues` are themselves required);
`submitGuard`/`unsavedChanges` each take `true` for their own defaults, an options object (again
minus `formId`) to customize, or omit/`false` to leave that one disabled. Attaching more than one to
the same `submit`/`input`/`change` event is safe by construction FOR A LISTENER THAT ONLY EVER
REACTS to that one event — each is an independent `addEventListener` call; native DOM listeners
never overwrite each other, and one calling `event.preventDefault()` (`SubmitGuard`, rejecting a
second submission) doesn't stop the others from also running. It is NOT safe for a listener with a
synchronous side effect (disabling controls) that breaks another one needing to re-trigger the
submission LATER, after async work — see "Asynchronous submit interception" above for the real bug
that surfaced, and why `attachSubmitIntercept` exists to fix it properly.

`attachManagedForm` also accepts `intercept` (`SubmitInterceptOptions` minus `formId`) as a fourth
composed behavior — omit for the common case. Since `intercept` is a real function, it's never
JSON-serializable, so it's excluded from `ManagedForm`'s own rendered Comet boundary props; pass it
only by calling `attachManagedForm` directly from your own `'use comet'` file, the same way
`useSubmitIntercept` already works standalone.

**Focusing the first invalid control.** A form the server renders again with errors (a `422`
re-render, or a redirect back to the form after a failed submit) reaches the client with the cursor
nowhere, and the error can sit below the fold. `focusFirstInvalid` moves the focus to the first
control marked `aria-invalid="true"` and brings it into view:

```tsx
<form id='new-trigger' method='post'>
  <input name='email' aria-invalid={ctx.errors.email ? 'true' : undefined} />
  {/* ... */}
</form>
<ManagedForm formId='new-trigger' focusFirstInvalid />
```

The contract with the application is only the attribute, so the option knows nothing about how an
error is worded, styled or announced. It runs once per mount, on the next frame after the comet
attaches, and does nothing when no control is marked. When the browser itself blocks a submit
through native constraint validation it already focuses the first invalid control; this covers the
error that comes back from the server, where no client-side check ran.

- **Which control.** The first marked control in document order that can take the focus. A control
  that is `disabled` (itself or through a `<fieldset>`), `hidden`, `inert`, inside a hidden or inert
  container, or not rendered (`display: none`, `visibility: hidden`) is skipped for the next one, as
  is a `type="hidden"` input. A container marked invalid, such as a `role="radiogroup"`, hands the
  focus to the first usable control inside it, and is skipped when it has none.
- **With a draft.** When the form's `draft` restores something (a render that follows a failed
  submit, or one the page's `DraftProbe` marked), the focus waits until the restore has settled: the
  same moment `data-draft-restoring` is removed, with the same 2 second ceiling. The focus then
  lands on the restored value, and never on a field that is rewritten right after. A render that
  restores nothing, including a `422` re-render (`hasServerValues`), focuses at once.
- **A visitor already typing.** The focus is not taken from a text field, `select`, `textarea`,
  checkbox, radio or `contenteditable` that already has it. A focused button or link does not block
  it, which is what an Orbit navigation that started from a link leaves behind. A control the page
  marked `autofocus` does not count as the visitor's choice: the invalid control wins over it. A
  control that already has the focus is left where it is, with no scroll.
- **Scrolling.** The control is centred in the viewport (`block: 'center'`), so a fixed header or
  bottom bar does not cover it, with `behavior: 'smooth'`, or `'instant'` under
  `prefers-reduced-motion: reduce`. The focus itself is taken without a scroll of its own
  (`preventScroll`), so the page moves once.
- **Orbit.** A client-side navigation to the form mounts the comet again, so it runs the same way as
  on a full load, once per mount; a re-render of the same comet does not move the focus again.
- **`UnsavedChangesGuard`.** Moving the focus fires no `input` or `change` event, so the form is not
  marked as changed and no unload prompt follows.
- **`ScrollRestoration`.** It sets the scroll position when it attaches, which could undo the scroll
  of a form that focused first. The run is deferred one frame so that the comets hydrating in the
  same burst have attached; a `ScrollRestoration` that hydrates later than that (a `visible` or
  `media` strategy) could still reset the scroll after the focus, and the control would hold the
  focus but sit out of view. The default strategy, and `idle`, were checked in Chrome.

`attachFocusFirstInvalid` (`@zanix/space/comet`) is the same behavior for a form that does not use
`ManagedForm`, with the form's `draft` options as an optional second input:

```ts
import { attachFocusFirstInvalid } from '@zanix/space/comet'

useEffect(() => attachFocusFirstInvalid({ formId: 'new-trigger', draft }), [])
```

**Does not render the `<form>` itself**, same reason none of the primitives it composes do: a
Comet's own props must be plain JSON, so a component that also needs to accept arbitrary field
markup as `children` — closures, event handlers, none of it JSON-serializable — can't be one
hydratable boundary. The `<form>` and its fields stay ordinary, server-rendered markup; this only
ever attaches behavior to it by `id`. The one thing it renders is the hidden `data-draft-restoring`
marker described under "Form draft persistence", while its `draft` restores after a failed submit.

`attachManagedForm` (`@zanix/space/comet`) is the hook-free primitive both `ManagedForm` Comets wire
into their own `useEffect`.

## See also

- [`README.md`](../README.md#selective-hydration-comets) — the "Selective hydration" section this
  guide is the full reference for.
- [`docs/orbit.md`](./orbit.md) — client-side navigation; `persist` above keeps a Comet's DOM alive
  across an Orbit swap.
