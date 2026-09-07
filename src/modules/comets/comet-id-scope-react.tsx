import { createContext, useContext, useId, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'

/**
 * Carries one Comet instance's own stable-id scope down to its real content — `scope` (this
 * instance's own deterministic identity, computed by `define-comet.ts`) plus a `counter` SHARED by
 * every `useCometStableId()` call within this same instance, so sibling calls (e.g. `Menu`'s own
 * per-item ids, nested inside `NavDrawer`) get distinct, sequential values instead of colliding on
 * the same one. `undefined` outside any Comet boundary — the default, and the signal
 * `useCometStableId` reads to fall back to React's own `useId()` unchanged.
 */
const CometIdScopeContext = createContext<
  { scope: string; counter: { current: number } } | undefined
>(undefined)

/**
 * Wraps a Comet's real content with its own stable-id scope — `define-comet.ts`'s own
 * `CometBoundary` renders this around `Component`, given `value` derived from that instance's own
 * serialized props (deterministic on both the server render and the client's isolated hydration —
 * see that file's own doc for the exact derivation).
 */
export function CometIdScopeProvider(
  { value, children }: { value: string; children?: ReactNode },
): ReactNode {
  const counterRef = useRef(0)
  // Keyed on `value` alone: a real Comet instance's own scope id never changes across a
  // `persist`/reuse re-render (it's derived from the source + the instance's OWN identity, not
  // from whatever fresh props a reuse call passes), so this stays the SAME object for this
  // instance's whole lifetime — sharing one `counter` across every re-render, exactly like a real
  // React root's own internal `useId()` counter would.
  const contextValue = useMemo(() => ({ scope: value, counter: counterRef }), [value])
  return (
    <CometIdScopeContext.Provider value={contextValue}>
      {children}
    </CometIdScopeContext.Provider>
  )
}

/**
 * A drop-in replacement for React's own `useId()` that stays correct inside a ready-made Comet's
 * own isolated hydration root.
 *
 * `useId()`'s own guarantee — the same value on the server render and the client hydration — only
 * holds WITHIN one hydration root, counting from wherever that root's own render starts. A
 * ready-made Comet hydrates as its own, separate `hydrateRoot()` call, isolated from the rest of
 * the page — so the server's whole-document render assigns it whatever `useId()` ordinal it
 * happens to land on among EVERY call on the page, while the client's isolated hydration starts
 * that same counter fresh at zero for just this one boundary. The two can never coincide by
 * construction: a real, reproduced hydration mismatch (`NavDrawer`'s own `aria-controls`,
 * `@zanix/space-ui`).
 *
 * Outside any Comet boundary — the overwhelmingly common case, every component in a normal page
 * tree — this is a plain, zero-overhead passthrough to React's own `useId()`, unchanged.
 *
 * @example
 * ```tsx
 * import { useCometStableId } from '@zanix/space/comet/react'
 *
 * function Accordion({ label }: { label: string }) {
 *   const panelId = useCometStableId()
 *   return <>
 *     <button aria-controls={panelId}>{label}</button>
 *     <div id={panelId}>...</div>
 *   </>
 * }
 * ```
 */
export function useCometStableId(): string {
  const scope = useContext(CometIdScopeContext)
  const reactId = useId()
  // Always called, unconditionally — the Rules of Hooks forbid calling `useId()` only on the
  // "outside a Comet" branch, and it costs nothing real when discarded below.
  const idRef = useRef<string>(undefined)
  if (!scope) return reactId
  if (idRef.current === undefined) {
    idRef.current = `${scope.scope}-${scope.counter.current++}`
  }
  return idRef.current
}
