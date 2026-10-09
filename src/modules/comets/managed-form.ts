import { attachFormDraftPersistence } from './form-draft-persistence.ts'
import type { FormDraftPersistenceOptions } from './form-draft-persistence.ts'
import { attachFocusFirstInvalid } from './focus-first-invalid.ts'
import { attachValidateInline } from './validate-inline.ts'
import { attachClearInvalidOnInput } from './clear-invalid-on-input.ts'
import { attachSubmitGuard } from './submit-guard.ts'
import type { SubmitGuardOptions } from './submit-guard.ts'
import { attachSubmitIntercept } from './submit-intercept.ts'
import type { SubmitInterceptOptions } from './submit-intercept.ts'
import { attachUnsavedChangesGuard } from './unsaved-changes-guard.ts'
import type { UnsavedChangesGuardOptions } from './unsaved-changes-guard.ts'

/**
 * Composes {@linkcode attachFormDraftPersistence}/{@linkcode attachSubmitGuard}/
 * {@linkcode attachSubmitIntercept}/{@linkcode attachUnsavedChangesGuard}/
 * {@linkcode attachFocusFirstInvalid}/{@linkcode attachClearInvalidOnInput}/
 * {@linkcode attachValidateInline} under one `formId`, so a
 * page author enabling more than one doesn't repeat it across separate calls (or separate
 * ready-made Comets, one per behavior). Does NOT render a `<form>` itself, same reason none of the
 * primitives it composes do: a Comet's own props must be plain JSON (see `define-comet.ts`'s own
 * doc), so a component that also needs to accept arbitrary field markup as `children` — closures,
 * event handlers, none of it JSON-serializable — can't be one hydratable boundary. The `<form>` and
 * its fields stay ordinary, server-rendered markup; this only ever attaches BEHAVIOR to it by `id`,
 * exactly like each individual primitive already does.
 *
 * Attaching more than one behavior to the SAME `submit`/`input`/`change` event is safe by
 * construction FOR A LISTENER THAT ONLY EVER REACTS to that one event: each primitive adds its own,
 * independent `addEventListener` call — native DOM listeners never overwrite each other, and one
 * calling `event.preventDefault()` (`SubmitGuard`, rejecting a second submission) doesn't stop the
 * others from also running. **This is true but incomplete** — it does not cover a listener with a
 * IMMEDIATE side effect that breaks another listener needing to re-trigger the submission LATER,
 * after async work. Real, confirmed case: a Comet intercepting `submit` to run an async `fetch()`
 * before deciding whether to let the submission through, on the same form as `SubmitGuard` (which
 * disables every submit control right after that same first `submit`, before the fetch even
 * starts). By the time the fetch resolved and the Comet tried `form.requestSubmit()`, the only
 * submit control was already disabled — `requestSubmit()` needs a real, enabled submitter and
 * silently no-ops without one, so the submission never fired, with nothing thrown anywhere. See
 * `submit-intercept.ts`'s own doc for the full account. {@linkcode attachSubmitIntercept} (`intercept`
 * below) is the correct primitive for that case — it disables controls and re-triggers the
 * submission itself, coordinated with the async decision instead of racing it.
 *
 * @module
 */

/** Options for {@linkcode attachManagedForm}. */
export type ManagedFormOptions = {
  /** The real `id` of the `<form>` every enabled behavior below attaches to. */
  formId: string
  /** Enables {@linkcode attachFormDraftPersistence} — its own options, minus `formId` (supplied
   * once, above). Omit entirely to leave draft persistence disabled for this form. */
  draft?: Omit<FormDraftPersistenceOptions, 'formId'>
  /** Enables {@linkcode attachSubmitGuard} — `true` for its own defaults, an options object (minus
   * `formId`) to customize, or omit/`false` to leave double-submit prevention disabled. Usually
   * redundant when `intercept` (below) is also given — see that option's own doc. */
  submitGuard?: boolean | Omit<SubmitGuardOptions, 'formId'>
  /**
   * Enables {@linkcode attachSubmitIntercept} — its own options, minus `formId`. Omit to leave
   * submission interception disabled (the common case). `intercept` itself is a real function, so
   * it is NEVER JSON-serializable — deliberately excluded from `ManagedForm`'s own rendered Comet
   * boundary component (`managed-form-react.tsx`/`-preact.tsx`), whose props DO cross the
   * server/client boundary as JSON. This option only exists for a consumer calling
   * `attachManagedForm` directly, from within their own `'use comet'` file, exactly the way
   * `useSubmitIntercept` (`@zanix/space/comet/react`/`/preact`) already works on its own. Combining
   * this with `submitGuard: true` on the SAME form is usually redundant — see
   * `attachSubmitIntercept`'s own doc for why.
   */
  intercept?: Omit<SubmitInterceptOptions, 'formId'>
  /** Enables {@linkcode attachUnsavedChangesGuard} — `true` for its own defaults, an options
   * object (minus `formId`) to customize, or omit/`false` to leave the unload warning disabled. */
  unsavedChanges?: boolean | Omit<UnsavedChangesGuardOptions, 'formId'>
  /**
   * Enables {@linkcode attachFocusFirstInvalid}: once, when the form reaches the client already
   * rendered with errors by the server, the first control marked `aria-invalid="true"` takes the
   * focus and is scrolled into view. Omit/`false` (the default) to leave the focus alone. It waits
   * for this form's `draft` to restore, when there is one, and never takes the focus from a
   * control the visitor is already in.
   */
  focusFirstInvalid?: boolean
  /**
   * Enables {@linkcode attachClearInvalidOnInput}: when the visitor edits a control the server
   * rendered as `aria-invalid="true"`, that control loses the mark, its `aria-describedby` loses
   * the id of its error (an id ending in `-error`; a hint stays) and the error element is hidden,
   * so the error no longer sits there while the visitor corrects the value. Only that control is
   * touched: not the form banner, not the errors of other controls. An `input` or `change` event
   * inside the control counts as an edit; focus, blur and the restore of a `draft` do not. Omit/
   * `false` (the default) to keep every error until the form is rendered again; set it together
   * with `focusFirstInvalid` for the usual server-validated form.
   */
  clearInvalidOnInput?: boolean
  /**
   * Enables {@linkcode attachValidateInline}: once hydrated, the form is `noValidate` (no native
   * bubble) and the browser's own constraint validation runs in the page instead. On `submit`,
   * every control that fails it is marked `aria-invalid="true"` and gets an error element under it
   * (the `Alert` markup `Field` renders for a server error, wired in through `aria-describedby`),
   * the submission is cancelled and the first one takes the focus; after that, a control is
   * checked again when the visitor edits and leaves it. The message comes from the control's
   * `data-message-*`/`data-validation-message` attribute (on it or an ancestor, `Field`'s
   * `validationMessages` sets them), else its `validationMessage`. A cancelled submit dispatches
   * the bubbling `space:form-invalid` event on the form, for an application summary. The server
   * keeps validating, and without JavaScript the browser's own bubble applies. Omit/`false` (the
   * default) to keep the browser's own validation. Combines with `focusFirstInvalid` (the server's
   * `422`), `clearInvalidOnInput` and `submitGuard`: a submit this cancels never reaches the guard.
   */
  validateInline?: boolean
}

/**
 * Attaches every behavior {@linkcode ManagedFormOptions} enables to one `<form>` — the primitive a
 * `useEffect` (React/Preact, see `@zanix/space/comet/react` and `@zanix/space/comet/preact`) calls
 * into. Composing here, rather than three separate `<XyzGuard formId={id} />` call sites, means the
 * `id` is named once.
 *
 * @returns A cleanup function — detaches every behavior this call attached, in reverse order.
 * `useEffect(() => attachManagedForm(options), deps)`.
 */
export function attachManagedForm(options: ManagedFormOptions): () => void {
  const {
    formId,
    draft,
    submitGuard,
    intercept,
    unsavedChanges,
    focusFirstInvalid,
    clearInvalidOnInput,
    validateInline,
  } = options
  const cleanups: Array<() => void> = []

  // First: its capture-phase `submit` listener must run before the other behaviors' own.
  if (validateInline) cleanups.push(attachValidateInline({ formId }))

  if (draft) cleanups.push(attachFormDraftPersistence({ formId, ...draft }))
  if (submitGuard) {
    cleanups.push(attachSubmitGuard({ formId, ...(submitGuard === true ? {} : submitGuard) }))
  }
  if (intercept) cleanups.push(attachSubmitIntercept({ formId, ...intercept }))
  if (unsavedChanges) {
    cleanups.push(
      attachUnsavedChangesGuard({ formId, ...(unsavedChanges === true ? {} : unsavedChanges) }),
    )
  }

  // Last: after the draft's own fields restored (`draft` above restores them synchronously).
  if (focusFirstInvalid) cleanups.push(attachFocusFirstInvalid({ formId, draft }))

  if (clearInvalidOnInput) cleanups.push(attachClearInvalidOnInput({ formId }))

  return () => {
    for (const cleanup of cleanups.toReversed()) cleanup()
  }
}
