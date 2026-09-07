import { createContext, createElement } from 'preact'
import type { ComponentChildren } from 'preact'
import { useContext, useId, useMemo, useRef } from 'preact/hooks'

/** Preact counterpart to `comet-id-scope-react.tsx`'s own `CometIdScopeContext` — identical
 * shape, same reasoning, see that file's own doc for the full "why". */
const CometIdScopeContext = createContext<
  { scope: string; counter: { current: number } } | undefined
>(undefined)

/**
 * Preact counterpart to `comet-id-scope-react.tsx`'s own `CometIdScopeProvider`.
 *
 * Built with `createElement`, never JSX — same reason `define-comet.ts` itself avoids JSX: this
 * package's `jsxImportSource` is fixed to `'react'` at the `deno.jsonc` level, so JSX written in
 * this file would compile to React-shaped elements regardless of which renderer an app actually
 * runs, and `preact-render-to-string` silently discards a React-shaped element.
 */
export function CometIdScopeProvider(
  { value, children }: { value: string; children?: ComponentChildren },
): ComponentChildren {
  const counterRef = useRef(0)
  const contextValue = useMemo(() => ({ scope: value, counter: counterRef }), [value])
  return createElement(CometIdScopeContext.Provider, { value: contextValue }, children)
}

/**
 * Preact counterpart to `comet-id-scope-react.tsx`'s own `useCometStableId` — identical contract
 * (a drop-in replacement for `preact/hooks`' own `useId()` that stays correct inside a ready-made
 * Comet's own isolated hydration root), see that file's own doc for the full "why".
 *
 * @example
 * ```tsx
 * import { useCometStableId } from '@zanix/space/comet/preact'
 * ```
 */
export function useCometStableId(): string {
  const scope = useContext(CometIdScopeContext)
  const reactId = useId()
  const idRef = useRef<string>()
  if (!scope) return reactId
  if (idRef.current === undefined) {
    idRef.current = `${scope.scope}-${scope.counter.current++}`
  }
  return idRef.current
}
