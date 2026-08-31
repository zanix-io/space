// deno-lint-ignore-file deno-zanix-plugin/no-znx-console no-await-in-loop
// Same exemption as `run.ts`'s own file-level directive — see that file's own header doc. This
// module is the shared orchestration `run.ts`/`record-baseline.ts`/`check-baseline.ts` all call
// into; its own progress lines are diagnostic stderr output, not a report a human parses.
/**
 * The actual "build all 4 variants, render each one's SSR HTML, serve it, drive a real headless
 * Chromium to measure it" orchestration — factored out of `run.ts` so `record-baseline.ts`/
 * `check-baseline.ts` (the deterministic byte/count baseline this benchmark's own report table
 * calls out as "worth comparing across runs") can reuse the EXACT same build+measure pipeline
 * `run.ts` reports from, rather than a second, drifting copy of it.
 *
 * @module
 */
import { chromium } from 'npm:playwright-core@1.62.1'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { makeProducts } from '../scenario/data.ts'
import { buildFullHydrationClient } from './build-full-hydration.ts'
import { buildCometsClient } from './build-comets-client.ts'
import { findBuiltAsset, serveVariant } from './static-server.ts'
import { renderVariantA, renderVariantPreactComets, renderVariantReactComets } from './render.ts'
import { collectMetrics, INIT_SCRIPT } from './metrics.ts'
import type { CollectedMetrics } from './metrics.ts'

import ReactLikeButtonComet from '../scenario/react/comets/like-button-comet.tsx'
import ReactNewsletterComet from '../scenario/react/comets/newsletter-comet.tsx'
import ReactCartComet from '../scenario/react/comets/cart-comet.tsx'
import PreactLikeButtonComet from '../scenario/preact/comets/like-button-comet.tsx'
import PreactNewsletterComet from '../scenario/preact/comets/newsletter-comet.tsx'
import PreactCartComet from '../scenario/preact/comets/cart-comet.tsx'

/** See `run.ts`'s own doc for why this has no path by default — same reasoning, unchanged. */
const CHROMIUM_PATH = Deno.env.get('SPACE_BENCH_CHROMIUM')

const REPO_ROOT = Deno.cwd()

export interface VariantResult {
  name: string
  metrics: CollectedMetrics
  interactionLatencyMs: number
  cartInteractionLatencyMs: number
}

export interface MeasureAllResult {
  results: VariantResult[]
  failures: Array<{ name: string; error: string }>
}

async function buildAndRenderAll(products: ReturnType<typeof makeProducts>) {
  const tmp = await Deno.makeTempDir({
    dir: getTemporaryFolder(import.meta.url),
    prefix: 'space-comets-bench-',
  })
  const dirs = {
    a: join(tmp, 'a'),
    b: join(tmp, 'b'),
    c: join(tmp, 'c'),
    d: join(tmp, 'd'),
  }

  console.error('Building variant A (React, full hydration, no Compiler)...')
  await buildFullHydrationClient({
    root: REPO_ROOT,
    outDir: dirs.a,
    entry: join(
      REPO_ROOT,
      'src/@tests/benchmarks/space/scenario/react/client-entry-full-hydration.tsx',
    ),
  })

  console.error('Building variant B (React + Comets, NO Compiler)...')
  await buildCometsClient({
    root: REPO_ROOT,
    outDir: dirs.b,
    renderer: 'react',
    compiler: false,
    comets: {
      'like-button-comet': join(
        REPO_ROOT,
        'src/@tests/benchmarks/space/scenario/react/comets/like-button-comet.tsx',
      ),
      'newsletter-comet': join(
        REPO_ROOT,
        'src/@tests/benchmarks/space/scenario/react/comets/newsletter-comet.tsx',
      ),
      'cart-comet': join(
        REPO_ROOT,
        'src/@tests/benchmarks/space/scenario/react/comets/cart-comet.tsx',
      ),
      'client-entry': join(
        REPO_ROOT,
        'src/@tests/benchmarks/space/scenario/react/client-entry-comets.ts',
      ),
    },
  })

  console.error('Building variant C (React + Compiler + Comets, real spacePlugin default)...')
  await buildCometsClient({
    root: REPO_ROOT,
    outDir: dirs.c,
    renderer: 'react',
    compiler: true,
    comets: {
      'like-button-comet': join(
        REPO_ROOT,
        'src/@tests/benchmarks/space/scenario/react/comets/like-button-comet.tsx',
      ),
      'newsletter-comet': join(
        REPO_ROOT,
        'src/@tests/benchmarks/space/scenario/react/comets/newsletter-comet.tsx',
      ),
      'cart-comet': join(
        REPO_ROOT,
        'src/@tests/benchmarks/space/scenario/react/comets/cart-comet.tsx',
      ),
      'client-entry': join(
        REPO_ROOT,
        'src/@tests/benchmarks/space/scenario/react/client-entry-comets.ts',
      ),
    },
  })

  console.error('Building variant D (Preact + Comets)...')
  await buildCometsClient({
    root: REPO_ROOT,
    outDir: dirs.d,
    renderer: 'preact',
    compiler: false,
    comets: {
      'like-button-comet': join(
        REPO_ROOT,
        'src/@tests/benchmarks/space/scenario/preact/comets/like-button-comet.tsx',
      ),
      'newsletter-comet': join(
        REPO_ROOT,
        'src/@tests/benchmarks/space/scenario/preact/comets/newsletter-comet.tsx',
      ),
      'cart-comet': join(
        REPO_ROOT,
        'src/@tests/benchmarks/space/scenario/preact/comets/cart-comet.tsx',
      ),
      'client-entry': join(
        REPO_ROOT,
        'src/@tests/benchmarks/space/scenario/preact/client-entry-comets.ts',
      ),
    },
  })

  console.error('Rendering SSR HTML for every variant (sequential, see this module doc)...')
  const assetsA = join(dirs.a, 'assets')
  const htmlA = await renderVariantA(products, await findBuiltAsset(assetsA, 'client-entry'))

  const assetsB = join(dirs.b, 'assets')
  const htmlB = await renderVariantReactComets(
    products,
    join(dirs.b, 'comets-manifest.json'),
    await findBuiltAsset(assetsB, 'client-entry'),
    ReactLikeButtonComet,
    ReactNewsletterComet,
    ReactCartComet,
  )

  const assetsC = join(dirs.c, 'assets')
  const htmlC = await renderVariantReactComets(
    products,
    join(dirs.c, 'comets-manifest.json'),
    await findBuiltAsset(assetsC, 'client-entry'),
    ReactLikeButtonComet,
    ReactNewsletterComet,
    ReactCartComet,
  )

  const assetsD = join(dirs.d, 'assets')
  // No casts — `defineComet` returns a renderer-neutral boundary component
  // (`CometBoundaryComponent`, `typings/comet.ts`), so a Preact-authored comet arrives here as a
  // value Preact's own `createElement` accepts directly. This used to require three `as any`s,
  // because that return type named React's own `ComponentType`.
  const htmlD = await renderVariantPreactComets(
    products,
    join(dirs.d, 'comets-manifest.json'),
    await findBuiltAsset(assetsD, 'client-entry'),
    PreactLikeButtonComet,
    PreactNewsletterComet,
    PreactCartComet,
  )

  return {
    tmp,
    variants: [
      { name: 'A: React + full hydration', html: htmlA, assetsRoot: dirs.a },
      { name: 'B: React + Comets (no Compiler)', html: htmlB, assetsRoot: dirs.b },
      { name: 'C: React + Compiler + Comets', html: htmlC, assetsRoot: dirs.c },
      { name: 'D: Preact + Comets', html: htmlD, assetsRoot: dirs.d },
    ],
  }
}

const STEP_TIMEOUT_MS = 15_000

async function measure(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  name: string,
  url: string,
): Promise<VariantResult> {
  const context = await browser.newContext()
  const page = await context.newPage()
  page.setDefaultTimeout(STEP_TIMEOUT_MS)
  // Real browser-side errors forwarded to THIS process's own stderr immediately — without this, a
  // hydration failure inside the page is invisible until a `waitForFunction` below times out with
  // no clue why (see this benchmark's own run log for why this was added: variant B hung with zero
  // diagnostic output the first time this ran).
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error(`  [${name}] console.error: ${msg.text()}`)
  })
  page.on('pageerror', (err) => console.error(`  [${name}] pageerror: ${err}`))

  await page.addInitScript(INIT_SCRIPT)
  await page.goto(url, { waitUntil: 'load' })
  // Settle window for comet dynamic imports (B/C/D) to actually resolve — hydrateComets() fires
  // them concurrently but returns before they land (see client-entry-comets.ts's own doc).
  await page.waitForTimeout(800)

  const metrics = await page.evaluate(collectMetrics)

  // Warm-up click, discarded — on `like-1`, a DIFFERENT LikeButton instance from the one measured
  // below (`like-0`), so its own toggled state never touches what the real measurement waits on.
  // The first real interaction after navigation absorbs a fixed cost every variant pays alike
  // (first Chromium input-dispatch/compositor round trip, first post-idle paint, first
  // React/Preact synthetic-event-system + click-handler JIT warm-up) — without this, that cost
  // always lands on whichever metric gets clicked first (`interactionLatencyMs` below), inflating
  // it relative to `cartInteractionLatencyMs` for reasons that have nothing to do with either
  // component's own architecture. Confirmed empirically: the gap was LARGEST in variant A, which
  // has zero Comet machinery at all — ruling out hydration-boundary cost as the explanation.
  await page.click('[data-testid="like-1"]')
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="like-1"]')
    return el?.textContent?.includes('♥') ?? false
  })

  const likeStart = Date.now()
  await page.click('[data-testid="like-0"]')
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="like-0"]')
    return el?.textContent?.includes('♥') ?? false
  })
  const interactionLatencyMs = Date.now() - likeStart

  const cartStart = Date.now()
  await page.click('[data-testid="cart-add"]')
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="cart-count"]')
    return el?.textContent?.startsWith('1 items') ?? false
  })
  const cartInteractionLatencyMs = Date.now() - cartStart

  await context.close()
  return { name, metrics, interactionLatencyMs, cartInteractionLatencyMs }
}

/** Builds, serves, and measures all 4 variants in a real headless Chromium — the one place this
 * benchmark's actual work happens. `run.ts` reports every field of the result; `record-baseline.ts`/
 * `check-baseline.ts` read only the deterministic byte/count subset (`metrics.ts`'s own doc calls
 * these — `htmlTransferredBytes`/`jsTransferredBytes`/`jsRequestCount`/`hydratedBoundaryCount` —
 * out as the fields that don't move with machine load, unlike FCP/LCP/interaction timing). */
export async function measureAllVariants(): Promise<MeasureAllResult> {
  const products = makeProducts()
  const { tmp, variants } = await buildAndRenderAll(products)

  const servers = variants.map((v) => ({
    name: v.name,
    server: serveVariant({ html: v.html, assetsRoot: v.assetsRoot }),
  }))

  console.error(
    CHROMIUM_PATH
      ? `Launching Chromium (SPACE_BENCH_CHROMIUM): ${CHROMIUM_PATH}`
      : "Launching Chromium (Playwright's own resolution — set SPACE_BENCH_CHROMIUM to override)...",
  )
  // `executablePath: undefined` is not the same as passing a bad path: Playwright then resolves its
  // own installed browser, which is what makes this work on Linux/Windows without configuration.
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true })

  try {
    const results: VariantResult[] = []
    const failures: Array<{ name: string; error: string }> = []
    for (const { name, server } of servers) {
      const port = (server.addr as Deno.NetAddr).port
      console.error(`Measuring ${name} at http://localhost:${port}/ ...`)
      try {
        // A hard outer watchdog on top of `page.setDefaultTimeout` — belt and suspenders: if
        // anything inside `measure()` hangs past every Playwright-level timeout combined (should
        // never happen, but did once with zero diagnostic output before `page.on('console'/
        // 'pageerror')` was added), this guarantees the whole run still finishes and reports every
        // OTHER variant instead of hanging indefinitely.
        const result = await Promise.race([
          measure(browser, name, `http://localhost:${port}/`),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('watchdog: measure() exceeded 45s')), 45_000)
          ),
        ])
        results.push(result)
      } catch (error) {
        console.error(`  FAILED: ${name}: ${error}`)
        failures.push({ name, error: String(error) })
      }
    }
    return { results, failures }
  } finally {
    await browser.close()
    await Promise.all(servers.map(({ server }) => server.shutdown()))
    await Deno.remove(tmp, { recursive: true })
  }
}
