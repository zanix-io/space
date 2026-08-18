/**
 * SSR cost of a fragment-heavy tree (every item contributes its own top-level `<>...</>` instead
 * of a single wrapping element) — isolates fragment-handling cost specifically, at a fixed,
 * representative size (`TREE_SIZES.medium`), React vs Preact. Same non-goal as `tree-sizes.bench.ts`:
 * no Compiler column, for the same reason (SSR-only, Compiler never runs here).
 *
 * @module
 */
import { createElement as reactElement } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { createElement as preactElement } from 'preact'
import { render as renderPreact } from 'preact-render-to-string'
import { FragmentTree as ReactFragmentTree } from './react-components.tsx'
import { FragmentTree as PreactFragmentTree } from './preact-components.ts'
import { makeItems, TREE_SIZES } from './fixtures.ts'
import { drainReactStream } from './ssr-helpers.ts'

const items = makeItems(TREE_SIZES.medium)

Deno.bench(
  `SSR fragment tree (${TREE_SIZES.medium} items) — react`,
  { group: 'fragments', baseline: true },
  async () => {
    const stream = await renderToReadableStream(reactElement(ReactFragmentTree, { items }))
    await drainReactStream(stream)
  },
)

Deno.bench(
  `SSR fragment tree (${TREE_SIZES.medium} items) — preact`,
  { group: 'fragments' },
  () => {
    renderPreact(preactElement(PreactFragmentTree, { items }))
  },
)
