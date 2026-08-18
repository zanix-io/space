'use comet'
import { createElement as h } from 'react'
import { useState } from 'react'
import type { ComponentType } from 'react'
import { defineComet } from 'modules/comets/define-comet.ts'

/**
 * The two stateful comets the persistence spike navigates away from and back to. Identical
 * components; the ONLY difference is whether the page passes `persist` at the call site, which is
 * exactly the variable under test.
 *
 * Named exports are mandatory (`defineComet` reads `Component.name` for the client to import back
 * out of this module) — the same contract every comet file follows.
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

export default defineComet(PersistCounter as ComponentType<Record<string, never>>, import.meta.url)
export const PlainComet = defineComet(
  PlainCounter as ComponentType<Record<string, never>>,
  import.meta.url,
)
