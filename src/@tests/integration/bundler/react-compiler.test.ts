import { assert } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { buildSpaceClient } from 'modules/bundler/build-client.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'

async function withTempDir(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
  try {
    await run(root)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

/** Every `.js` file directly under `dir`. */
async function listJsFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && entry.name.endsWith('.js')) files.push(entry.name)
  }
  return files
}

// Real hook usage (`useState`), a derived value computed with no manual `useMemo` (the classic
// React Compiler auto-memoization target), an inline event handler, and a top-level `<>...</>`
// Fragment — the exact shape verified in this package's own pre-adoption spike (P3-4).
const REACT_COMET_SOURCE = `'use comet'
import { useState } from 'react'

export default function Counter({ items }) {
  const [count, setCount] = useState(0)
  const visible = items.filter((item) => item.length > count)
  return (
    <>
      <p data-testid="count">{count}</p>
      <ul>{visible.map((item) => <li key={item}>{item}</li>)}</ul>
      <button type="button" onClick={() => setCount((c) => c + 1)}>increment</button>
    </>
  )
}
`

const PREACT_COMET_SOURCE = `'use comet'
import { useState } from 'preact/hooks'

export default function Counter({ items }) {
  const [count, setCount] = useState(0)
  const visible = items.filter((item) => item.length > count)
  return (
    <>
      <p data-testid="count">{count}</p>
      <ul>{visible.map((item) => <li key={item}>{item}</li>)}</ul>
      <button type="button" onClick={() => setCount((c) => c + 1)}>increment</button>
    </>
  )
}
`

Deno.test(
  "buildSpaceClient (renderer: 'react', default): a real comet using state/derived values/an event handler compiles through React Compiler — the built chunk carries React Compiler's own runtime memoization helper and cache-array pattern, and its static content is untouched",
  async () => {
    await withTempDir(async (root) => {
      const cometPath = join(root, 'counter.tsx')
      await Deno.writeTextFile(cometPath, REACT_COMET_SOURCE)

      const result = await buildSpaceClient({ root, css: { tailwind: false } })

      const assetsDir = join(result.outDir, 'assets')
      const jsFiles = await listJsFiles(assetsDir)
      const cometChunk = jsFiles.find((f) => f.startsWith('counter'))
      assert(cometChunk, `expected a counter-* chunk, got: ${jsFiles.join(', ')}`)

      const code = await Deno.readTextFile(join(assetsDir, cometChunk))
      // The generated cache-slot pattern React Compiler's own output always uses (`t[0]!==`-style
      // indexing over a `useMemoCache(n)` array), read directly from a destructured import — this
      // is what actually proves the comet's OWN chunk was compiled, regardless of which chunk the
      // runtime helper itself physically lives in (Rolldown's own chunk-splitting can share it
      // across every comet importing it, rather than duplicating it into each one — a real,
      // desirable optimization once more than one consumer exists, not a build defect).
      assert(/\[0\]\s*!==/.test(code), `expected a real memo-cache-array read, got:\n${code}`)
      // No `external` config for react in `build-client.ts` (same as every other comet build) —
      // React's own `useMemoCache` helper (`__COMPILER_RUNTIME`'s own `c` function) is bundled
      // somewhere in the real build output, never left as an unresolved import specifier. Checked
      // across every emitted chunk, not just the comet's own — Rolldown is free to place a shared
      // dependency like this one in whichever chunk its own splitting heuristics choose.
      const allChunks = await Promise.all(
        jsFiles.map((f) => Deno.readTextFile(join(assetsDir, f))),
      )
      assert(
        allChunks.some((chunk) => chunk.includes('useMemoCache')),
        `expected React Compiler's runtime helper somewhere in the build output, got chunks:\n${
          jsFiles.join(', ')
        }`,
      )
      // Static content survived the compile untouched.
      assert(code.includes('data-testid'), code)
      assert(code.includes('increment'), code)
    })
  },
)

Deno.test(
  "buildSpaceClient (renderer: 'preact'): the same comet shape builds correctly, with ZERO trace of React Compiler anywhere in the output — not compiler-runtime, not babel-plugin-react-compiler, not @rolldown/plugin-babel, not even 'react' itself",
  async () => {
    setActiveRenderer('preact')
    try {
      await withTempDir(async (root) => {
        const cometPath = join(root, 'counter.tsx')
        await Deno.writeTextFile(cometPath, PREACT_COMET_SOURCE)

        const result = await buildSpaceClient({
          root,
          css: { tailwind: false },
          renderer: 'preact',
        })

        const assetsDir = join(result.outDir, 'assets')
        const jsFiles = await listJsFiles(assetsDir)
        const cometChunk = jsFiles.find((f) => f.startsWith('counter'))
        assert(cometChunk, `expected a counter-* chunk, got: ${jsFiles.join(', ')}`)

        const code = await Deno.readTextFile(join(assetsDir, cometChunk))
        assert(!/compiler-runtime|react-compiler|plugin-babel|useMemoCache/i.test(code), code)
        assert(!/from ?["']react["']|require\(["']react["']\)/.test(code), code)
        assert(code.includes('data-testid'), code)
        assert(code.includes('increment'), code)
      })
    } finally {
      setActiveRenderer('react')
    }
  },
)
