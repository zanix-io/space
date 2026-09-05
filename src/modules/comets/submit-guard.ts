/**
 * Prevents a double `<form>` submission — an impatient double-click (or a slow first response)
 * firing a second real `submit` before the first one's navigation has even started, the classic
 * "double-charge"/duplicate-order failure mode. Hook-free and renderer-agnostic (zero React/Preact
 * import), same shape as `form-draft-persistence.ts`'s own core primitive.
 *
 * Relies on this framework's own "Real HTTP, not an RPC" contract (`SpacePageController.action` —
 * a plain `<form>` POST, never a `fetch`/XHR intercepted client-side): a submission that goes
 * through always ends in a real navigation — either the next page (success) or a freshly
 * re-rendered `422` (validation failure) — so the whole document, including this Comet's own
 * `submitting` flag, is torn down and reloaded fresh regardless of outcome. There is deliberately
 * no reset/timeout path here: a real form submission never leaves this module's own state stale to
 * clean up.
 *
 * @module
 */

/** Options for {@linkcode attachSubmitGuard}. */
export type SubmitGuardOptions = {
  /** The real `id` of the `<form>` to guard. */
  formId: string
  /** Disables every submit-triggering control inside the form (a `<button>` with no `type` or
   * `type="submit"`, an `<input type="submit">`) the moment the first real submission fires — the
   * same visual "in flight, don't click again" feedback a page author would otherwise have to wire
   * by hand. `false` to guard only against a second `submit` EVENT (e.g. Enter pressed twice in a
   * text field), leaving button state to the page itself.
   * @default true
   */
  disableControls?: boolean
}

const SUBMIT_CONTROL_SELECTOR = 'button:not([type="button"]):not([type="reset"]), ' +
  'input[type="submit"]'

/**
 * Attaches double-submit prevention to one `<form>` — the primitive a `useEffect` (React/Preact,
 * see `@zanix/space/comet/react` and `@zanix/space/comet/preact`) calls into. On the form's first
 * real `submit`, disables its own submit-triggering controls (unless `disableControls` is
 * `false`) and lets the submission proceed; any FURTHER `submit` while still in flight is
 * rejected outright (`event.preventDefault()`), never reaching the server a second time.
 *
 * @returns A cleanup function — detaches the listener and re-enables any control this call
 * disabled, for the (uncommon) case a consumer detaches without the page actually navigating away
 * (e.g. `SpacePageController`'s own `redirect` never applies, a test harness, or a comet unmount
 * that isn't a real page transition). Matches a `useEffect` callback's own return contract
 * directly: `useEffect(() => attachSubmitGuard(options), deps)`.
 */
export function attachSubmitGuard(options: SubmitGuardOptions): () => void {
  const { formId, disableControls = true } = options
  const form = globalThis.document?.getElementById(formId)
  if (!(form instanceof HTMLFormElement)) return () => {}

  let submitting = false
  let disabled: Array<HTMLButtonElement | HTMLInputElement> = []

  const handleSubmit = (event: Event) => {
    if (submitting) {
      event.preventDefault()
      return
    }
    submitting = true
    if (!disableControls) return
    disabled = Array.from(
      form.querySelectorAll<HTMLButtonElement | HTMLInputElement>(SUBMIT_CONTROL_SELECTOR),
    ).filter((control) => !control.disabled)
    for (const control of disabled) control.disabled = true
  }

  form.addEventListener('submit', handleSubmit)

  return () => {
    form.removeEventListener('submit', handleSubmit)
    for (const control of disabled) control.disabled = false
  }
}
