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
      // No `external` config for react in `build-client.ts` (same as every other comet build) —
      // Rolldown bundles `react/compiler-runtime`'s contents inline rather than leaving a literal
      // import specifier, so the real evidence is React's own `useMemoCache` helper (confirmed
      // present in the ACTUAL bundled `react` source itself, `__COMPILER_RUNTIME`'s own `c`
      // function) being called from the compiled component — never present in an uncompiled build.
      assert(
        code.includes('useMemoCache'),
        `expected React Compiler's runtime helper, got:\n${code}`,
      )
      // The generated cache-slot pattern React Compiler's own output always uses (`$[0]`-style
      // indexing over a `useMemoCache(n)` array) — confirms an actual per-component memoization
      // cache was generated, not just that the runtime helper is reachable somewhere in React
      // itself.
      assert(/\[0\]\s*!==/.test(code), `expected a real memo-cache-array read, got:\n${code}`)
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
