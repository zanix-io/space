'use comet'
import { useEffect } from 'react'
import { defineComet } from './define-comet.ts'
import { attachUnsavedChangesGuard } from './unsaved-changes-guard.ts'
import type { UnsavedChangesGuardOptions } from './unsaved-changes-guard.ts'
import type { CometBoundaryComponent, CometProps } from 'typings/comet.ts'

/**
 * Ready-made Comet wiring {@linkcode attachUnsavedChangesGuard} into React's own `useEffect` — the
 * default a consumer app reaches for to warn before a page unload discards unsaved `<form>` input.
 * Renders nothing; every `UnsavedChangesGuardOptions` field is a plain JSON-serializable value, so
 * it crosses the Comet boundary as ordinary props like any other.
 *
 * ```tsx
 * import { UnsavedChangesGuard } from '@zanix/space/comet/react'
 *
 * <form id="new-trigger" method="post">{/* ... *\/}</form>
 * <UnsavedChangesGuard formId="new-trigger" />
 * ```
 */
export function UnsavedChangesGuard(props: UnsavedChangesGuardOptions): null {
  useEffect(() => attachUnsavedChangesGuard(props), [props.formId, props.excludeFields])
  return null
}

/**
 * {@linkcode UnsavedChangesGuard}, wrapped as a real Comet boundary — import this directly:
 * `import { UnsavedChangesGuard } from '@zanix/space/comet/react'` (a NAMED import — see
 * `mod-react.ts`'s own module doc for why this subpath has no single default). See
 * `form-draft-persistence-react.tsx`'s own comment on this same `as` clause — identical
 * no-slow-types reasoning.
 */
export default defineComet(UnsavedChangesGuard, import.meta.url) as CometBoundaryComponent<
  UnsavedChangesGuardOptions & CometProps
>
