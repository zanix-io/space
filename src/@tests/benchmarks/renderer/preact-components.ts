import { createElement, Fragment } from 'preact'
import { useState } from 'preact/hooks'
import type { VNode } from 'preact'
import type { Item } from './fixtures.ts'

// `createElement` calls, not JSX — same convention this package's own Preact source/tests already
// use (e.g. `render-to-response-preact.test.ts`), since the project's default `jsxImportSource` is
// `react` and Preact source stays out of that ambiguity entirely rather than fighting it with a
// per-file pragma. Every function below renders the exact same DOM shape as its React counterpart
// in `react-components.tsx`, over the exact same `Item[]` data — verified by construction, not
// just by eye: both are consumed by the same `Item`/`makeItems` fixture.

/** React counterpart: `StaticTree`. */
export function StaticTree({ items }: { items: Item[] }): VNode {
  return createElement(
    'ul',
    null,
    items.map((item) =>
      createElement(
        'li',
        { key: item.id },
        createElement('span', null, item.label),
        createElement('span', null, item.score),
      )
    ),
  )
}

/** React counterpart: `FragmentTree`. */
export function FragmentTree({ items }: { items: Item[] }): VNode {
  return createElement(
    Fragment,
    null,
    items.map((item) =>
      createElement(
        Fragment,
        { key: item.id },
        createElement('p', null, item.label),
        createElement('p', null, item.score),
      )
    ),
  )
}

/** React counterpart: `DerivedValueTree`. Same "no Compiler effect on SSR" note applies — Preact
 * has no compiler of its own at all, so this scenario's only real purpose here is the React
 * comparison, not a Preact-side compiler question. */
export function DerivedValueTree(
  { items, threshold }: { items: Item[]; threshold: number },
): VNode {
  const visible = items.filter((item) => item.score >= threshold)
  const total = visible.reduce((sum, item) => sum + item.score, 0)
  return createElement(
    'div',
    null,
    createElement('p', null, total),
    createElement(
      'ul',
      null,
      visible.map((item) => createElement('li', { key: item.id }, item.label)),
    ),
  )
}

/** React counterpart: `InteractiveTree`. Same caveat: SSR only renders the `useState(0)` initial
 * branch — Preact's own reconciler update path is never exercised here either. */
export function InteractiveTree({ items }: { items: Item[] }): VNode {
  const [count] = useState(0)
  const visible = items.filter((item) => item.score > count)
  return createElement(
    Fragment,
    null,
    createElement('p', { 'data-testid': 'count' }, count),
    createElement(
      'ul',
      null,
      visible.map((item) => createElement('li', { key: item.id }, item.label)),
    ),
    createElement('button', { type: 'button' }, 'increment'),
  )
}
