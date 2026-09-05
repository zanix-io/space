/**
 * Warns before leaving a page with an unsaved `<form>` — the browser's own native "leave site?"
 * prompt, triggered by `beforeunload`, only once the form has actually changed since it was last
 * submitted (or since attach). Hook-free and renderer-agnostic (zero React/Preact import), same
 * shape as `form-draft-persistence.ts`'s own core primitive — the two compose naturally on the
 * SAME form (one prevents losing the typed data locally, the other warns before the tab/window
 * closes with it still unsaved), but neither depends on the other.
 *
 * **Known real gap, not covered here**: this only ever intercepts a real full-page unload (a tab
 * close, a browser back/forward, typing a new URL) — Orbit (`@zanix/space/client`'s `initOrbit()`)
 * intercepts same-origin `<a>` clicks itself, client-side, with no exposed "confirm before
 * navigating" hook of its own (`orbit.ts`'s own public surface is `shouldInterceptNavigation`/
 * `navigate`/`initOrbit`, none of which accept a guard callback) — so clicking an in-app link away
 * from a dirty form navigates immediately, unprompted. Closing that gap is Orbit's own job, not
 * this primitive's; it isn't silently pretended to be solved here.
 *
 * @module
 */

/** Options for {@linkcode attachUnsavedChangesGuard}. */
export type UnsavedChangesGuardOptions = {
  /** The real `id` of the `<form>` to guard. */
  formId: string
  /** Field `name`s whose own `input`/`change` never marks the form dirty — for something inside
   * the same form that isn't really "content to save" (a live-search/filter box, say). Omit when
   * every field should count. */
  excludeFields?: string[]
}

/**
 * Attaches an unsaved-changes warning to one `<form>` — the primitive a `useEffect` (React/Preact,
 * see `@zanix/space/comet/react` and `@zanix/space/comet/preact`) calls into. Marks the form dirty
 * on any `input`/`change` (except an excluded field), clears it on `submit`; while dirty, a real
 * page unload (tab close, back/forward, a typed URL) triggers the browser's own native confirm
 * prompt via `beforeunload` — no custom message: every modern browser ignores
 * `event.returnValue`/a custom string and shows its own fixed wording regardless, so none is
 * offered here to configure.
 *
 * @returns A cleanup function — detaches every listener this call attached.
 * `useEffect(() => attachUnsavedChangesGuard(options), deps)`.
 */
export function attachUnsavedChangesGuard(options: UnsavedChangesGuardOptions): () => void {
  const { formId, excludeFields = [] } = options
  const form = globalThis.document?.getElementById(formId)
  if (!(form instanceof HTMLFormElement)) return () => {}

  let dirty = false
  const markDirty = (event: Event) => {
    const name = (event.target as { name?: unknown } | null)?.name
    if (typeof name === 'string' && excludeFields.includes(name)) return
    dirty = true
  }
  const clearDirty = () => {
    dirty = false
  }
  const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!dirty) return
    event.preventDefault()
    // Legacy requirement, still honored by some engines: a non-empty `returnValue` is what used
    // to surface a custom message, before every major browser standardized on a fixed one.
    event.returnValue = ''
  }

  form.addEventListener('input', markDirty)
  form.addEventListener('change', markDirty)
  form.addEventListener('submit', clearDirty)
  globalThis.addEventListener('beforeunload', handleBeforeUnload)

  return () => {
    form.removeEventListener('input', markDirty)
    form.removeEventListener('change', markDirty)
    form.removeEventListener('submit', clearDirty)
    globalThis.removeEventListener('beforeunload', handleBeforeUnload)
  }
}
