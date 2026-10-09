## Form draft persistence

This is the full reference for `FormDraftPersistence`, one of the ready-made Comets described in
[`docs/comets.md`](./comets.md). The other form behaviors, and `ManagedForm`, which composes this
one with them, are in [`docs/form-behaviors.md`](./form-behaviors.md).

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

**An empty `required` field is not saved.** A visitor who clears a required field and leaves would
otherwise have that blank restored over the value the server rendered for it, and a required field
cannot be submitted empty anyway; without a saved value, the field comes back as the page renders
it. Only an exactly empty value counts, as in the browser's own validation. The snapshot kept for
`returnedFromFailure` is the exception: it holds the form as it was sent, so an empty required field
that made the server refuse it is restored empty.

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

## See also

- [`docs/comets.md`](./comets.md) — the Comet contract this behavior is built on.
- [`docs/form-behaviors.md`](./form-behaviors.md) — double-submit prevention, scroll restoration,
  the unsaved-changes warning, network status, asynchronous submit interception, and `ManagedForm`.
