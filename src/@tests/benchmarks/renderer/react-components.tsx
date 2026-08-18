import { Fragment, useState } from 'react'
import type { Item } from './fixtures.ts'

/** Plain, static list — no hooks, no derived computation. The size-scaling baseline every other
 * scenario in this directory is compared against. */
export function StaticTree({ items }: { items: Item[] }) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>
          <span>{item.label}</span>
          <span>{item.score}</span>
        </li>
      ))}
    </ul>
  )
}

/** Same data as `StaticTree`, restructured so every item contributes its own top-level Fragment
 * instead of a single `<li>` — isolates fragment-handling cost specifically, at the same item
 * count. Uses the explicit `<Fragment key={...}>` form, not the `<>...</>` shorthand — React's own
 * shorthand syntax doesn't accept a `key` prop at all (confirmed the hard way: the shorthand form
 * here originally produced a real "Each child in a list should have a unique key prop" warning on
 * every single bench iteration, since the key silently had nowhere to attach). */
export function FragmentTree({ items }: { items: Item[] }) {
  return (
    <>
      {items.map((item) => (
        <Fragment key={item.id}>
          <p>{item.label}</p>
          <p>{item.score}</p>
        </Fragment>
      ))}
    </>
  )
}

/**
 * A `filter` + `reduce` computed fresh from props on every render, no manual `useMemo` — the
 * classic React Compiler auto-memoization target. Measured here as a pure SSR cost ONLY: React
 * Compiler is a client-bundle build-time transform (confirmed by
 * `react-compiler-ssr-unaffected.test.tsx`, this package's own regression test) and never runs
 * against this SSR path at all, so this scenario cannot show a Compiler effect — see this
 * directory's own bench file for where that's documented against the actual measured numbers,
 * not just asserted here.
 */
export function DerivedValueTree({ items, threshold }: { items: Item[]; threshold: number }) {
  const visible = items.filter((item) => item.score >= threshold)
  const total = visible.reduce((sum, item) => sum + item.score, 0)
  return (
    <div>
      <p>{total}</p>
      <ul>
        {visible.map((item) => <li key={item.id}>{item.label}</li>)}
      </ul>
    </div>
  )
}

/**
 * Same shape as `react-compiler.test.ts`'s own `REACT_COMET_SOURCE` fixture (`useState` + a
 * derived value computed from it + an inline event handler + a top-level Fragment) — real
 * Comet-shaped, Compiler-sensitive source, kept in sync with that file's own shape on purpose. SSR
 * only ever renders the `useState(0)` INITIAL branch; nothing here exercises the reconciler's
 * update path (`onClick` never fires during a `renderToReadableStream` pass) — that needs a real
 * DOM, see the browser benchmark suite for the scenario that actually measures update cost.
 */
export function InteractiveTree({ items }: { items: Item[] }) {
  const [count] = useState(0)
  const visible = items.filter((item) => item.score > count)
  return (
    <>
      <p data-testid='count'>{count}</p>
      <ul>
        {visible.map((item) => <li key={item.id}>{item.label}</li>)}
      </ul>
      <button type='button'>increment</button>
    </>
  )
}
