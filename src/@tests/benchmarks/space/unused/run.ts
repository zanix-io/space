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
 * The benchmark the previous scenario could not be: does selective loading actually reduce the
 * JavaScript a browser downloads when a page does NOT use all of an app's interactivity?
 *
 * The earlier architecture benchmark answered "no" (Comets cost +21.6KB over full hydration) for a
 * reason baked into its design: every interactive component type it owned appeared on the page, so
 * splitting could not save anything. This scenario changes exactly that one variable and holds
 * everything else fixed.
 *
 * The app owns EIGHT interactive component types. The page under test renders TWO.
 *
 * - Full hydration ships one root bundle containing all eight, because a single whole-page
 *   `hydrateRoot` has no way to know which two this page rendered.
 * - Comets build all eight as separate chunks, but `hydrateComets` only ever imports the chunk of
 *   a comet whose boundary is present in THIS page's HTML — so the browser fetches two.
 *
 * The measurement is bytes TRANSFERRED, not bytes built. That distinction is the whole point.
 *
 * @module
 */

import { chromium } from 'npm:playwright-core@1.62.1'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { createElement as reactElement } from 'react'
import { createElement as preactElement } from 'preact'
import { buildCometsClient } from '../variants/build-comets-client.ts'
import { buildFullHydrationClient } from '../variants/build-full-hydration.ts'
import { findBuiltAsset } from '../variants/static-server.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { setCometManifest } from 'modules/comets/comet-manifest.ts'
import { renderToResponse as renderToResponseReact } from 'modules/render/render-to-response.tsx'
import { renderToResponse as renderToResponsePreact } from 'modules/render/render-to-response-preact.ts'
// Both renderer runtimes: `@zanix/space` ships none since the entry-point split, and this harness
// renders by hand without ever reaching `defineSpaceApp`. Installed per renderer, right where the
// active one is selected — one process here renders both, and installing swaps the page/not-found
// renderer wholesale (the Comet element factory keeps one slot per renderer, so both stay usable).
import { installReactRuntime } from '../../../../../mod-react.ts'
import { installPreactRuntime } from '../../../../../mod-preact.ts'
import { collectMetrics, INIT_SCRIPT } from '../variants/metrics.ts'

const REPO_ROOT = Deno.cwd()
const TMP_ROOT = getTemporaryFolder(import.meta.url)
const DIR = 'src/@tests/benchmarks/space/unused'
const TYPES = [
  'likebutton',
  'cart',
  'newsletter',
  'search',
  'accountmenu',
  'reviews',
  'productdetails',
  'filters',
]
/** The two the page under test actually renders. */
const USED = ['likebutton', 'cart']

/** `--throttle` applies the fixed CPU+network handicap described at its use site below. */
const THROTTLE = Deno.args.includes('--throttle')

/** Deterministic filler so the page has real server-rendered weight, identical in every variant. */
function articles(): Array<{ id: number; title: string; body: string }> {
  return Array.from({ length: 100 }, (_, i) => ({
    id: i,
    title: `Article ${i + 1}`,
    body:
      `Server-rendered content block ${i + 1}. This never becomes interactive under any variant, ` +
      `and is identical across all four so it can never be the source of a difference.`,
  }))
}

interface VariantResult {
  name: string
  jsTransferredBytes: number
  jsRequestCount: number
  htmlTransferredBytes: number
  hydratedBoundaryCount: number
  firstContentfulPaintMs: number
  domContentLoadedMs: number
  longTaskCount: number
  longTaskTotalMs: number
  interactionLatencyMs: number
  chunkSizes: string
}

async function measure(
  name: string,
  html: string,
  assetsRoot: string,
  interactionSelector: string,
): Promise<VariantResult> {
  const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    const url = new URL(req.url)
    if (url.pathname === '/') {
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
    try {
      // `assetsRoot` is the build's OUT DIR; `url.pathname` already carries the
      // `/assets/` prefix the built chunks reference each other by.
      const file = await Deno.readFile(`${assetsRoot}${url.pathname}`)
      return new Response(file, { headers: { 'content-type': 'text/javascript' } })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
  const port = (server.addr as Deno.NetAddr).port

  const browser = await chromium.launch()
  const page = await browser.newPage()

  // Optional, reproducible throttling via CDP. Not a simulation of any particular real device or
  // network — a fixed, documented handicap applied IDENTICALLY to every variant, so the only
  // question it answers is whether byte and CPU differences start to matter once transfer and
  // execution stop being free. Localhost timings alone systematically hide that.
  if (THROTTLE) {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 100,
      downloadThroughput: Math.round((4 * 1024 * 1024) / 8), // 4 Mbps
      uploadThroughput: Math.round((750 * 1024) / 8),
      connectionType: 'cellular3g',
    })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 2 })
    // Cache disabled so every variant pays full transfer cost, never a warm second read.
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  }

  await page.addInitScript(INIT_SCRIPT)
  console.error(`    [${name}] loading...`)
  try {
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForLoadState('load', { timeout: 60_000 })
  } catch (error) {
    console.error(`    [${name}] load issue: ${String(error).slice(0, 120)}`)
  }
  console.error(`    [${name}] loaded`)
  await page.waitForTimeout(1500)

  const metrics = await page.evaluate(collectMetrics)

  // Per-chunk breakdown, from real Resource Timing — this is what makes "transferred, not built"
  // legible rather than an assertion.
  const chunks = await page.evaluate(() =>
    performance.getEntriesByType('resource')
      .filter((e) => (e as PerformanceResourceTiming).initiatorType !== 'navigation')
      .filter((e) => e.name.endsWith('.js'))
      .map((e) => {
        const r = e as PerformanceResourceTiming
        return `${r.name.split('/').pop()}=${(r.transferSize / 1024).toFixed(1)}KB`
      })
  ) as string[]

  let interactionLatencyMs = -1
  try {
    const before = await page.evaluate(
      (s: string) => document.querySelector(s)?.textContent ?? '',
      interactionSelector,
    )
    const start = Date.now()
    await page.click(interactionSelector, { timeout: 5000 })
    await page.waitForFunction(
      ({ s, b }: { s: string; b: string }) => (document.querySelector(s)?.textContent ?? '') !== b,
      { s: interactionSelector, b: before },
      { timeout: 8000 },
    )
    interactionLatencyMs = Date.now() - start
  } catch {
    interactionLatencyMs = -1
  }

  await browser.close()
  await server.shutdown()

  return {
    name,
    jsTransferredBytes: metrics.jsTransferredBytes,
    jsRequestCount: metrics.jsRequestCount,
    htmlTransferredBytes: metrics.htmlTransferredBytes,
    hydratedBoundaryCount: metrics.hydratedBoundaryCount,
    firstContentfulPaintMs: metrics.firstContentfulPaintMs ?? -1,
    domContentLoadedMs: metrics.domContentLoadedMs,
    longTaskCount: metrics.longTaskCount,
    longTaskTotalMs: metrics.longTaskTotalMs,
    interactionLatencyMs,
    chunkSizes: chunks.join(' '),
  }
}

function cometEntries(renderer: 'react' | 'preact'): Record<string, string> {
  const ext = renderer === 'react' ? 'tsx' : 'ts'
  const entries: Record<string, string> = {
    'client-entry': join(REPO_ROOT, `${DIR}/${renderer}/client-entry-comets.ts`),
  }
  // ALL eight are real build entries — a real Space build discovers every `'use comet'` file in
  // the project, not just the ones a given page renders. Only two are ever fetched at runtime.
  for (const t of TYPES) {
    entries[`${t}-comet`] = join(REPO_ROOT, `${DIR}/${renderer}/comets/${t}-comet.${ext}`)
  }
  return entries
}

async function buildAndRenderComets(
  label: string,
  renderer: 'react' | 'preact',
  compiler: boolean,
): Promise<VariantResult> {
  const outDir = await Deno.makeTempDir({ dir: TMP_ROOT, prefix: `space-unused-${renderer}-` })
  await buildCometsClient({
    root: REPO_ROOT,
    outDir,
    renderer,
    compiler,
    comets: cometEntries(renderer),
  })
  if (renderer === 'preact') installPreactRuntime()
  else installReactRuntime()
  setActiveRenderer(renderer)
  setCometManifest(JSON.parse(await Deno.readTextFile(join(outDir, 'comets-manifest.json'))))
  const entryAsset = await findBuiltAsset(join(outDir, 'assets'), 'client-entry')

  const ext = renderer === 'react' ? 'tsx' : 'ts'
  const comets = []
  for (const t of USED) {
    const mod = await import(`./${renderer}/comets/${t}-comet.${ext}`)
    comets.push(mod.default)
  }

  const h = renderer === 'react' ? reactElement : preactElement
  // deno-lint-ignore no-explicit-any
  const el = (t: any, p: Record<string, unknown> | null, ...k: unknown[]) =>
    (h as (...a: unknown[]) => unknown)(t, p, ...k)

  const doc = el('html', null, [
    el('head', { key: 'h' }, el('title', { key: 't' }, `Unused interactivity — ${label}`)),
    el('body', { key: 'b' }, [
      el(
        'main',
        { key: 'm' },
        articles().map((a) =>
          el('article', { key: a.id }, [
            el('h2', { key: 'h' }, a.title),
            el('p', { key: 'p' }, a.body),
          ])
        ),
      ),
      el('div', { key: 'i', id: 'app' }, comets.map((C, i) => el(C, { key: i }))),
      el('script', { key: 's', type: 'module', src: entryAsset }),
    ]),
  ])

  const response = renderer === 'react'
    // deno-lint-ignore no-explicit-any
    ? await renderToResponseReact(doc as any)
    // deno-lint-ignore no-explicit-any
    : renderToResponsePreact(doc as any, { doctype: true })
  const html = await response.text()

  return await measure(label, html, outDir, '[data-testid="likebutton"]')
}

async function buildAndRenderFull(): Promise<VariantResult> {
  const outDir = await Deno.makeTempDir({ dir: TMP_ROOT, prefix: 'space-unused-full-' })
  await buildFullHydrationClient({
    root: REPO_ROOT,
    outDir,
    entry: join(REPO_ROOT, `${DIR}/react/client-entry-full.tsx`),
  })
  setActiveRenderer('react')
  setCometManifest(undefined)
  const entryAsset = await findBuiltAsset(join(outDir, 'assets'), 'client-entry')

  const { LikeButton } = await import('./react/likebutton.tsx')
  const { Cart } = await import('./react/cart.tsx')
  const el = reactElement

  const doc = el('html', null, [
    el('head', { key: 'h' }, el('title', { key: 't' }, 'Unused interactivity — A')),
    el('body', { key: 'b' }, [
      el(
        'main',
        { key: 'm' },
        articles().map((a) =>
          el('article', { key: a.id }, [
            el('h2', { key: 'h' }, a.title),
            el('p', { key: 'p' }, a.body),
          ])
        ),
      ),
      el('div', { key: 'i', id: 'app' }, [
        el(LikeButton, { key: 'l' }),
        el(Cart, { key: 'c' }),
      ]),
      el('script', { key: 's', type: 'module', src: entryAsset }),
    ]),
  ])

  // deno-lint-ignore no-explicit-any
  const response = await renderToResponseReact(doc as any)
  const html = await response.text()
  return await measure(
    'A: React full hydration',
    html,
    outDir,
    '[data-testid="likebutton"]',
  )
}

const results: VariantResult[] = []
console.error('A: React full hydration (all 8 types in one bundle)...')
results.push(await buildAndRenderFull())
console.error('B: React + Comets...')
results.push(await buildAndRenderComets('B: React + Comets', 'react', false))
console.error('C: React + Compiler + Comets...')
results.push(await buildAndRenderComets('C: React + Compiler + Comets', 'react', true))
console.error('D: Preact + Comets...')
results.push(await buildAndRenderComets('D: Preact + Comets', 'preact', false))

console.log(
  `\n\n=== Unused-interactivity scenario: 8 types owned, 2 rendered${
    THROTTLE
      ? ' — THROTTLED (4Mbps, 100ms RTT, 2x CPU, cache disabled)'
      : ' — localhost, unthrottled'
  } ===\n`,
)
for (const r of results) {
  console.log(`--- ${r.name} ---`)
  console.log(`  JS transferred:       ${(r.jsTransferredBytes / 1024).toFixed(1)}KB`)
  console.log(`  JS requests:          ${r.jsRequestCount}`)
  console.log(`  HTML transferred:     ${(r.htmlTransferredBytes / 1024).toFixed(1)}KB`)
  console.log(`  Hydrated boundaries:  ${r.hydratedBoundaryCount}`)
  console.log(`  FCP:                  ${r.firstContentfulPaintMs.toFixed(0)}ms`)
  console.log(`  DOMContentLoaded:     ${r.domContentLoadedMs.toFixed(0)}ms`)
  console.log(`  Long tasks:           ${r.longTaskCount} (${r.longTaskTotalMs.toFixed(0)}ms)`)
  console.log(`  Interaction latency:  ${r.interactionLatencyMs}ms`)
  console.log(`  Chunks fetched:       ${r.chunkSizes}`)
  console.log()
}
console.log(JSON.stringify(results, null, 2))
Deno.exit(0)
