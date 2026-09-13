import { useEffect, useRef } from 'preact/hooks'
import { attachSubmitIntercept } from './submit-intercept.ts'
import type { SubmitInterceptOptions } from './submit-intercept.ts'

/**
 * Identical to `@zanix/space/comet/react`'s `useSubmitIntercept`, wiring the same hook-free
 * {@linkcode attachSubmitIntercept} into `preact/hooks`' own `useEffect` instead — see that
 * module's own doc for the full contract, including why this is a plain hook rather than a
 * `defineComet`-wrapped boundary like `SubmitGuard`/`ManagedForm`.
 */
export function useSubmitIntercept(options: SubmitInterceptOptions): void {
  const interceptRef = useRef(options.intercept)
  interceptRef.current = options.intercept

  const { formId } = options
  useEffect(
    () => attachSubmitIntercept({ formId, intercept: (form) => interceptRef.current(form) }),
    [formId],
  )
}
