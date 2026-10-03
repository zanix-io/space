import { clearFromStorage, readFromStorage, writeToStorage } from './draft-storage.ts'

/**
 * What happens to a draft around a `submit`, shared by every comet primitive that persists one: a
 * whole form's fields (`attachFormDraftPersistence`) and a single controlled value
 * (`persistDraftValue`/`restoreDraftValue`). Kept as one module so both follow the same lifecycle
 * and can't drift apart: the draft is dropped on `submit`; when the form opted into recovering from
 * a failed submit, a snapshot of it is kept beside the draft instead, restored only by a render
 * that follows a failure, and discarded by whatever render comes next.
 *
 * @module
 */

/** Suffix of the key a submitted draft's snapshot lives under, beside the live draft's own key. */
const SUBMITTED_SUFFIX = ':submitted'

/** The key a submitted draft's snapshot is kept under, derived from the live draft's own key. */
function submittedDraftKey(key: string): string {
  return `${key}${SUBMITTED_SUFFIX}`
}

/**
 * Takes the snapshot a previous `submit` left under `key`, if any: it is always discarded, and when
 * the render follows a failed submit (`returnedFromFailure`) and no server values are showing
 * (`hasServerValues`) it becomes the live draft again, so the caller restores it like any other
 * saved draft. Run once per attach, before the live draft is read.
 */
export function recoverSubmittedDraft(
  backend: Storage,
  key: string,
  options: { hasServerValues: boolean; returnedFromFailure?: boolean },
): void {
  const snapshotKey = submittedDraftKey(key)
  const snapshot = readFromStorage(backend, snapshotKey)
  clearFromStorage(backend, snapshotKey)
  if (!options.hasServerValues && options.returnedFromFailure && snapshot !== undefined) {
    writeToStorage(backend, key, snapshot)
  }
}

/**
 * Settles the draft stored under `key` when its form is submitted: the live draft is cleared, and
 * `snapshot` is stored beside it when `returnedFromFailure` is set (to `true` or `false`), which
 * is how a form opts in to recovering from a failed submit. `snapshot` is a function so that a
 * form that did not opt in never builds one.
 */
export function settleDraftOnSubmit(
  backend: Storage,
  key: string,
  returnedFromFailure: boolean | undefined,
  snapshot: () => unknown,
): void {
  if (returnedFromFailure !== undefined) {
    writeToStorage(backend, submittedDraftKey(key), snapshot())
  }
  clearFromStorage(backend, key)
}
