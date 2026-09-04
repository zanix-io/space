import { CSRF_FORM_FIELD } from '../middleware/csrf-guard.ts'
import {
  clearFromStorage,
  DEFAULT_DRAFT_DEBOUNCE_MS,
  type DraftStorageKind,
  namespacedStorageKey,
  readFromStorage,
  resolveStorageBackend,
  writeToStorage,
} from './draft-storage.ts'

export { DEFAULT_DRAFT_DEBOUNCE_MS }
export type { DraftStorageKind }

/**
 * Session/local-scoped draft persistence for a plain `<form>` — restores unsaved input after an
 * accidental refresh or a navigate-away-and-back, with no server-side state to recover it from.
 * Hook-free and renderer-agnostic (zero React/Preact import), so it is the one piece both
 * ready-made Comets (`@zanix/space/comet/react`, `@zanix/space/comet/preact`) and a consumer's own
 * composite comet compose over — see `attachFormDraftPersistence`'s own doc for the whole-form
 * primitive, and `restoreDraftValue`/`persistDraftValue` for the narrower, value-level primitive a
 * React/Preact-controlled field needs instead (a controlled field can never be restored by writing
 * `.value` directly on its DOM node — that write never notifies the framework's own tracked
 * setter, and gets fought or clobbered on the next render).
 *
 * @module
 */

/** Options for {@linkcode attachFormDraftPersistence}. */
export type FormDraftPersistenceOptions = {
  /** The real `id` of the `<form>` to observe. */
  formId: string
  /** Storage key this draft is saved under — required, never derived from `location.pathname`.
   * This framework's own `[lang]`-segment routing (`lang-pre-handler.ts`) renders the SAME
   * logical page, the SAME logical form, at two different pathnames per language
   * (`/en/triggers/new` vs. `/es/triggers/new`) — a pathname-derived key would needlessly
   * fragment one operator's own draft across a language switch mid-form. Only an author, who
   * knows which form this is, can name it uniquely; pair it with `formId` the same way both are
   * already author-chosen together. */
  storageKey: string
  /** `true` to skip restoring on attach — pass `ctx.submitted !== undefined` from a page's
   * `loader` (`PageContext.submitted` is `undefined` on a GET and on any successful action,
   * present only on a `422` validation re-render — exactly the signal that should win over a
   * possibly-stale local draft). Still persists normally once the operator keeps typing. */
  hasServerValues: boolean
  /** Field `name`s this primitive must never read or write at all — for a field owned by a
   * DIFFERENT persistence unit entirely (typically a `persistDraftValue`-backed controlled field
   * elsewhere on the same form). Omit when there is no such field. */
  excludeFields?: string[]
  /** `'session'` (default) or `'local'`. See {@linkcode DraftStorageKind}. */
  storage?: DraftStorageKind
  /** Debounce, in ms, applied after the last `input`/`change` before persisting. Defaults to
   * {@linkcode DEFAULT_DRAFT_DEBOUNCE_MS}. */
  debounceMs?: number
}

const PASSWORD_TYPE = 'password'
const FILE_TYPE = 'file'
/** A form author's own opt-out, present/absent, no value needed — for a field that is sensitive
 * in a way this module has no generic rule for (an API secret typed into a plain `type="text"`
 * input, say). Kept co-located with the field's own markup, unlike `excludeFields`, which lives at
 * the call site instead. Deliberately unprefixed (not `data-comet-*`/`data-orbit-*`) — those
 * namespace this framework's OWN Comet protocol attributes, authored by `defineComet` itself on a
 * boundary element; this one is authored by a form's own markup on a plain field, a different
 * surface entirely. */
const NO_PERSIST_ATTR = 'data-no-persist'

type PersistableElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

function isPersistableElement(el: Element): el is PersistableElement {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
}

/** Whether a field must never be read or written by this primitive — always `_csrf` (this
 * framework's own CSRF form field) and any `type="password"`/`type="file"` field, regardless of
 * configuration, plus anything named in `excludeFields` or marked {@linkcode NO_PERSIST_ATTR} on
 * its own markup. A stale CSRF token restored into the form produces nothing worse than a
 * confusing 403; a credential or a `File` (never `JSON.stringify`-able) has no business in
 * Session/Local Storage at all. */
function isExcludedField(el: PersistableElement, excludeFields: readonly string[]): boolean {
  if (el.name === CSRF_FORM_FIELD) return true
  if (el instanceof HTMLInputElement && (el.type === PASSWORD_TYPE || el.type === FILE_TYPE)) {
    return true
  }
  if (el.hasAttribute(NO_PERSIST_ATTR)) return true
  return excludeFields.includes(el.name)
}

function eachPersistableField(
  form: HTMLFormElement,
  excludeFields: readonly string[],
  visit: (el: PersistableElement) => void,
): void {
  for (const el of Array.from(form.elements)) {
    if (!isPersistableElement(el) || !el.name) continue
    if (isExcludedField(el, excludeFields)) continue
    visit(el)
  }
}

function saveForm(
  form: HTMLFormElement,
  backend: Storage,
  key: string,
  excludeFields: readonly string[],
): void {
  const draft: Record<string, string> = {}
  const excludedNames = new Set<string>()
  for (const el of Array.from(form.elements)) {
    if (isPersistableElement(el) && el.name && isExcludedField(el, excludeFields)) {
      excludedNames.add(el.name)
    }
  }
  for (const [name, value] of new FormData(form).entries()) {
    if (typeof value !== 'string' || excludedNames.has(name)) continue
    draft[name] = value
  }
  writeToStorage(backend, key, draft)
}

/** The real, bubbling DOM event a React/Preact-controlled field's own `onChange`/`onInput` handler
 * actually listens for — `checkbox`/`radio`/`<select>` map to `change` in both renderers; every
 * other `<input>` type and `<textarea>` map to `input` (React remaps its own `onChange` prop to
 * the native `input` event specifically for live-per-keystroke text fields; Preact's `onChange`
 * means the literal native event, which is why a live-typing Preact field is wired to `onInput`
 * instead — see `@zanix/space-ui`'s own `Input/render.ts` doc for the fully worked-out reasoning).
 * A raw DOM write alone never reaches either renderer's own tracked state. */
function fieldChangeEventType(el: PersistableElement): 'input' | 'change' {
  return el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio') ||
      el instanceof HTMLSelectElement
    ? 'change'
    : 'input'
}

function restoreForm(
  form: HTMLFormElement,
  backend: Storage,
  key: string,
  excludeFields: readonly string[],
): void {
  const draft = readFromStorage(backend, key)
  if (!draft || typeof draft !== 'object') return
  const record = draft as Record<string, unknown>
  eachPersistableField(form, excludeFields, (el) => {
    const value = record[el.name]
    if (typeof value !== 'string') return
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      const next = el.value === value
      if (el.checked === next) return
      el.checked = next
    } else {
      if (el.value === value) return
      el.value = value
    }
    // Dispatched AFTER the raw write, same field this write just landed on — the write alone is
    // invisible to any React/Preact-controlled wrapper around this field (e.g. `@zanix/space-ui`'s
    // `Input`/`Select`/`RadioGroup`, which always render a tracked `value` even when the CONSUMER
    // never passed one — see this function's own doc). A real, bubbling event is what makes such a
    // field's own `onChange`/`onInput` handler fire and sync its internal state to match, the same
    // path a genuine keystroke/click already takes — not a special restore-only code path.
    el.dispatchEvent(new Event(fieldChangeEventType(el), { bubbles: true }))
  })
}

/**
 * Attaches session/local-scoped draft persistence to one `<form>` — the primitive a `useEffect`
 * (React/Preact, see `@zanix/space/comet/react` and `@zanix/space/comet/preact`) calls into.
 * Restores a saved draft on attach (unless `hasServerValues`), saves on every `input`/`change`
 * (debounced), clears on `submit`. Reads/writes the whole form generically via `form.elements` —
 * covering a new field added later with zero per-field wiring — rather than a hand-maintained
 * field list.
 *
 * Always excludes `_csrf`, `type="password"`, and `type="file"` fields, plus any field marked
 * `data-no-persist` on its own markup — none of these are configurable. See
 * {@linkcode FormDraftPersistenceOptions.excludeFields} for the separate, narrower case of a field
 * owned by a different persistence unit entirely.
 *
 * @returns A cleanup function — detaches every listener this call attached. Matches a `useEffect`
 * callback's own return contract directly: `useEffect(() => attachFormDraftPersistence(options), deps)`.
 */
export function attachFormDraftPersistence(options: FormDraftPersistenceOptions): () => void {
  const {
    formId,
    storageKey,
    hasServerValues,
    excludeFields = [],
    storage,
    debounceMs = DEFAULT_DRAFT_DEBOUNCE_MS,
  } = options

  const form = globalThis.document?.getElementById(formId)
  const backend = resolveStorageBackend(storage)
  if (!(form instanceof HTMLFormElement) || !backend) return () => {}

  const key = namespacedStorageKey(storageKey)
  if (!hasServerValues) restoreForm(form, backend, key, excludeFields)

  let timer: ReturnType<typeof setTimeout> | undefined
  const handleChange = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => saveForm(form, backend, key, excludeFields), debounceMs)
  }
  const handleSubmit = () => {
    if (timer !== undefined) clearTimeout(timer)
    clearFromStorage(backend, key)
  }

  form.addEventListener('input', handleChange)
  form.addEventListener('change', handleChange)
  form.addEventListener('submit', handleSubmit)

  return () => {
    if (timer !== undefined) clearTimeout(timer)
    form.removeEventListener('input', handleChange)
    form.removeEventListener('change', handleChange)
    form.removeEventListener('submit', handleSubmit)
  }
}

/** Options shared by {@linkcode restoreDraftValue} and {@linkcode persistDraftValue}. */
export type DraftValueOptions = {
  /** Storage key this value is saved under — same "required, never derived" reasoning as
   * {@linkcode FormDraftPersistenceOptions.storageKey}. */
  storageKey: string
  /** `'session'` (default) or `'local'`. See {@linkcode DraftStorageKind}. */
  storage?: DraftStorageKind
}

/**
 * Restores a saved value for a React/Preact-controlled field — the narrower, value-level
 * counterpart to `attachFormDraftPersistence`'s restore step, for a field this primitive can
 * never write into as a DOM node directly. Reads once and calls `onRestore` if there is a saved
 * value and `hasServerValues` is `false`; does nothing otherwise. Deliberately synchronous, with
 * no cleanup to run — call it from an effect whose deps are the option values only, never the
 * controlled value itself, so it runs exactly once per real identity change rather than on every
 * keystroke: `useEffect(() => restoreDraftValue(setValue, { storageKey, hasServerValues }), [storageKey, hasServerValues])`.
 * See {@linkcode persistDraftValue} for the paired write side, kept as a separate primitive on
 * purpose — see that function's own doc for why.
 */
export function restoreDraftValue<T>(
  onRestore: (restored: T) => void,
  options: DraftValueOptions & { hasServerValues: boolean },
): void {
  if (options.hasServerValues) return
  const backend = resolveStorageBackend(options.storage)
  if (!backend) return
  const raw = readFromStorage(backend, namespacedStorageKey(options.storageKey))
  if (raw === undefined) return
  onRestore(raw as T)
}

/**
 * Persists one value, debounced, whenever it changes — the narrower, value-level counterpart to
 * `attachFormDraftPersistence`'s save step, for a consumer's own controlled-widget comet to
 * compose instead of reimplementing debounce/serialize/write from scratch. Kept as a SEPARATE
 * primitive from {@linkcode restoreDraftValue}, rather than one combined read-and-write function,
 * because the two need different effect dependencies to behave correctly: restoring must run
 * exactly once (or once per real identity change), while persisting must re-run on every value
 * change — that re-run IS the debounce mechanism (each call's cleanup cancels the previous
 * pending write before scheduling the next one), not a bug to work around. A single primitive
 * combining both would need the live value in its own dependencies for the persist half to work
 * at all, which would restore on every keystroke too, racing a stale saved value back over
 * whatever was just typed.
 *
 * @returns A cleanup function — clears the pending debounced write. Same contract as
 * {@linkcode attachFormDraftPersistence}: `useEffect(() => persistDraftValue(value, { storageKey }), [value, storageKey])`.
 */
export function persistDraftValue<T>(
  value: T,
  options: DraftValueOptions & { debounceMs?: number },
): () => void {
  const backend = resolveStorageBackend(options.storage)
  if (!backend) return () => {}

  const key = namespacedStorageKey(options.storageKey)
  const debounceMs = options.debounceMs ?? DEFAULT_DRAFT_DEBOUNCE_MS
  const timer = setTimeout(() => writeToStorage(backend, key, value), debounceMs)
  return () => clearTimeout(timer)
}
