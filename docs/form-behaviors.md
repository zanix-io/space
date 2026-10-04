## Form behaviors

This is the full reference for the ready-made form and page Comets described in
[`docs/comets.md`](./comets.md), except draft persistence, which has its own guide in
[`docs/form-drafts.md`](./form-drafts.md).

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
focus on the first invalid control (`focusFirstInvalid`, below) and the clearing of a control's
error when the visitor edits it (`clearInvalidOnInput`, below) and validation in the page instead of
the browser's bubble (`validateInline`, below), under one `formId`, so enabling more than one
doesn't mean repeating it across separate call sites:

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

**Clearing an error when the visitor edits the control.** After a rejected submit the server renders
the form again with each invalid control marked `aria-invalid="true"` and pointing, through
`aria-describedby`, at the element that holds its message. Nothing on the client revisits that
markup, so the red mark and the message stay until the next submit even while the visitor is fixing
the value. `clearInvalidOnInput` removes them as soon as that control is edited:

```tsx
<ManagedForm formId='new-trigger' focusFirstInvalid clearInvalidOnInput />
```

For the control the visitor edited, it removes `aria-invalid`, removes the error id from
`aria-describedby` (the other ids, a hint for instance, stay; the attribute goes when none is left)
and hides the error element. The contract with the application is the markup `Field` from
`@zanix/space-ui` renders: the error element is the one the control's `aria-describedby` names with
an `id` ending in `-error`.

- **Default: off.** Every other `ManagedForm` option is opt-in too, and turning it on changes what a
  form shows after the first keystroke, so an existing app keeps its behavior until it adds the
  prop. A server-validated form wants it together with `focusFirstInvalid`.
- **What counts as an edit.** A bubbling `input` or `change` event whose target is the marked
  control or sits inside it, caught by one delegated listener on the `<form>` (no listener per
  control). Focus, blur and a key press that leaves the value unchanged fire neither, so they clear
  nothing.
- **Only that control.** The form banner, the toast and the errors of other controls are untouched:
  only the error ids the edited control points at are hidden. Choosing a native radio clears every
  marked radio of its group, since the group shares one error.
- **Hidden, not removed.** The error element gets `hidden` (and an inline `display: none` through
  the CSSOM, allowed under a nonce-based `style-src`, for a message styled with a `display` of its
  own). The markup the renderer owns stays intact, no `role="alert"` is left behind and the change
  is not announced by a screen reader. A new render from the server replaces the form's markup, so
  an error that still applies comes back.
- **With a draft.** Restoring a saved value fires the same `input`/`change` events a keystroke
  would, so a controlled field syncs; the restore marks them and this option ignores them. Only the
  visitor's edit clears an error, never the restore of a draft.
- **Composed controls.** `Select`, `DatePicker`, `MultiSelect`, `Combobox` and `RadioGroup` of
  `@zanix/space-ui` (2.9.0 or later) keep their value in state and render no native field, so each
  fires a bubbling `change` from its `aria-invalid` element (the trigger button, the combobox input,
  the `radiogroup` root) when the visitor changes the value. Native inputs, textareas, selects,
  checkboxes, radios and file inputs fire their own.

**Validating in the browser: `validateInline`.** A form with an `<input required>` is blocked by the
browser itself on an empty submit: a generic bubble, in the browser's language, unstyled, that
disappears after a few seconds and leaves no mark. The submit never reaches the server, so the
per-field error the server renders (`aria-invalid`, the message under the control, the focus) never
shows in the most common case. `validateInline` runs the browser's own constraint validation in the
page and shows the result as that same error:

```tsx
import { Field, Input } from '@zanix/space-ui'
import { ManagedForm } from '@zanix/space/comet/react'

<form id='new-connection' method='post'>
  <Field
    label='Connection name'
    error={fieldErrors.name}
    validationMessages={{
      required: 'Give the connection a name.',
      tooShort: 'Use at least 3 characters.',
    }}
  >
    {(field) => <Input {...field} name='name' required minLength={3} />}
  </Field>
  <button type='submit'>Save</button>
</form>
<ManagedForm
  formId='new-connection'
  focusFirstInvalid
  clearInvalidOnInput
  validateInline
  submitGuard
/>
```

Once the comet hydrates the form is `noValidate`, so the bubble never shows. Without JavaScript
nothing of this runs: the browser's bubble blocks the submit as before and the server validates the
same form and answers with its own `422`. The server stays the authority either way; this adds a
round trip saved, never a rule.

- **Default: off.** The option only changes a form that asks for it.
- **What is validated.** Only what the platform already decides: the HTML constraints (`required`,
  `type`, `pattern`, `min`/`max`, `minlength`/`maxlength`, `step`) and a custom validity set with
  `setCustomValidity` (`@zanix/space-ui`'s `validationMessage`, on `Input`, `Textarea`,
  `PasswordInput`, `Combobox`, `MultiSelect` and `FileInput`). A disabled control is skipped, and a
  submit control with `formnovalidate` skips the check. Business rules and anything only the server
  can know (a name already taken) stay on the server.
- **When.** On `submit`, every control. After that, a control is checked when the visitor edits it
  and leaves it (`focusout`), so nobody is told off while typing a first value or tabbing past a
  field. While an error shows, editing the control clears it as soon as the value is valid and keeps
  the message current while it is not (with `clearInvalidOnInput` also on, the edit hides the error
  first and the next `focusout` brings it back if the value is still invalid).
- **On a cancelled submit.** Every invalid control gets `aria-invalid="true"`, its error id is added
  to `aria-describedby` (a hint stays), the submit is cancelled, and the first invalid control, in
  document order, takes the focus and is scrolled into view, the same way `focusFirstInvalid` does
  it (and unlike it, even from a text field the visitor is in, since they just pressed Enter). A
  radio group is one control: one error, every radio marked.
- **The message.** The first that applies: the failure's own attribute, `data-message-required`,
  `data-message-type-mismatch`, `data-message-pattern-mismatch`, `data-message-too-short`,
  `data-message-too-long`, `data-message-range-underflow`, `data-message-range-overflow`,
  `data-message-step-mismatch` or `data-message-bad-input`; then `data-validation-message` for any
  failure; then the control's own `validationMessage` (a custom validity always keeps its own
  message; otherwise it is the browser's text, in the browser's language). Each attribute is read
  from the control or its nearest ancestor that has it, so `Field`'s `validationMessages` prop sets
  them for the control inside, and the `<form>` can hold a default for every field. A control with
  no native field and no message gets the English `This field is required.`: give those a message.
- **The markup.** The error is the `Alert` markup `Field` renders for a server error,
  `<div id="{field}-error" role="status" data-space-ui="alert">`, appended to the control's
  `[data-space-ui="field"]` container (after the control when there is none), so the application's
  styling of that alert applies and there are not two looks. Its `id` is the control's `id` with a
  trailing `-input` swapped for `-error`, as in `Field`. An element with that `id` already in the
  page, the server's own error, is reused instead of duplicated. The client builds the node itself,
  so `Field`'s markup does not change for a form that does not use the option.
- **Screen readers.** The inline errors use `role="status"`, the polite variant of `Alert`. The
  control that takes the focus after a submit gets its error without a `role`: the focus already
  reads the control's `aria-describedby`, so it is announced once. The others are announced politely
  after it, and the application's own summary (below) is the single assertive message. Some screen
  readers still read a message a second time when the focus lands on a control described by a status
  that was just inserted; this is a limit of the pattern, not something the option can detect.
- **Controls without a native field.** `Select`, `DatePicker` and `RadioGroup` hold their value in
  component state, so the browser cannot enforce `required` on them. `@zanix/space-ui` gives them a
  `required` prop that marks the control with `data-value-missing="true"` while it is empty (and
  `aria-required` on a `RadioGroup`), which `validateInline` reads. That is the only non-native
  signal it understands: a control that validates itself some other way has to use
  `setCustomValidity` on a real field, or leave that check to the server. These controls re-render
  after their `change`, so they are checked one tick later.
- **A summary for the page.** A cancelled submit dispatches a bubbling `space:form-invalid`
  `CustomEvent` on the form (`FORM_INVALID_EVENT`), with `detail.invalid`, the invalid controls in
  document order, each with its `message`. Space owns no toast; the application listens and shows
  its own:

  ```ts
  import { FORM_INVALID_EVENT } from '@zanix/space/comet'
  import type { FormInvalidDetail } from '@zanix/space/comet'

  useEffect(() => {
    const form = document.getElementById('new-connection')!
    const onInvalid = (event: Event) => {
      const { invalid } = (event as CustomEvent<FormInvalidDetail>).detail
      toast.error(`Check the ${invalid.length} highlighted fields.`)
    }
    form.addEventListener(FORM_INVALID_EVENT, onInvalid)
    return () => form.removeEventListener(FORM_INVALID_EVENT, onInvalid)
  }, [])
  ```

- **With the other options.** `focusFirstInvalid` still handles the form the server renders again
  after a `422`; `validateInline` handles the submit before it. It attaches before the other
  behaviors and stops the `submit` it cancels, so `submitGuard` never disables the buttons for a
  submit that did not happen, and neither `draft` nor an interceptor sees it. A submit that passes
  goes through untouched. The server's own error on a control that still passes the browser's
  validation is left alone, and a server-rendered error element a client error reuses is hidden,
  never removed, when it clears. A form `reset` clears every inline error.
- **Before hydration.** Until the comet hydrates the browser's own bubble still applies, which is
  the fallback, not a gap.

`attachValidateInline` (`@zanix/space/comet`) is the same behavior for a form that does not use
`ManagedForm`; call it before attaching the other behaviors of that form.

| Control                                             | Event that clears                                  |
| --------------------------------------------------- | -------------------------------------------------- |
| `input` (text, email, ...), `textarea`              | `input`                                            |
| `select`, checkbox, radio, file input               | `change` (a radio clears its marked group)         |
| `Select`, `DatePicker` (trigger button)             | `change` fired by `space-ui` on choosing a value   |
| `Combobox`, `MultiSelect` (input `role="combobox"`) | `input` while typing, `change` on choosing a value |
| `RadioGroup` (`role="radiogroup"` root)             | `change` fired by `space-ui` on choosing an item   |

`attachClearInvalidOnInput` (`@zanix/space/comet`) is the same behavior for a form that does not use
`ManagedForm`:

```ts
import { attachClearInvalidOnInput } from '@zanix/space/comet'

useEffect(() => attachClearInvalidOnInput({ formId: 'new-trigger' }), [])
```

**Does not render the `<form>` itself**, same reason none of the primitives it composes do: a
Comet's own props must be plain JSON, so a component that also needs to accept arbitrary field
markup as `children` — closures, event handlers, none of it JSON-serializable — can't be one
hydratable boundary. The `<form>` and its fields stay ordinary, server-rendered markup; this only
ever attaches behavior to it by `id`. The one thing it renders is the hidden `data-draft-restoring`
marker described in [`docs/form-drafts.md`](./form-drafts.md), while its `draft` restores after a
failed submit.

`attachManagedForm` (`@zanix/space/comet`) is the hook-free primitive both `ManagedForm` Comets wire
into their own `useEffect`.

## See also

- [`docs/comets.md`](./comets.md) — the Comet contract these behaviors are built on.
- [`docs/form-drafts.md`](./form-drafts.md) — `FormDraftPersistence`, which `ManagedForm` composes
  through its `draft` option.
- [`docs/orbit.md`](./orbit.md) — client-side navigation, which `ScrollRestoration` also covers.
