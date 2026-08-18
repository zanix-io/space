/**
 * Cost of `REPEATED_RENDER_COUNT` (50) INDEPENDENT SSR passes of the same small tree, back to
 * back, within one measured iteration — React vs Preact.
 *
 * This is deliberately NOT "repeated renders/updates" in the client-reconciler sense (a
 * persistent root re-rendering the same mounted tree as props/state change, where React
 * Compiler's memoization can skip unchanged work). Deno has no DOM and neither renderer keeps any
 * persistent tree across separate `renderToReadableStream`/`render()` calls — there is nothing
 * here for either renderer to diff against a previous pass, so this instead models a different,
 * equally real scenario: a server producing many independent responses for the same component
 * shape (e.g. a list page SSR-ing N similar widgets, or N sequential requests hitting the same
 * route) — throughput under repetition, not incremental-update cost. The client-reconciler
 * version of "repeated renders/updates" — the one Compiler actually optimizes — is only
 * measurable in the browser suite (`benchmarks/browser/`), against a real mounted root.
 *
 * @module
 */
import { createElement as reactElement } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { createElement as preactElement } from 'preact'
import { render as renderPreact } from 'preact-render-to-string'
import { StaticTree as ReactStaticTree } from './react-components.tsx'
import { StaticTree as PreactStaticTree } from './preact-components.ts'
import { makeItems, REPEATED_RENDER_COUNT, TREE_SIZES } from './fixtures.ts'
import { drainReactStream } from './ssr-helpers.ts'

const items = makeItems(TREE_SIZES.small)

Deno.bench(
  `${REPEATED_RENDER_COUNT} independent SSR passes (small tree) — react`,
  { group: 'repeated-renders', baseline: true },
  async () => {
    // Genuinely sequential on purpose — modeling N back-to-back requests, not independent
    // concurrent work (see this file's own module doc).
    for (let i = 0; i < REPEATED_RENDER_COUNT; i++) {
      // deno-lint-ignore no-await-in-loop
      const stream = await renderToReadableStream(reactElement(ReactStaticTree, { items }))
      // deno-lint-ignore no-await-in-loop
      await drainReactStream(stream)
    }
  },
)

Deno.bench(
  `${REPEATED_RENDER_COUNT} independent SSR passes (small tree) — preact`,
  { group: 'repeated-renders' },
  () => {
    for (let i = 0; i < REPEATED_RENDER_COUNT; i++) {
      renderPreact(preactElement(PreactStaticTree, { items }))
    }
  },
)
