import { whenDraftRestored } from './draft-restoring.ts'

/**
 * Moves the focus to the first control of a `<form>` that the server rendered as invalid
 * (`aria-invalid="true"`) and brings it into view, once, when the form reaches the client. It is
 * for the error that comes BACK from the server: a `422` re-render, or a redirect back to the form
 * after a failed submit. A submit the browser blocks itself, through native constraint validation,
 * already focuses its first invalid control; this covers the case where there was no client-side
 * check to do it. Hook-free and renderer-agnostic (zero React/Preact import), same shape as
 * `unsaved-changes-guard.ts`'s own core primitive.
 *
 * The contract with an application is only the attribute: this reads the DOM of the form, so it
 * knows nothing about how the application words, styles or announces an error.
 *
 * @module
 */

/** What this needs of a form's own `draft` options, to wait for the draft before acting. */
export type FocusFirstInvalidDraft = {
  hasServerValues: boolean
  returnedFromFailure?: boolean
  awaitValues?: string[]
}

/** Options for {@linkcode attachFocusFirstInvalid}. */
export type FocusFirstInvalidOptions = {
  /** The real `id` of the `<form>` to look in. */
  formId: string
  /** The form's own `draft` options. When the render restores a draft (a render that follows a
   * failed submit, or one the page's `DraftProbe` marked), the focus waits until the restore has
   * settled, so it never lands on a field that is rewritten right after. Omit when the form has
   * no draft. */
  draft?: FocusFirstInvalidDraft
}

/** A control or container that the author marked as invalid. */
const INVALID_SELECTOR = '[aria-invalid="true"]'

/** What can take the focus: the control itself, or one inside a container marked as invalid (a
 * `radiogroup`, say). */
const FOCUSABLE_SELECTOR = [
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'button',
  'a[href]',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** A control the visitor types or chooses in: focus on one of these is not taken away. A button or
 * a link holding the focus is not. */
const ENTRY_SELECTOR = [
  'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"])' +
  ':not([type="image"])',
  'select',
  'textarea',
  '[contenteditable=""]',
  '[contenteditable="true"]',
].join(',')

type Measurable = Element & { checkVisibility?: (options?: object) => boolean }

/** Whether the element is disabled, itself or through a disabled `<fieldset>`. */
function isDisabled(element: Element): boolean {
  try {
    if (element.matches(':disabled')) return true
  } catch {
    // An engine without `:disabled` support falls through to the attribute check.
  }
  return (element as { disabled?: unknown }).disabled === true
}

/** Whether the element is rendered at all: not `hidden`, not `inert`, and not `display: none` or
 * `visibility: hidden` itself or in an ancestor. A hidden control cannot take the focus. */
function isRendered(element: Element): boolean {
  if (element.closest('[hidden], [inert]')) return false
  const measurable = element as Measurable
  if (typeof measurable.checkVisibility === 'function') {
    return measurable.checkVisibility({ checkVisibilityCSS: true })
  }
  const style = globalThis.getComputedStyle
  if (typeof style !== 'function') return true
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (style(node).display === 'none') return false
  }
  return true
}

function isUsable(element: Element): boolean {
  return !isDisabled(element) && isRendered(element)
}

/** The control to focus for one element marked invalid: the element itself when it can take the
 * focus, else the first focusable control inside it. `null` when none can be focused. */
function resolveFocusable(marked: Element): HTMLElement | null {
  if (marked.matches(FOCUSABLE_SELECTOR)) return isUsable(marked) ? marked as HTMLElement : null
  for (const inner of marked.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) {
    if (isUsable(inner)) return inner
  }
  return null
}

/**
 * The first control, in document order, inside `form` that is marked `aria-invalid="true"` and can
 * take the focus. A marked control that is disabled or not rendered is skipped for the next one.
 */
export function findFirstInvalidControl(form: Element): HTMLElement | null {
  for (const marked of form.querySelectorAll(INVALID_SELECTOR)) {
    const control = resolveFocusable(marked)
    if (control) return control
  }
  return null
}

/** Focuses and reveals the first invalid control of `form`, unless the visitor already moved the
 * focus into another control (or it is already on the target). */
function focusFirstInvalid(form: Element): void {
  const doc = globalThis.document
  const target = findFirstInvalidControl(form)
  if (!target) return

  const active = doc.activeElement
  if (active === target) return
  // `autofocus` is the page's own choice, not the visitor's: the invalid control wins over it.
  if (active && active.matches(ENTRY_SELECTOR) && !active.hasAttribute('autofocus')) return

  target.focus({ preventScroll: true })
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
  target.scrollIntoView?.({
    block: 'center',
    inline: 'nearest',
    behavior: reduced ? 'instant' : 'smooth',
  })
}

/**
 * Attaches the focus-first-invalid behavior to one `<form>` — the primitive a `useEffect`
 * (React/Preact, see `@zanix/space/comet/react` and `@zanix/space/comet/preact`) calls into, and
 * what `ManagedForm`'s `focusFirstInvalid` option enables. Runs once per attach, on the next frame
 * (so the other Comets that hydrate in the same burst have attached), and, when `draft` says the
 * form restores a draft, after that restore settled. Does nothing when no control is marked
 * invalid.
 *
 * It never takes the focus from a control the visitor is already in (a text field, a select, a
 * checkbox or radio, a `contenteditable`), except one the page marked `autofocus`. It scrolls
 * with `behavior: 'instant'` under `prefers-reduced-motion: reduce` and `'smooth'` otherwise.
 *
 * @returns A cleanup function — cancels a run that has not happened yet.
 * `useEffect(() => attachFocusFirstInvalid(options), deps)`.
 */
export function attachFocusFirstInvalid(options: FocusFirstInvalidOptions): () => void {
  const { formId, draft } = options
  const doc = globalThis.document
  const form = doc?.getElementById(formId)
  if (!(form instanceof HTMLFormElement)) return () => {}

  let cancelled = false
  let cancelFrame: () => void = () => {}
  const start = () => {
    const run = () => {
      if (!cancelled) focusFirstInvalid(form)
    }
    if (typeof globalThis.requestAnimationFrame === 'function') {
      const frame = globalThis.requestAnimationFrame(run)
      cancelFrame = () => globalThis.cancelAnimationFrame?.(frame)
    } else {
      const timer = setTimeout(run, 0)
      cancelFrame = () => clearTimeout(timer)
    }
  }
  const stopWaiting = draft ? whenDraftRestored(formId, draft, start) : (start(), () => {})

  return () => {
    cancelled = true
    cancelFrame()
    stopWaiting()
  }
}
