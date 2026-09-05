'use comet'
import { useEffect } from 'react'
import { defineComet } from './define-comet.ts'
import { attachSubmitGuard } from './submit-guard.ts'
import type { SubmitGuardOptions } from './submit-guard.ts'
import type { CometBoundaryComponent, CometProps } from 'typings/comet.ts'

/**
 * Ready-made Comet wiring {@linkcode attachSubmitGuard} into React's own `useEffect` — the default
 * a consumer app reaches for to stop a double `<form>` submission. Renders nothing; every
 * `SubmitGuardOptions` field is a plain JSON-serializable value, so it crosses the Comet boundary
 * as ordinary props like any other.
 *
 * ```tsx
 * import { SubmitGuard } from '@zanix/space/comet/react'
 *
 * <form id="checkout" method="post">{/* ... *\/}</form>
 * <SubmitGuard formId="checkout" />
 * ```
 */
export function SubmitGuard(props: SubmitGuardOptions): null {
  useEffect(() => attachSubmitGuard(props), [props.formId, props.disableControls])
  return null
}

/**
 * {@linkcode SubmitGuard}, wrapped as a real Comet boundary — import this directly:
 * `import { SubmitGuard } from '@zanix/space/comet/react'` (a NAMED import — see
 * `mod-react.ts`'s own module doc for why this subpath has no single default). See
 * `form-draft-persistence-react.tsx`'s own comment on this same `as` clause — identical
 * no-slow-types reasoning.
 */
export default defineComet(SubmitGuard, import.meta.url) as CometBoundaryComponent<
  SubmitGuardOptions & CometProps
>
