'use comet'
import { useEffect } from 'preact/hooks'
import { defineComet } from './define-comet.ts'
import { attachUnsavedChangesGuard } from './unsaved-changes-guard.ts'
import type { UnsavedChangesGuardOptions } from './unsaved-changes-guard.ts'
import type { CometBoundaryComponent, CometProps } from 'typings/comet.ts'

/**
 * Identical to `@zanix/space/comet/react`'s `UnsavedChangesGuard`, wiring the same hook-free
 * {@linkcode attachUnsavedChangesGuard} into `preact/hooks`' own `useEffect` instead — see that
 * module's own doc for the full contract.
 */
export function UnsavedChangesGuard(props: UnsavedChangesGuardOptions): null {
  useEffect(() => attachUnsavedChangesGuard(props), [props.formId, props.excludeFields])
  return null
}

/**
 * {@linkcode UnsavedChangesGuard}, wrapped as a real Comet boundary — import this directly:
 * `import { UnsavedChangesGuard } from '@zanix/space/comet/preact'` (a NAMED import — see
 * `mod-react.ts`'s own module doc for why this subpath has no single default). See
 * `form-draft-persistence-react.tsx`'s own comment on this same `as` clause — identical
 * no-slow-types reasoning, not a Preact-specific concern.
 */
export default defineComet(UnsavedChangesGuard, import.meta.url) as CometBoundaryComponent<
  UnsavedChangesGuardOptions & CometProps
>
