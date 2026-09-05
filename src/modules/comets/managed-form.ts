import { attachFormDraftPersistence } from './form-draft-persistence.ts'
import type { FormDraftPersistenceOptions } from './form-draft-persistence.ts'
import { attachSubmitGuard } from './submit-guard.ts'
import type { SubmitGuardOptions } from './submit-guard.ts'
import { attachUnsavedChangesGuard } from './unsaved-changes-guard.ts'
import type { UnsavedChangesGuardOptions } from './unsaved-changes-guard.ts'

/**
 * Composes {@linkcode attachFormDraftPersistence}/{@linkcode attachSubmitGuard}/
 * {@linkcode attachUnsavedChangesGuard} under one `formId`, so a page author enabling more than one
 * doesn't repeat it across separate calls (or separate ready-made Comets, one per behavior). Does
 * NOT render a `<form>` itself, same reason none of the three primitives it composes do: a Comet's
 * own props must be plain JSON (see `define-comet.ts`'s own doc), so a component that also needs to
 * accept arbitrary field markup as `children` — closures, event handlers, none of it
 * JSON-serializable — can't be one hydratable boundary. The `<form>` and its fields stay ordinary,
 * server-rendered markup; this only ever attaches BEHAVIOR to it by `id`, exactly like each
 * individual primitive already does.
 *
 * Attaching more than one behavior to the SAME `submit`/`input`/`change` event is safe by
 * construction: each primitive adds its own, independent `addEventListener` call — native DOM
 * listeners never overwrite each other, and one calling `event.preventDefault()` (`SubmitGuard`,
 * rejecting a second submission) doesn't stop the others from also running.
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
   * `formId`) to customize, or omit/`false` to leave double-submit prevention disabled. */
  submitGuard?: boolean | Omit<SubmitGuardOptions, 'formId'>
  /** Enables {@linkcode attachUnsavedChangesGuard} — `true` for its own defaults, an options
   * object (minus `formId`) to customize, or omit/`false` to leave the unload warning disabled. */
  unsavedChanges?: boolean | Omit<UnsavedChangesGuardOptions, 'formId'>
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
  const { formId, draft, submitGuard, unsavedChanges } = options
  const cleanups: Array<() => void> = []

  if (draft) cleanups.push(attachFormDraftPersistence({ formId, ...draft }))
  if (submitGuard) {
    cleanups.push(attachSubmitGuard({ formId, ...(submitGuard === true ? {} : submitGuard) }))
  }
  if (unsavedChanges) {
    cleanups.push(
      attachUnsavedChangesGuard({ formId, ...(unsavedChanges === true ? {} : unsavedChanges) }),
    )
  }

  return () => {
    for (const cleanup of cleanups.toReversed()) cleanup()
  }
}
