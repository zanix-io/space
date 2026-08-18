'use comet'
import { useEffect, useState } from 'react'
import type { ComponentType } from 'react'
import { defineComet } from 'modules/comets/define-comet.ts'

/**
 * The shape React Compiler is actually for: a parent whose state changes many times, an expensive
 * derived value computed from it, and several children whose own props never change across those
 * updates. Hand-written `useMemo`/`memo` are deliberately absent — they are exactly what the
 * Compiler exists to make unnecessary, and including them would measure the author instead.
 *
 * Two methodological details this file learned the hard way, both of which silently produced a
 * "no difference" result before being fixed:
 *
 * 1. **Components are written in real JSX, not `createElement` calls.** React Compiler identifies
 *    components partly by their returning JSX; a component body built from `h(...)` may not be
 *    recognised as a component at all, in which case nothing is compiled and the benchmark
 *    measures only the compiler runtime's own cost.
 * 2. **Render counting happens in an effect, never in the component body.** Mutating anything
 *    during render makes a component impure, and the Compiler refuses to memoize what it cannot
 *    prove pure — so body-level instrumentation defeats the very optimization under test. A
 *    component the Compiler successfully skips never commits, so its effect never fires, which is
 *    what makes the count meaningful.
 *
 * @module
 */

/** Counts commits, from an effect — see this module's own doc for why never from the body. */
function useRenderCount(name: string): void {
  useEffect(() => {
    const g = globalThis as unknown as { __renders?: Record<string, number> }
    g.__renders ??= {}
    g.__renders[name] = (g.__renders[name] ?? 0) + 1
  })
}

/** Stable child: its props never change while the parent's counter does, and its body is
 * deliberately expensive, so memoizing it away is observable as latency and not only as a count. */
function StableChild({ label }: { label: string }) {
  useRenderCount(`stable:${label}`)
  let acc = 0
  for (let i = 0; i < 400_000; i++) acc += (i * label.length) % 7
  return <span data-testid={`stable-${label}`}>{`${label}:${acc}`}</span>
}

/** A second stable child with the same contract — two of them make a one-off result less likely to
 * be mistaken for a pattern. */
function OtherStableChild({ label }: { label: string }) {
  useRenderCount(`other:${label}`)
  let acc = 0
  for (let i = 0; i < 400_000; i++) acc += (i + label.length) % 5
  return <span data-testid={`other-${label}`}>{`${label}:${acc}`}</span>
}

/** Child that genuinely depends on the changing state — it SHOULD re-render every time, and its
 * count staying at the click count is the control proving the tree really did update. */
function InteractiveChild({ value }: { value: number }) {
  useRenderCount('interactive')
  return <span data-testid='interactive'>{`v:${value}`}</span>
}

export function UpdateTree() {
  const [n, setN] = useState(0)
  useRenderCount('parent')

  // Expensive derived value, deliberately un-memoized by hand.
  let derived = 0
  for (let i = 0; i < 200_000; i++) derived += (i * (n + 1)) % 13

  return (
    <div data-testid='tree'>
      <button type='button' data-testid='bump' onClick={() => setN((v) => v + 1)}>
        {`bump:${n}`}
      </button>
      <output data-testid='derived'>{String(derived % 1000)}</output>
      <StableChild label='alpha' />
      <StableChild label='beta' />
      <OtherStableChild label='gamma' />
      <OtherStableChild label='delta' />
      <InteractiveChild value={n} />
    </div>
  )
}

export default defineComet(UpdateTree as ComponentType<Record<string, never>>, import.meta.url)
