/**
 * SSR cost of a real Comet-shaped tree — `useState` + a derived value computed from it + an
 * inline event handler + a top-level Fragment, the exact same shape as
 * `react-compiler.test.ts`'s own `REACT_COMET_SOURCE`/`PREACT_COMET_SOURCE` fixtures (kept in
 * sync with those on purpose) — at a fixed, representative size (`TREE_SIZES.medium`), React vs
 * Preact.
 *
 * "Renderer-level work isolated" here means exactly one thing: the cost of producing this
 * component's INITIAL HTML. `useState(0)`'s setter is never called during an SSR pass — no click
 * event exists to fire it — so this measures the same single render pass as every other file in
 * this directory, just on Comet-realistic source instead of a synthetic tree. It does NOT measure
 * interaction cost, re-render cost, or anything Compiler's memoization could skip on a later
 * render — see `benchmarks/browser/` for the scenario that actually clicks the button.
 *
 * @module
 */
import { createElement as reactElement } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { createElement as preactElement } from 'preact'
import { render as renderPreact } from 'preact-render-to-string'
import { InteractiveTree as ReactInteractiveTree } from './react-components.tsx'
import { InteractiveTree as PreactInteractiveTree } from './preact-components.ts'
import { makeItems, TREE_SIZES } from './fixtures.ts'
import { drainReactStream } from './ssr-helpers.ts'

const items = makeItems(TREE_SIZES.medium)

Deno.bench(
  `SSR interactive (Comet-shaped) tree (${TREE_SIZES.medium} items) — react`,
  { group: 'interactive-tree', baseline: true },
  async () => {
    // MUST be a real React element passed into `renderToReadableStream`, never
    // `ReactInteractiveTree({ items })` called directly — a direct call runs the function outside
    // React's own render loop, so `useState` finds no active hook dispatcher and throws "Invalid
    // hook call" (confirmed the hard way — this bench crashed until fixed). `createElement` is
    // what makes React itself invoke the function, with a real dispatcher in place, same as JSX
    // (`<ReactInteractiveTree items={items} />`) compiles to.
    const stream = await renderToReadableStream(reactElement(ReactInteractiveTree, { items }))
    await drainReactStream(stream)
  },
)

Deno.bench(
  `SSR interactive (Comet-shaped) tree (${TREE_SIZES.medium} items) — preact`,
  { group: 'interactive-tree' },
  () => {
    // Same reasoning as the react case above — Preact's own `useState` needs a real, currently
    // rendering component instance to attach hook state to, which only exists when Preact itself
    // calls the function (via a real vnode), not when this file calls it directly.
    renderPreact(preactElement(PreactInteractiveTree, { items }))
  },
)
