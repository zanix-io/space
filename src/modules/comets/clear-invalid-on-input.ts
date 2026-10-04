import { isDraftRestoreEvent } from './draft-restore-event.ts'

/**
 * Clears a control's server-rendered error as soon as the visitor edits that control. After a
 * rejected submit the server renders the form again with each invalid control marked
 * `aria-invalid="true"` and pointing, through `aria-describedby`, at an element whose `id` ends in
 * `-error` (the `Alert` that `@zanix/space-ui`'s `Field` renders under the control). Nothing on
 * the client revisits that markup, so the red mark and the message stay until the next submit
 * even though the visitor is already fixing the value. This listens on the `<form>` and, for the
 * control the visitor edited, removes `aria-invalid`, drops the error id from `aria-describedby`
 * (the other ids, a hint for instance, stay) and hides the error element. Hook-free and
 * renderer-agnostic, same shape as `focus-first-invalid.ts`.
 *
 * What counts as an edit is a bubbling `input` or `change` event whose target is the marked
 * control or sits inside it, caught by one delegated listener on the form: native inputs,
 * textareas, selects, checkboxes, radios and file inputs fire them themselves, and a composed
 * `@zanix/space-ui` control (`Select`, `DatePicker`, `MultiSelect`, `Combobox`, `RadioGroup`)
 * fires a `change` from its marked element when the visitor changes its value. Focus, blur and a
 * key press that leaves the value alone fire neither, so they clear nothing. The events a draft
 * restore dispatches are ignored (see `draft-restore-event.ts`): only the visitor's edit clears an
 * error.
 *
 * The form-level banner and the errors of other controls are never touched: only the error ids
 * the edited control itself points at are hidden. The error element is hidden, not removed, so
 * the markup the renderer owns stays intact, no `role="alert"` is left behind and no screen reader
 * announces the change; a re-render from the server replaces the form's markup, which brings the
 * error back when it still applies.
 *
 * @module
 */

/** Options for {@linkcode attachClearInvalidOnInput}. */
export type ClearInvalidOnInputOptions = {
  /** The real `id` of the `<form>` to listen on. */
  formId: string
}

const INVALID_SELECTOR = '[aria-invalid="true"]'
const ERROR_ID_SUFFIX = '-error'

/** Hides the error element: the `hidden` attribute, plus an inline `display: none` set through
 * the CSSOM (allowed under a strict `style-src`) for an error styled with a `display` of its own,
 * which would otherwise win over `hidden`. */
function hideError(error: HTMLElement): void {
  error.setAttribute('hidden', '')
  error.style?.setProperty('display', 'none')
}

/** Clears one marked control: the mark, the error id in `aria-describedby`, and that error. */
function clearControl(control: Element): void {
  control.removeAttribute('aria-invalid')
  const tokens = control.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean) ?? []
  const kept: string[] = []
  for (const id of tokens) {
    if (!id.endsWith(ERROR_ID_SUFFIX)) {
      kept.push(id)
      continue
    }
    const error = control.ownerDocument.getElementById(id)
    if (error) hideError(error)
  }
  if (kept.length === tokens.length) return
  if (kept.length > 0) control.setAttribute('aria-describedby', kept.join(' '))
  else control.removeAttribute('aria-describedby')
}

/** The controls an edit of `marked` clears: itself and, for a native radio, the other marked
 * radios of its group (only the newly chosen one fires the event, and the group shares one error). */
function controlsToClear(form: HTMLFormElement, marked: Element): Element[] {
  if (!(marked instanceof HTMLInputElement) || marked.type !== 'radio' || !marked.name) {
    return [marked]
  }
  const group = Array.from(form.querySelectorAll<HTMLInputElement>(INVALID_SELECTOR))
    .filter((el) => el.type === 'radio' && el.name === marked.name)
  return group.includes(marked) ? group : [marked, ...group]
}

/**
 * Attaches the clear-on-edit behavior to one `<form>` — the primitive a `useEffect`
 * (React/Preact) calls into, and what `ManagedForm`'s `clearInvalidOnInput` option enables. A form
 * with no invalid control, or an edit of a control that is not invalid, does nothing; clearing a
 * control twice is harmless.
 *
 * @returns A cleanup function — removes the listeners.
 * `useEffect(() => attachClearInvalidOnInput(options), deps)`.
 */
export function attachClearInvalidOnInput(options: ClearInvalidOnInputOptions): () => void {
  const form = globalThis.document?.getElementById(options.formId)
  if (!(form instanceof HTMLFormElement)) return () => {}

  const handleEdit = (event: Event) => {
    if (isDraftRestoreEvent(event)) return
    const target = event.target as Partial<Element> | null
    const marked = typeof target?.closest === 'function' ? target.closest(INVALID_SELECTOR) : null
    if (!marked || !form.contains(marked)) return
    for (const control of controlsToClear(form, marked)) clearControl(control)
  }

  // Capture, so an application handler that stops the event's propagation cannot hide the edit.
  form.addEventListener('input', handleEdit, true)
  form.addEventListener('change', handleEdit, true)
  return () => {
    form.removeEventListener('input', handleEdit, true)
    form.removeEventListener('change', handleEdit, true)
  }
}
