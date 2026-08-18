/**
 * React's `renderToReadableStream` has a real streaming characteristic no other file in this
 * directory isolates on its own: bytes can start flowing before the whole tree finishes
 * rendering. This file measures that directly — time to the FIRST chunk vs time to full drain —
 * against `TREE_SIZES.large`, where the gap between the two has the most room to show up.
 *
 * Preact has no streaming primitive at all (`preact-render-to-string`'s `render()` is fully
 * synchronous — confirmed by this package's own decision spike, documented in
 * `render-to-response-preact.ts`'s own doc: no `Suspense`/`lazy`/`use()` anywhere in Preact core,
 * so there is no boundary a streaming renderer would have anything to stream around). This is a
 * genuine, already-documented architectural asymmetry, not a gap in this benchmark — Preact's own
 * case below measures its one and only real timing (full synchronous render), not an invented
 * "first chunk" that doesn't exist for it.
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

const items = makeItems(TREE_SIZES.large)

Deno.bench(
  `react: time to FIRST chunk (${TREE_SIZES.large} items)`,
  { group: 'streaming-first-chunk', baseline: true },
  async () => {
    const stream = await renderToReadableStream(reactElement(ReactStaticTree, { items }))
    const reader = stream.getReader()
    await reader.read()
    await reader.cancel()
  },
)

Deno.bench(
  `react: time to FULL drain (${TREE_SIZES.large} items)`,
  { group: 'streaming-full-drain', baseline: true },
  async () => {
    const stream = await renderToReadableStream(reactElement(ReactStaticTree, { items }))
    await drainReactStream(stream)
  },
)

Deno.bench(
  `preact: full synchronous render, its only real timing (${TREE_SIZES.large} items)`,
  { group: 'streaming-full-drain' },
  () => {
    renderPreact(preactElement(PreactStaticTree, { items }))
  },
)
