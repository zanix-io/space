/**
 * SSR cost of a component that computes a derived value (`filter` + `reduce`) fresh from props on
 * every render, no manual `useMemo` — the classic React Compiler auto-memoization target — at a
 * fixed, representative size (`TREE_SIZES.medium`), React vs Preact.
 *
 * Still no Compiler column, and this is the scenario where that matters most to spell out
 * explicitly: Compiler's real benefit for a shape like this is skipping the re-computation on a
 * SUBSEQUENT render where `items`/`threshold` haven't changed — a property of a persistent,
 * already-mounted reconciler across multiple renders of the SAME tree. A single, one-shot SSR
 * pass has no "subsequent render" to skip; Compiler's compiled output and the original source
 * produce the identical single computation here, so timing "compiled" vs "uncompiled" SSR would
 * show no real difference regardless — not because Compiler doesn't work, but because this
 * scenario never reaches the code path it optimizes. That path is only reachable with a real,
 * persistent DOM root doing multiple renders — see `benchmarks/browser/`'s own "repeated
 * renders/updates" scenario for where this is actually measured.
 *
 * @module
 */
import { createElement as reactElement } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { createElement as preactElement } from 'preact'
import { render as renderPreact } from 'preact-render-to-string'
import { DerivedValueTree as ReactDerivedValueTree } from './react-components.tsx'
import { DerivedValueTree as PreactDerivedValueTree } from './preact-components.ts'
import { makeItems, TREE_SIZES } from './fixtures.ts'
import { drainReactStream } from './ssr-helpers.ts'

const items = makeItems(TREE_SIZES.medium)
const threshold = 3

Deno.bench(
  `SSR derived-value tree (${TREE_SIZES.medium} items) — react`,
  { group: 'derived-values', baseline: true },
  async () => {
    const stream = await renderToReadableStream(
      reactElement(ReactDerivedValueTree, { items, threshold }),
    )
    await drainReactStream(stream)
  },
)

Deno.bench(
  `SSR derived-value tree (${TREE_SIZES.medium} items) — preact`,
  { group: 'derived-values' },
  () => {
    renderPreact(preactElement(PreactDerivedValueTree, { items, threshold }))
  },
)
