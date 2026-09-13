/**
 * Lets a Comet intercept a `<form>`'s real submission ASYNCHRONOUSLY — decide, after awaiting
 * network or other async work, whether the submission should proceed for real or was already
 * fully handled by the caller (e.g. revealing a second step in place, never navigating at all).
 * Hook-free and renderer-agnostic (zero React/Preact import), same shape as `submit-guard.ts`'s
 * own core primitive.
 *
 * **Exists because of a real, confirmed bug** (`@presenza/web`'s own `login-two-step` Comet, before
 * this primitive existed): a Comet intercepted `submit` with its own raw `addEventListener`, ran an
 * async `fetch()` to decide whether a second step was needed, then re-triggered the real submission
 * once that fetch resolved. `SubmitGuard`/`ManagedForm({ submitGuard: true })`, also attached to the
 * SAME form, disables every submit-triggering control SYNCHRONOUSLY on the very first `submit`
 * event — before the Comet's own async work had even started. By the time the Comet's fetch
 * resolved and called `form.requestSubmit()`, the only submit control was already disabled;
 * `requestSubmit()` needs a real, enabled submitter (an explicit one, or the form's own first one
 * when none is passed) and silently no-ops without it — the submission never fired, nothing thrown
 * anywhere, the button stuck forever. `managed-form.ts`'s own module doc covers why "more than one
 * behavior on the same `submit` event is safe by construction" is true but incomplete — safe for
 * listeners that only ever REACT to one `submit` event, not for one with a synchronous side effect
 * (disabling controls) that breaks another needing to re-trigger the submission later, after async
 * work finishes. `attachSubmitIntercept` below is the correct fix for that case, coordinating its
 * own double-submit protection with the async decision instead of racing it.
 *
 * @module
 */

/** Options for {@linkcode attachSubmitIntercept}. */
export type SubmitInterceptOptions = {
  /** The real `id` of the `<form>` to intercept. */
  formId: string
  /**
   * Called on the form's first real `submit`, after this primitive has already called
   * `event.preventDefault()` and disabled the form's own submit-triggering controls. Resolve
   * `'handled'` when nothing further should happen — the intercept already did everything this
   * submission needed (e.g. revealed a second step in place); the form's controls are re-enabled
   * and there the story ends. Resolve `'proceed'` to let the real submission through — see
   * {@linkcode attachSubmitIntercept} for exactly how. A REJECTED promise is treated identically to
   * `'proceed'` — the same never-the-authoritative-decision fallback a network-dependent intercept
   * should already follow on its own: if the decision can't be made, don't block the user's real
   * submission.
   */
  intercept: (form: HTMLFormElement) => Promise<'proceed' | 'handled'>
}

const SUBMIT_CONTROL_SELECTOR = 'button:not([type="button"]):not([type="reset"]), ' +
  'input[type="submit"]'

/**
 * Attaches asynchronous submit interception to one `<form>` — the primitive a `useEffect`
 * (React/Preact, see `useSubmitIntercept` in `@zanix/space/comet/react` and
 * `@zanix/space/comet/preact`) calls into.
 *
 * On the form's first real `submit`: calls `event.preventDefault()` UNCONDITIONALLY — there is no
 * "let the native submission through" path here, the form only ever really submits via this
 * primitive's own `form.submit()` call below — disables every submit-triggering control itself
 * (the same double-submit protection {@linkcode attachSubmitGuard} gives, but coordinated with
 * `intercept`'s own async work rather than blind to it: a second real `submit` while `intercept` is
 * still pending is rejected outright, exactly like `attachSubmitGuard`), then calls
 * `options.intercept(form)`.
 *
 * - `'handled'` (the only other value this contract allows besides `'proceed'`): re-enables the
 *   controls this call disabled and does nothing further — this primitive's own documented choice
 *   for that outcome, since the caller already showed whatever the submission needed. A caller
 *   wanting different control state afterward (e.g. keeping a newly revealed step's OWN controls
 *   disabled) is free to disable them again itself once `intercept`'s own promise resolves.
 * - `'proceed'`, or a REJECTED promise (treated identically — never the authoritative decision,
 *   fall back to a real submission): re-enables the controls, then calls `form.submit()` — NEVER
 *   `form.requestSubmit()`. `form.submit()` neither requires nor looks at any submit control's
 *   `disabled` state at all (unlike `requestSubmit()`, which needs a real, enabled element to act as
 *   the submitter), so it succeeds regardless of what any OTHER behavior attached to this same form
 *   already did to those controls — see this module's own doc for the real bug this fixes.
 *   `form.submit()` also never dispatches a second, cancelable `submit` event, so there is no
 *   re-entrancy into this same handler to guard against.
 *
 * **Compatible with `SubmitGuard`/`ManagedForm({ submitGuard: true })` on the SAME form, but usually
 * redundant with it.** Both attach their own, independent `submit` listener (see `managed-form.ts`'s
 * own doc on why that alone is always safe), so nothing here conflicts with `SubmitGuard` being
 * present too. But `SubmitGuard` itself never sees this primitive's own final `form.submit()` call —
 * `form.submit()` doesn't dispatch a `submit` event at all, so `SubmitGuard`'s own listener simply
 * never runs for it, which is exactly why the two don't fight over the final submission. A consumer
 * using `SubmitIntercept` almost certainly doesn't need `submitGuard: true` on the same form:
 * this primitive already rejects a second real `submit` for the entire time `intercept` is pending —
 * the same protection `SubmitGuard` exists to give, just coordinated with async work instead of
 * blind to it.
 *
 * @returns A cleanup function — detaches the listener and re-enables any control this call
 * disabled, for the (uncommon) case a consumer detaches mid-flight without a real submission having
 * happened. `useEffect(() => attachSubmitIntercept(options), deps)`.
 */
export function attachSubmitIntercept(options: SubmitInterceptOptions): () => void {
  const { formId, intercept } = options
  const form = globalThis.document?.getElementById(formId)
  if (!(form instanceof HTMLFormElement)) return () => {}

  let pending = false
  let disabled: Array<HTMLButtonElement | HTMLInputElement> = []

  const disableSubmitControls = () => {
    disabled = Array.from(
      form.querySelectorAll<HTMLButtonElement | HTMLInputElement>(SUBMIT_CONTROL_SELECTOR),
    ).filter((control) => !control.disabled)
    for (const control of disabled) control.disabled = true
  }
  const restoreSubmitControls = () => {
    for (const control of disabled) control.disabled = false
    disabled = []
  }

  const handleSubmit = (event: Event) => {
    event.preventDefault()
    if (pending) return
    pending = true
    disableSubmitControls()

    intercept(form)
      .catch((): 'proceed' => 'proceed')
      .then((outcome) => {
        pending = false
        restoreSubmitControls()
        if (outcome === 'proceed') form.submit()
      })
  }

  form.addEventListener('submit', handleSubmit)

  return () => {
    form.removeEventListener('submit', handleSubmit)
    restoreSubmitControls()
  }
}
