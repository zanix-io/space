'use comet'
import { useEffect } from 'preact/hooks'
import { defineComet } from './define-comet.ts'
import { attachSubmitGuard } from './submit-guard.ts'
import type { SubmitGuardOptions } from './submit-guard.ts'
import type { CometBoundaryComponent, CometProps } from 'typings/comet.ts'

/**
 * Identical to `@zanix/space/comet/react`'s `SubmitGuard`, wiring the same hook-free
 * {@linkcode attachSubmitGuard} into `preact/hooks`' own `useEffect` instead — see that module's
 * own doc for the full contract.
 */
export function SubmitGuard(props: SubmitGuardOptions): null {
  useEffect(() => attachSubmitGuard(props), [props.formId, props.disableControls])
  return null
}

/**
 * {@linkcode SubmitGuard}, wrapped as a real Comet boundary — import this directly:
 * `import { SubmitGuard } from '@zanix/space/comet/preact'` (a NAMED import — see
 * `mod-react.ts`'s own module doc for why this subpath has no single default). See
 * `form-draft-persistence-react.tsx`'s own comment on this same `as` clause — identical
 * no-slow-types reasoning, not a Preact-specific concern.
 */
export default defineComet(SubmitGuard, import.meta.url) as CometBoundaryComponent<
  SubmitGuardOptions & CometProps
>
