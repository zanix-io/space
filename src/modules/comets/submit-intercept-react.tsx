import { useEffect, useRef } from 'react'
import { attachSubmitIntercept } from './submit-intercept.ts'
import type { SubmitInterceptOptions } from './submit-intercept.ts'

/**
 * Wires {@linkcode attachSubmitIntercept} into React's own `useEffect` — a plain hook, NOT a
 * `defineComet`-wrapped boundary the way `SubmitGuard`/`ManagedForm` are (`submit-guard-react.tsx`/
 * `managed-form-react.tsx`, this same subpath). `intercept` is a real function/closure, and a
 * Comet's own props must cross the server/client boundary as plain JSON (`define-comet.ts`'s own
 * `stringifyForWire` call) — there is no way to hand a rendered Comet boundary a callback prop at
 * all (the same reason `NetworkStatus` writes a DOM attribute instead of accepting one). Call this
 * from WITHIN your own `'use comet'` file's component body instead — the same pattern
 * `useCometStableId` (`comet-id-scope-react.tsx`) already establishes for a hook that needs a
 * specific renderer's own runtime but isn't itself a hydration boundary.
 *
 * `intercept` itself is read through a ref, not a `useEffect` dependency — a fresh closure passed
 * on every render (the common case: `intercept` usually closes over the component's own props/
 * state) would otherwise reattach the listener every render for no reason; the effect itself only
 * re-runs when `formId` changes.
 *
 * ```tsx
 * // login-two-step.comet.tsx
 * 'use comet'
 * import { defineComet } from '@zanix/space/comet'
 * import { useSubmitIntercept } from '@zanix/space/comet/react'
 *
 * function LoginTwoStep({ formId }: { formId: string }) {
 *   useSubmitIntercept({
 *     formId,
 *     intercept: async (form) => {
 *       const hasPassword = await checkHasPassword(form)
 *       if (hasPassword) {
 *         revealPasswordStep()
 *         return 'handled'
 *       }
 *       return 'proceed'
 *     },
 *   })
 *   return null
 * }
 * export default defineComet(LoginTwoStep, import.meta.url)
 * ```
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
