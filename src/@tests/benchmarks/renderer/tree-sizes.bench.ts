/**
 * SSR cost of a plain, static tree at three sizes (small=10, medium=100, large=1000 items) —
 * React (`renderToReadableStream`, fully drained) vs Preact (`preact-render-to-string`'s
 * synchronous `render()`). Same `Item[]` data, same DOM shape, for both — see
 * `react-components.tsx`/`preact-components.ts`'s own doc.
 *
 * No React Compiler column here: `StaticTree` has no derived computation for Compiler to optimize
 * even in principle, and Compiler is a client-bundle build-time transform that never runs against
 * this SSR path at all (confirmed by `react-compiler-ssr-unaffected.test.tsx`, this package's own
 * regression test) — a "compiled" condition here would just be the exact same uncompiled source
 * measured twice under a different label. See `../../../../CHANGELOG.md`'s own P3-4 entry for the
 * full architectural reasoning; the browser suite (`benchmarks/browser/`) is where a real Compiler
 * effect is actually measurable, on the client update path this SSR-only file never touches.
 *
 * @module
 */
import { createElement as reactElement } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { createElement as preactElement } from 'preact'
import { render as renderPreact } from 'preact-render-to-string'
import { StaticTree as ReactStaticTree } from './react-components.tsx'
import { StaticTree as PreactStaticTree } from './preact-components.ts'
import { makeItems, TREE_SIZES } from './fixtures.ts'
import { drainReactStream } from './ssr-helpers.ts'

for (const [label, size] of Object.entries(TREE_SIZES)) {
  const items = makeItems(size)

  Deno.bench(
    `SSR static tree (${label}, ${size} items) — react`,
    { group: label, baseline: true },
    async () => {
      const stream = await renderToReadableStream(reactElement(ReactStaticTree, { items }))
      await drainReactStream(stream)
    },
  )

  Deno.bench(
    `SSR static tree (${label}, ${size} items) — preact`,
    { group: label },
    () => {
      renderPreact(preactElement(PreactStaticTree, { items }))
    },
  )
}
