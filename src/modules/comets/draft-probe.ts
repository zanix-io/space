import { namespacedStorageKey } from './draft-storage.ts'

/**
 * The inline script that marks a form as restoring BEFORE the first paint, on a visit that comes
 * back to a form with an unsent draft. The server cannot read the browser's own storage, so it
 * cannot tell such a visit from a clean one; the script reads the same storage the draft was saved
 * to, as the page is parsed, and sets `data-draft-restoring="{formId}"` on itself when a draft with
 * content is saved. A stylesheet that already holds a form back while it restores after a failed
 * submit (see `FormDraftPersistence`) holds it back here too, with the same selector, and never on
 * a clean form. The form's own comet removes the mark once the draft is back; the script removes it
 * itself after {@linkcode DRAFT_RESTORE_TIMEOUT_MS} when no comet does.
 *
 * {@linkcode probeDraft} is the single definition of the check. {@linkcode buildDraftProbeScript}
 * serializes that very function into the inline source, so the script and the code that is tested
 * can never disagree about what a draft with content is.
 *
 * @module
 */

/** The longest a form stays marked as restoring. A comet that never hydrates (`comet='visible'`
 * scrolled out of view, a failed chunk) must not leave the form marked, and so hidden by an app's
 * own stylesheet, indefinitely. */
export const DRAFT_RESTORE_TIMEOUT_MS = 2000

/** Carried by the probe `<script>` itself, with the `formId` it belongs to as its value, so the
 * form's comet can find it. */
export const DRAFT_PROBE_ATTR = 'data-draft-probe'

/** The restoring mark: set by the probe, or rendered by a form's comet, with the `formId` as its
 * value. A stylesheet selects on it. */
export const DRAFT_RESTORING_ATTR = 'data-draft-restoring'

/**
 * Marks `script` as restoring when any of `keys` holds a draft with content in the chosen storage:
 * a text field with something typed, an object with at least one such field, or any other value
 * that is set. Does nothing when the storage cannot be read, a value cannot be parsed, or nothing
 * is saved.
 *
 * Self-contained on purpose — it reads no binding of this module and has no comment inside its
 * body, because {@linkcode buildDraftProbeScript} serializes its source into an inline script that
 * runs where this module does not exist.
 *
 * @param script - The element to mark: the probe `<script>`, `document.currentScript`.
 * @param formId - The form the mark belongs to.
 * @param keys - The `storageKey`s that count: the form's own, and each controlled value's.
 * @param storage - `'local'` or `'session'`.
 * @param prefix - The namespace every draft key is saved under.
 * @param timeout - Milliseconds after which the mark is removed if nothing removed it.
 */
export function probeDraft(
  script: HTMLElement | null,
  formId: string,
  keys: string[],
  storage: string,
  prefix: string,
  timeout: number,
): void {
  try {
    const store = storage === 'local' ? localStorage : sessionStorage
    const filled = (value: unknown): boolean => {
      if (value === undefined || value === null || value === '') return false
      if (typeof value === 'object' && !Array.isArray(value)) {
        const fields = value as Record<string, unknown>
        return Object.keys(fields).some((name) => fields[name] !== '')
      }
      return true
    }
    const saved = keys.some((key) => {
      const raw = store.getItem(prefix + key)
      return !!raw && filled(JSON.parse(raw))
    })
    if (!saved || !script) return
    script.setAttribute('data-draft-restoring', formId)
    setTimeout(() => script.removeAttribute('data-draft-restoring'), timeout)
  } catch (_error) {
    return
  }
}

/** Escapes what could end the inline script early or open an HTML comment inside it. */
function escapeForInlineScript(json: string): string {
  return json.replace(
    /[<\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

/** What {@linkcode buildDraftProbeScript} takes. */
export type DraftProbeScriptOptions = {
  /** The `id` of the `<form>` the mark belongs to. */
  formId: string
  /** The `storageKey`s that count as a saved draft, the form's own first. */
  storageKeys: readonly string[]
  /** `'session'` (default) or `'local'`. */
  storage?: 'session' | 'local'
}

/**
 * The inline source of the probe: {@linkcode probeDraft} serialized and called with the form's
 * options and `document.currentScript`. The result is the text of one `<script>` element.
 */
export function buildDraftProbeScript(options: DraftProbeScriptOptions): string {
  const call = [
    'document.currentScript',
    escapeForInlineScript(JSON.stringify(options.formId)),
    escapeForInlineScript(JSON.stringify(options.storageKeys)),
    escapeForInlineScript(JSON.stringify(options.storage ?? 'session')),
    escapeForInlineScript(JSON.stringify(namespacedStorageKey(''))),
    String(DRAFT_RESTORE_TIMEOUT_MS),
  ].join(',')
  return `(${probeDraft.toString().replace(/\n\s+/g, '\n')})(${call})`
}

/** The probe `<script>` of the form `formId` that is on the page, if any. */
function findProbe(formId: string): Element | undefined {
  const probes = globalThis.document?.querySelectorAll(`script[${DRAFT_PROBE_ATTR}]`) ?? []
  return Array.from(probes).find((probe) => probe.getAttribute(DRAFT_PROBE_ATTR) === formId)
}

/** Whether the probe of the form `formId` marked it as restoring and still holds the mark. */
export function isDraftProbeMarked(formId: string): boolean {
  return findProbe(formId)?.hasAttribute(DRAFT_RESTORING_ATTR) === true
}

/** Removes the mark the probe of the form `formId` set, once its draft is back. */
export function clearDraftProbe(formId: string): void {
  findProbe(formId)?.removeAttribute(DRAFT_RESTORING_ATTR)
}
