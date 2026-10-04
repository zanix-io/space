import { isDraftRestoreEvent } from './draft-restore-event.ts'
import { resolveFocusable, revealControl } from './focus-first-invalid.ts'

/**
 * Validates a `<form>` in the browser, with the page's own words and look, instead of the
 * browser's native bubble. Once hydrated it marks the form `noValidate` (the generic, unstyled,
 * self-dismissing bubble never shows), and on `submit` it walks the controls that fail the
 * browser's constraint validation: each gets `aria-invalid="true"`, an error element under it,
 * wired in through `aria-describedby`, and the first one takes the focus. The submission is
 * cancelled, so nothing reaches the server. Without JavaScript none of this runs: the browser's
 * own bubble blocks the submit and the server validates the same form and answers with its own
 * `422`, which is also what this never replaces.
 *
 * What counts as invalid is only what the platform already decides: the HTML constraints
 * (`required`, `type`, `pattern`, `min`/`max`, `minlength`/`maxlength`, `step`) and the custom
 * validity a control sets through `setCustomValidity` (`@zanix/space-ui`'s `validationMessage`).
 * No business rule lives here, and nothing only the server can know is checked. Composed
 * `@zanix/space-ui` controls with no native field (`Select`, `DatePicker`, `RadioGroup`) mark
 * themselves with `data-value-missing="true"` while `required` and empty; that attribute is the
 * only non-native signal this reads.
 *
 * ## When it validates
 *
 * - On `submit`: every control. A submit control with `formnovalidate` skips the check.
 * - After a control has been edited and the visitor leaves it (`focusout`): that control only, so
 *   nobody is told off while still typing a first value or merely tabbing through.
 * - While a control this marked is edited again: it is cleared as soon as it is valid, and its
 *   message follows the current failure while it is not.
 *
 * ## The message
 *
 * The first that applies: the failure's own `data-message-*` attribute (see
 * {@linkcode VALIDITY_MESSAGE_ATTRIBUTES}), then `data-validation-message`, each read from the
 * control or its nearest ancestor that carries it (so a `<form>` or a `Field` can hold the
 * defaults), then the control's own `validationMessage` (a custom validity is always its own
 * message here; the browser's text, in the browser's language, otherwise). A control with no
 * native field and none of those attributes gets {@linkcode FALLBACK_MESSAGE}.
 *
 * ## The markup
 *
 * The error is the `Alert` markup `@zanix/space-ui`'s `Field` renders for a server error: a
 * `<div id="{field}-error" role="status" data-space-ui="alert">` appended to the control's
 * `[data-space-ui="field"]` container (after the control when there is none). Its `id` follows
 * `Field`'s: the control's `id` with a trailing `-input` swapped for `-error`. An element with
 * that `id` already in the page (the server's own error) is reused, not duplicated, so the
 * existing style of the application applies to both. `role="status"` is the polite variant of
 * `Alert`, and the control that takes the focus after a submit gets an error without a `role`:
 * the focus already reads the control's `aria-describedby`, so it is announced once.
 *
 * ## The summary event
 *
 * A cancelled submit dispatches `space:form-invalid` ({@linkcode FORM_INVALID_EVENT}) on the
 * `<form>`, bubbling, with `detail: { invalid: [{ control, message }] }` in document order, so the
 * application can show a summary of its own ("Check the highlighted fields."). Space owns no toast.
 *
 * Hook-free and renderer-agnostic, same shape as `focus-first-invalid.ts`.
 *
 * @module
 */

/** The `CustomEvent` a cancelled submit dispatches on the form; see {@linkcode FormInvalidDetail}. */
export const FORM_INVALID_EVENT = 'space:form-invalid'

/** What `detail` carries on {@linkcode FORM_INVALID_EVENT}. */
export type FormInvalidDetail = {
  /** The invalid controls, in document order, each with the message shown for it. */
  invalid: Array<{ control: HTMLElement; message: string }>
}

/**
 * The attribute that holds the message of each failure, by the name of the matching
 * `ValidityState` flag. A control, or an ancestor of it, sets one to word that failure itself.
 * `customError` has none: its message is the one the control already carries.
 */
export const VALIDITY_MESSAGE_ATTRIBUTES = {
  valueMissing: 'data-message-required',
  typeMismatch: 'data-message-type-mismatch',
  patternMismatch: 'data-message-pattern-mismatch',
  tooShort: 'data-message-too-short',
  tooLong: 'data-message-too-long',
  rangeUnderflow: 'data-message-range-underflow',
  rangeOverflow: 'data-message-range-overflow',
  stepMismatch: 'data-message-step-mismatch',
  badInput: 'data-message-bad-input',
} as const

/** The attribute whose message covers any failure that has no `data-message-*` of its own. */
export const VALIDATION_MESSAGE_ATTRIBUTE = 'data-validation-message'

/** The marker `@zanix/space-ui` puts on a composed control with no native field while `required`
 * and empty. */
export const VALUE_MISSING_ATTRIBUTE = 'data-value-missing'

/** The message of a control with no native field, no `data-*` message and so no text of its own. */
export const FALLBACK_MESSAGE = 'This field is required.'

/** Options for {@linkcode attachValidateInline}. */
export type ValidateInlineOptions = {
  /** The real `id` of the `<form>` to validate. */
  formId: string
}

const ERROR_SUFFIX = '-error'
const INPUT_SUFFIX = '-input'
const FIELD_SELECTOR = '[data-space-ui="field"]'
const MARKER_SELECTOR = `[${VALUE_MISSING_ATTRIBUTE}="true"]`

type Failure = { flag: keyof typeof VALIDITY_MESSAGE_ATTRIBUTES | 'customError' | null }
type Validatable = HTMLElement & {
  validity?: Record<string, boolean>
  willValidate?: boolean
  validationMessage?: string
}

/** The radios of a group count as one control; this is its first. */
function representative(form: HTMLFormElement, control: HTMLElement): HTMLElement {
  const radio = control as HTMLInputElement
  if (radio.type !== 'radio' || !radio.name) return control
  const group = Array.from(form.elements).filter((el) =>
    (el as HTMLInputElement).type === 'radio' && (el as HTMLInputElement).name === radio.name
  )
  return (group[0] as HTMLElement | undefined) ?? control
}

/** Every control of a radio group, or just `control`. */
function groupOf(form: HTMLFormElement, control: HTMLElement): HTMLElement[] {
  const radio = control as HTMLInputElement
  if (radio.type !== 'radio' || !radio.name) return [control]
  return Array.from(form.elements).filter((el) =>
    (el as HTMLInputElement).type === 'radio' && (el as HTMLInputElement).name === radio.name
  ) as HTMLElement[]
}

/** The control a marker stands for: the marker itself when it is the invalid element (a
 * `radiogroup`), else the focusable control inside it (the trigger of a `Select`). */
function markerControl(marker: HTMLElement): HTMLElement | null {
  if (marker.getAttribute('role') === 'radiogroup') return marker
  return resolveFocusable(marker)
}

/** Whether `control` takes part in the browser's constraint validation. A `<button>` never does
 * here: the trigger of a `Select` is one, and only its `data-value-missing` marker speaks for it
 * (browsers report `willValidate: false` for it, some DOM implementations do not). */
function isNative(control: HTMLElement): boolean {
  const native = control as Validatable
  return control.localName !== 'button' && Boolean(native.validity) &&
    native.willValidate === true
}

/** The element an event on `target` refers to: a native control, or the control a marker stands
 * for. `null` for anything else. */
function controlFor(target: EventTarget | null): HTMLElement | null {
  const element = target as Partial<HTMLElement> | null
  if (!element || typeof element.closest !== 'function') return null
  if (isNative(element as HTMLElement)) return element as HTMLElement
  const marker = element.closest(MARKER_SELECTOR) as HTMLElement | null
  return marker ? markerControl(marker) : null
}

/** Why `control` fails validation, or `null` when it passes (or is not validated at all). */
function failureOf(control: HTMLElement): Failure | null {
  const native = control as Validatable
  if (isNative(control)) {
    const validity = native.validity as Record<string, boolean>
    if (validity.valid) return null
    if (validity.customError) return { flag: 'customError' }
    for (const flag of Object.keys(VALIDITY_MESSAGE_ATTRIBUTES)) {
      if (validity[flag]) return { flag: flag as keyof typeof VALIDITY_MESSAGE_ATTRIBUTES }
    }
    return { flag: null }
  }
  const marker = control.closest(MARKER_SELECTOR) as HTMLElement | null
  if (!marker || markerControl(marker) !== control) return null
  if (control.matches(':disabled')) return null
  return { flag: 'valueMissing' }
}

/** The text to show for `control`'s failure; see the module doc for the order. */
function messageFor(control: HTMLElement, failure: Failure): string {
  const read = (name: string) =>
    (control.closest(`[${name}]`) as HTMLElement | null)?.getAttribute(name)?.trim() || undefined
  const native = control as Validatable
  const own = failure.flag && failure.flag !== 'customError'
    ? read(VALIDITY_MESSAGE_ATTRIBUTES[failure.flag])
    : undefined
  if (own) return own
  if (failure.flag !== 'customError') {
    const generic = read(VALIDATION_MESSAGE_ATTRIBUTE)
    if (generic) return generic
  }
  return native.validationMessage?.trim() || FALLBACK_MESSAGE
}

/** The `id` of the error element of `control`, following `Field`'s: `-input` becomes `-error`. */
function errorIdFor(control: HTMLElement, fallback: () => string): string {
  const id = control.id
  if (!id) return fallback()
  return id.endsWith(INPUT_SUFFIX)
    ? id.slice(0, -INPUT_SUFFIX.length) + ERROR_SUFFIX
    : id + ERROR_SUFFIX
}

/**
 * Attaches inline validation to one `<form>` — the primitive a `useEffect` (React/Preact) calls
 * into, and what `ManagedForm`'s `validateInline` option enables. Attach it before any other
 * behavior of the same form: it listens in the capture phase and, for a submit it cancels, stops
 * the event, so the other listeners (`SubmitGuard` disabling the buttons, an interceptor, the
 * application's own handler) never see a submission that did not happen.
 *
 * @returns A cleanup function — removes the listeners, restores the form's own `noValidate`, and
 * removes the error elements this created. `useEffect(() => attachValidateInline(options), deps)`.
 */
export function attachValidateInline(options: ValidateInlineOptions): () => void {
  const doc = globalThis.document
  const form = doc?.getElementById(options.formId)
  if (!(form instanceof HTMLFormElement)) return () => {}

  const previousNoValidate = form.noValidate
  form.noValidate = true

  /** Controls this marked, each with the error element it shows and whether it created it. */
  const shown = new Map<HTMLElement, { error: HTMLElement; created: boolean }>()
  /** Controls the visitor edited: only these are checked on `focusout`. */
  const edited = new WeakSet<HTMLElement>()
  let counter = 0
  const timers = new Set<ReturnType<typeof setTimeout>>()

  const fallbackId = () => `${options.formId}-inline-${++counter}${ERROR_SUFFIX}`

  /** Every control that fails validation, in document order. */
  const collectInvalid = (): Array<{ control: HTMLElement; failure: Failure }> => {
    const candidates = new Set<HTMLElement>()
    for (const element of Array.from(form.elements) as HTMLElement[]) {
      candidates.add(representative(form, element))
    }
    for (const marker of Array.from(form.querySelectorAll<HTMLElement>(MARKER_SELECTOR))) {
      const control = markerControl(marker)
      if (control) candidates.add(control)
    }
    const found: Array<{ control: HTMLElement; failure: Failure }> = []
    for (const control of candidates) {
      const failure = failureOf(control)
      if (failure) found.push({ control, failure })
    }
    return found.sort((a, b) =>
      a.control.compareDocumentPosition(b.control) & 4 /* b follows a */ ? -1 : 1
    )
  }

  const show = (control: HTMLElement, message: string, role: 'status' | null) => {
    const id = errorIdFor(control, fallbackId)
    let entry = shown.get(control)
    let error = entry?.error ?? doc.getElementById(id) as HTMLElement | null
    if (!error) {
      error = doc.createElement('div')
      error.id = id
      error.setAttribute('data-space-ui', 'alert')
      const field = control.closest(FIELD_SELECTOR)
      if (field) field.appendChild(error)
      else control.after(error)
      entry = { error, created: true }
    } else if (!entry) {
      entry = { error, created: false }
    }
    shown.set(control, entry)
    if (role) error.setAttribute('role', role)
    else error.removeAttribute('role')
    error.textContent = message
    error.removeAttribute('hidden')
    error.style?.removeProperty('display')
    for (const member of groupOf(form, control)) {
      member.setAttribute('aria-invalid', 'true')
      const tokens = member.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean) ?? []
      if (!tokens.includes(error.id)) tokens.push(error.id)
      member.setAttribute('aria-describedby', tokens.join(' '))
    }
  }

  const clear = (control: HTMLElement) => {
    const entry = shown.get(control)
    if (!entry) return
    shown.delete(control)
    for (const member of groupOf(form, control)) {
      member.removeAttribute('aria-invalid')
      const tokens = (member.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean) ?? [])
        .filter((token) => token !== entry.error.id)
      if (tokens.length > 0) member.setAttribute('aria-describedby', tokens.join(' '))
      else member.removeAttribute('aria-describedby')
    }
    if (entry.created) entry.error.remove()
    else {
      entry.error.setAttribute('hidden', '')
      entry.error.style?.setProperty('display', 'none')
    }
  }

  const handleSubmit = (event: Event) => {
    const submitter = (event as SubmitEvent).submitter as { formNoValidate?: boolean } | null
    if (submitter?.formNoValidate) return
    const invalid = collectInvalid()
    const stillInvalid = new Set(invalid.map((item) => item.control))
    for (const control of Array.from(shown.keys())) {
      if (!stillInvalid.has(control)) clear(control)
    }
    if (invalid.length === 0) return

    event.preventDefault()
    event.stopImmediatePropagation()

    const focusTarget = invalid.map((item) => resolveFocusable(item.control)).find(Boolean) ?? null
    const results = invalid.map(({ control, failure }) => {
      const message = messageFor(control, failure)
      show(control, message, control === focusTarget ? null : 'status')
      edited.add(control)
      return { control, message }
    })
    if (focusTarget) revealControl(focusTarget)
    form.dispatchEvent(
      new CustomEvent<FormInvalidDetail>(FORM_INVALID_EVENT, {
        bubbles: true,
        detail: { invalid: results },
      }),
    )
  }

  /** Re-checks one control: marks it, refreshes its message or clears it. `onlyKnown` leaves a
   * control this never marked alone (the check for an edit, which never raises a new error). */
  const evaluate = (control: HTMLElement, onlyKnown: boolean) => {
    const failure = failureOf(control)
    if (!failure) {
      clear(control)
      return
    }
    const entry = shown.get(control)
    if (onlyKnown) {
      if (entry && !entry.error.hasAttribute('hidden')) {
        entry.error.textContent = messageFor(control, failure)
      }
      return
    }
    show(control, messageFor(control, failure), 'status')
  }

  /** A native control is already up to date when its event fires; a composed one (no native
   * field) re-renders after its own `change`, so it is looked at once that has happened. */
  const evaluateAfterRender = (control: HTMLElement, onlyKnown: boolean) => {
    if (isNative(control)) {
      evaluate(control, onlyKnown)
      return
    }
    const timer = setTimeout(() => {
      timers.delete(timer)
      evaluate(control, onlyKnown)
    }, 0)
    timers.add(timer)
  }

  const handleEdit = (event: Event) => {
    if (isDraftRestoreEvent(event)) return
    const control = controlFor(event.target)
    if (!control || !form.contains(control)) return
    const rep = representative(form, control)
    edited.add(rep)
    if (shown.has(rep)) evaluateAfterRender(rep, true)
  }

  const handleFocusOut = (event: Event) => {
    const control = controlFor(event.target)
    if (!control || !form.contains(control)) return
    const rep = representative(form, control)
    if (!edited.has(rep) && !shown.has(rep)) return
    evaluateAfterRender(rep, false)
  }

  const handleReset = () => {
    for (const control of Array.from(shown.keys())) clear(control)
  }

  form.addEventListener('submit', handleSubmit, true)
  form.addEventListener('input', handleEdit, true)
  form.addEventListener('change', handleEdit, true)
  form.addEventListener('focusout', handleFocusOut, true)
  form.addEventListener('reset', handleReset)

  return () => {
    form.removeEventListener('submit', handleSubmit, true)
    form.removeEventListener('input', handleEdit, true)
    form.removeEventListener('change', handleEdit, true)
    form.removeEventListener('focusout', handleFocusOut, true)
    form.removeEventListener('reset', handleReset)
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    for (const control of Array.from(shown.keys())) clear(control)
    form.noValidate = previousNoValidate
  }
}
