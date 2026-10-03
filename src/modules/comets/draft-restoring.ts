/**
 * Tells a form's own comet when every draft belonging to it has been restored, so a form that
 * follows a failed submit can be marked as restoring until then (`data-draft-restoring`, see
 * `FormDraftPersistence`), or as soon as the page's inline probe found a saved draft (`DraftProbe`).
 * The form's own fields restore synchronously on attach; a controlled
 * value restores from its own comet (`restoreDraftValue`), which hydrates on its own schedule, so
 * the form's comet waits for each of those to report before it clears the mark.
 *
 * @module
 */
import { clearDraftProbe, DRAFT_RESTORE_TIMEOUT_MS, isDraftProbeMarked } from './draft-probe.ts'

export { DRAFT_RESTORE_TIMEOUT_MS }

/** The storage keys that reported a restored value, per form. */
const reported = new Map<string, Set<string>>()
/** The waiters to notify when a form's set above changes. */
const listeners = new Map<string, Set<() => void>>()

/** Whether a render is one that restores something once it hydrates, and so starts marked as
 * restoring: it shows no server values and follows a failed submit. */
export function startsRestoring(
  options: { hasServerValues: boolean; returnedFromFailure?: boolean },
): boolean {
  return options.returnedFromFailure === true && !options.hasServerValues
}

/** Forgets what the form `formId`'s values reported, so a later visit to the same form (an Orbit
 * navigation back to it) starts from nothing instead of being satisfied by this one's reports. */
export function forgetDraftValues(formId: string): void {
  reported.delete(formId)
}

/** Records that the controlled value saved under `storageKey` has been restored (or had nothing to
 * restore) for the form `formId`, and wakes whoever waits for it. */
export function reportDraftValueRestored(formId: string, storageKey: string): void {
  const keys = reported.get(formId) ?? new Set<string>()
  keys.add(storageKey)
  reported.set(formId, keys)
  for (const notify of Array.from(listeners.get(formId) ?? [])) notify()
}

/**
 * Calls `onSettled` once every key in `storageKeys` has reported through
 * {@linkcode reportDraftValueRestored} for the form `formId` — immediately, when there is none to
 * wait for or all already did (a controlled comet can hydrate before the form's own) — or once
 * {@linkcode DRAFT_RESTORE_TIMEOUT_MS} passes, whichever comes first. Calls it at most once.
 *
 * @returns A cleanup function — stops waiting and forgets what the form's values reported, so a
 * later visit to the same form starts from nothing.
 */
export function awaitDraftValues(
  formId: string,
  storageKeys: readonly string[],
  onSettled: () => void,
): () => void {
  let settled = false
  const settle = () => {
    if (settled) return
    settled = true
    onSettled()
  }
  const done = () => {
    const keys = reported.get(formId)
    return storageKeys.every((storageKey) => keys?.has(storageKey))
  }

  if (done()) {
    settle()
    return () => forgetDraftValues(formId)
  }

  const waiters = listeners.get(formId) ?? new Set<() => void>()
  const check = () => {
    if (done()) settle()
  }
  waiters.add(check)
  listeners.set(formId, waiters)
  const timer = setTimeout(settle, DRAFT_RESTORE_TIMEOUT_MS)

  return () => {
    clearTimeout(timer)
    waiters.delete(check)
    if (waiters.size === 0) listeners.delete(formId)
    forgetDraftValues(formId)
  }
}

/**
 * What a form's own comet runs on attach: marks nothing when the render restores nothing
 * ({@linkcode startsRestoring}, and no probe mark either, see `draft-probe.ts`), otherwise waits
 * for the values in `awaitValues` ({@linkcode awaitDraftValues}) and calls `onSettled` when the form
 * is no longer restoring. A mark the page's probe set is removed at that point too.
 *
 * @returns A cleanup function — stops waiting and forgets what the form's values reported, in
 * both cases.
 */
export function watchDraftRestoring(
  formId: string,
  options: {
    hasServerValues: boolean
    returnedFromFailure?: boolean
    awaitValues?: string[]
  },
  onSettled: () => void,
): () => void {
  if (!startsRestoring(options) && !isDraftProbeMarked(formId)) {
    return () => forgetDraftValues(formId)
  }
  return awaitDraftValues(formId, options.awaitValues ?? [], () => {
    clearDraftProbe(formId)
    onSettled()
  })
}

/**
 * Runs `run` once the form `formId` is no longer restoring a draft: at once when the render
 * restores nothing ({@linkcode startsRestoring} is false and the page's probe set no mark), else
 * when {@linkcode watchDraftRestoring} settles, which happens after every controlled value in
 * `awaitValues` reported or {@linkcode DRAFT_RESTORE_TIMEOUT_MS} passed. For behavior that must
 * not act on a form while its fields are still being rewritten (`attachFocusFirstInvalid`). Calls
 * `run` at most once.
 *
 * @returns A cleanup function — stops waiting; `run` is not called after it.
 */
export function whenDraftRestored(
  formId: string,
  options: {
    hasServerValues: boolean
    returnedFromFailure?: boolean
    awaitValues?: string[]
  },
  run: () => void,
): () => void {
  if (!startsRestoring(options) && !isDraftProbeMarked(formId)) {
    run()
    return () => {}
  }
  return watchDraftRestoring(formId, options, run)
}
