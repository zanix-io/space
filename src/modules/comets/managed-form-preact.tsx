'use comet'
import { useEffect } from 'preact/hooks'
import { defineComet } from './define-comet.ts'
import { attachManagedForm } from './managed-form.ts'
import type { ManagedFormOptions } from './managed-form.ts'
import type { CometBoundaryComponent, CometProps } from 'typings/comet.ts'

/** `ManagedFormOptions` minus `intercept` — see `managed-form-react.tsx`'s own `ManagedForm` doc
 * for why: `intercept` is a real function, never JSON-serializable, so this Comet boundary's own
 * props can never carry it. */
export type ManagedFormComponentProps = Omit<ManagedFormOptions, 'intercept'>

/**
 * Identical to `@zanix/space/comet/react`'s `ManagedForm`, wiring the same hook-free
 * {@linkcode attachManagedForm} into `preact/hooks`' own `useEffect` instead — see that module's
 * own doc for the full contract, including why `intercept` is excluded from this component's props.
 */
export function ManagedForm(props: ManagedFormComponentProps): null {
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
  ManagedFormComponentProps & CometProps
>
