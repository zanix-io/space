// deno-lint-ignore-file deno-zanix-plugin/no-znx-console no-await-in-loop
// `console` on purpose, and the exemption is stated here rather than left as dozens of silenced
// findings. These are hand-run CLI scripts whose entire output IS a report a human reads and
// copies — `@zanix/logger` decorates every line with a timestamp, level and package prefix, which
// is right for a running server and wrong for a metrics table. Library code in this package uses
// the logger; these scripts are tools, not library code, and none of them ships anywhere.
// Every loop here is sequential BY DESIGN: renderer selection and the comet manifest
// are process-global mutable state (the same constraint `variants/render.ts`
// documents), and each browser measurement must have the machine to itself to mean
// anything. Parallelising these would corrupt both the render and the numbers.
/**
 * Does React Compiler show a measurable difference in the scenario it is actually for?
 *
 * The architecture benchmark could not answer this and said so: it fired one interaction per
 * variant, while the Compiler's whole purpose is to avoid redundant work across MANY updates. This
 * drives 40 real clicks through the same component tree, built twice from identical source — once
 * with `reactCompilerPreset()` and once without — and counts how many times each component
 * function actually ran.
 *
 * Render counts are the mechanism, not a proxy for it: the tree deliberately contains four
 * children whose props never change while the parent's state does, plus an un-memoized expensive
 * derived value. Hand-written `useMemo`/`memo` are absent on purpose — they are what the Compiler
 * exists to make unnecessary, and including them would measure the author, not the compiler.
 *
 * @module
 */

import { chromium } from 'npm:playwright-core@1.62.1'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { createElement as h } from 'react'
import { buildCometsClient } from '../variants/build-comets-client.ts'
import { findBuiltAsset } from '../variants/static-server.ts'
// React's runtime: `@zanix/space` ships none, and this harness renders by hand.
import { installReactRuntime } from '../../../../../mod-react.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { setCometManifest } from 'modules/comets/comet-manifest.ts'
import { renderToResponse } from 'modules/render/render-to-response.tsx'
import { INIT_SCRIPT } from '../variants/metrics.ts'

const REPO_ROOT = Deno.cwd()
const DIR = 'src/@tests/benchmarks/space/compiler'
const CLICKS = 40

interface Run {
  label: string
  renders: Record<string, number>
  totalUpdateMs: number
  medianClickMs: number
  longTaskCount: number
  longTaskTotalMs: number
  jsTransferredBytes: number
}

async function measure(label: string, compiler: boolean): Promise<Run> {
  const outDir = await Deno.makeTempDir({
    dir: getTemporaryFolder(import.meta.url),
    prefix: `space-compiler-${compiler}-`,
  })
  await buildCometsClient({
    root: REPO_ROOT,
    outDir,
    renderer: 'react',
    compiler,
    comets: {
      tree: join(REPO_ROOT, `${DIR}/tree.tsx`),
      'client-entry': join(REPO_ROOT, `${DIR}/client-entry.ts`),
    },
  })

  installReactRuntime()
  setActiveRenderer('react')
  setCometManifest(JSON.parse(await Deno.readTextFile(join(outDir, 'comets-manifest.json'))))
  const entryAsset = await findBuiltAsset(join(outDir, 'assets'), 'client-entry')
  const { default: TreeComet } = await import('./tree.tsx')

  const doc = h('html', null, [
    h('head', { key: 'h' }, h('title', { key: 't' }, label)),
    h('body', { key: 'b' }, [
      // deno-lint-ignore no-explicit-any
      h(TreeComet as any, { key: 'c' }),
      h('script', { key: 's', type: 'module', src: entryAsset }),
    ]),
  ])
  // deno-lint-ignore no-explicit-any
  const html = await (await renderToResponse(doc as any)).text()

  const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    const url = new URL(req.url)
    if (url.pathname === '/') {
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
    try {
      return new Response(await Deno.readFile(`${outDir}${url.pathname}`), {
        headers: { 'content-type': 'text/javascript' },
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
  const port = (server.addr as Deno.NetAddr).port

  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.addInitScript(INIT_SCRIPT)
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load', timeout: 20_000 })
  await page.waitForTimeout(1500)

  // Reset counters AFTER hydration so only update-time renders are counted, never the mount.
  await page.evaluate(() => {
    ;(globalThis as unknown as { __renders?: Record<string, number> }).__renders = {}
  })

  const clickTimes: number[] = []
  for (let i = 0; i < CLICKS; i++) {
    const before = await page.evaluate(() =>
      document.querySelector('[data-testid="bump"]')?.textContent ?? ''
    )
    const start = performance.now()
    await page.click('[data-testid="bump"]')
    await page.waitForFunction(
      (b: string) => (document.querySelector('[data-testid="bump"]')?.textContent ?? '') !== b,
      before,
      { timeout: 8000 },
    )
    clickTimes.push(performance.now() - start)
  }

  const renders = await page.evaluate(() =>
    (globalThis as unknown as { __renders?: Record<string, number> }).__renders ?? {}
  ) as Record<string, number>

  const bench = await page.evaluate(() =>
    (window as unknown as { __bench: { longTasks: { duration: number }[] } }).__bench
  ) as { longTasks: { duration: number }[] }

  const js = await page.evaluate(() =>
    (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
      .filter((r) => r.name.endsWith('.js'))
      .reduce((sum, r) => sum + r.transferSize, 0)
  ) as number

  await browser.close()
  await server.shutdown()

  const sorted = [...clickTimes].sort((a, b) => a - b)
  return {
    label,
    renders,
    totalUpdateMs: clickTimes.reduce((a, b) => a + b, 0),
    medianClickMs: sorted[Math.floor(sorted.length / 2)],
    longTaskCount: bench.longTasks.length,
    longTaskTotalMs: bench.longTasks.reduce((s, t) => s + t.duration, 0),
    jsTransferredBytes: js,
  }
}

const runs: Run[] = []
console.error('React WITHOUT Compiler...')
runs.push(await measure('React, no Compiler', false))
console.error('React WITH Compiler...')
runs.push(await measure('React + Compiler', true))

console.log(`\n\n=== React Compiler: ${CLICKS} repeated parent updates ===\n`)
for (const r of runs) {
  console.log(`--- ${r.label} ---`)
  console.log(`  JS transferred:      ${(r.jsTransferredBytes / 1024).toFixed(1)}KB`)
  console.log(`  median click→update: ${r.medianClickMs.toFixed(1)}ms`)
  console.log(`  total for ${CLICKS} clicks: ${r.totalUpdateMs.toFixed(0)}ms`)
  console.log(`  long tasks:          ${r.longTaskCount} (${r.longTaskTotalMs.toFixed(0)}ms)`)
  console.log('  component render counts (update-time only, mount excluded):')
  for (const [k, v] of Object.entries(r.renders).sort()) console.log(`     ${k.padEnd(16)} ${v}`)
  console.log()
}
console.log(JSON.stringify(runs, null, 2))
Deno.exit(0)
