'use comet'
import { createElement as h } from 'preact'
import { useState } from 'preact/hooks'
import type { ComponentType as ReactComponentType } from 'react'
import { defineComet } from 'modules/comets/define-comet.ts'

/**
 * Preact twin of `comets.tsx` — same two counters, same `data-testid`s, same markup, so the spike
 * asserts identical things against both renderers.
 *
 * The `as unknown as ReactComponentType` casts are the standing Comet API limitation, not
 * something specific to this file: `defineComet` declares its parameter as React's `ComponentType`
 * regardless of the active renderer, so every Preact comet in this repo casts at the boundary.
 *
 * @module
 */

/** Counter whose call site opts into Orbit retention via `persist`. */
export function PersistCounter({ when }: { when?: unknown }) {
  const [count, setCount] = useState(0)
  // `date:` is only reachable when `when` arrived as a REAL Date — which, across the wire, only
  // happens when the extended-types codec is enabled AND decoded at this boundary. It is the
  // discriminator that makes this spike cover `reuseRetainedComets`, the third and easiest-missed
  // read site for `data-comet-props`.
  const kind = when instanceof Date ? `date:${when.getUTCFullYear()}` : `raw:${typeof when}`
  return h('button', {
    type: 'button',
    'data-testid': 'persist-counter',
    onClick: () => setCount((c: number) => c + 1),
  }, `persist:${count}|${kind}`)
}

/** Identical counter whose call site does NOT pass `persist` — the control. */
export function PlainCounter() {
  const [count, setCount] = useState(0)
  return h('button', {
    type: 'button',
    'data-testid': 'plain-counter',
    onClick: () => setCount((c: number) => c + 1),
  }, `plain:${count}`)
}

export default defineComet(
  PersistCounter as unknown as ReactComponentType<Record<string, never>>,
  import.meta.url,
)
export const PlainComet = defineComet(
  PlainCounter as unknown as ReactComponentType<Record<string, never>>,
  import.meta.url,
)
