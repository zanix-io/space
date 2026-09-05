'use comet'
import { useEffect } from 'preact/hooks'
import { defineComet } from './define-comet.ts'
import { attachManagedForm } from './managed-form.ts'
import type { ManagedFormOptions } from './managed-form.ts'
import type { CometBoundaryComponent, CometProps } from 'typings/comet.ts'

/**
 * Identical to `@zanix/space/comet/react`'s `ManagedForm`, wiring the same hook-free
 * {@linkcode attachManagedForm} into `preact/hooks`' own `useEffect` instead — see that module's
 * own doc for the full contract.
 */
export function ManagedForm(props: ManagedFormOptions): null {
  useEffect(() => attachManagedForm(props), [
    props.formId,
    props.draft,
    props.submitGuard,
    props.unsavedChanges,
  ])
  return null
}

/**
 * {@linkcode ManagedForm}, wrapped as a real Comet boundary — import this directly:
 * `import { ManagedForm } from '@zanix/space/comet/preact'` (a NAMED import — see
 * `mod-react.ts`'s own module doc for why this subpath has no single default). See
 * `form-draft-persistence-react.tsx`'s own comment on this same `as` clause — identical
 * no-slow-types reasoning, not a Preact-specific concern.
 */
export default defineComet(ManagedForm, import.meta.url) as CometBoundaryComponent<
  ManagedFormOptions & CometProps
>
