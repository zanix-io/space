// deno-lint-ignore-file deno-zanix-plugin/no-znx-console
// `console` on purpose, and the exemption is stated here rather than left as dozens of silenced
// findings. These are hand-run CLI scripts whose entire output IS a report a human reads and
// copies — `@zanix/logger` decorates every line with a timestamp, level and package prefix, which
// is right for a running server and wrong for a metrics table. Library code in this package uses
// the logger; these scripts are tools, not library code, and none of them ships anywhere.
/**
 * Evidence probe for what an unguarded client-barrel/renderer mismatch does at runtime: an app
 * whose client barrel does not match its renderer.
 *
 * `@zanix/space/client` exports React's `hydrateComets`; `@zanix/space/client/preact` exports
 * Preact's. Neither barrel consults `getActiveRenderer()`, and none ever will — that would be
 * renderer detection, which this package does not do anywhere. Nothing else in a real app's own
 * build checks the pairing either, so the mismatch this probe builds (Preact comets, server-
 * rendered by Preact, hydrated by React's barrel) is exactly what a Preact app gets by following
 * the README literally, absent the guard described below.
 *
 * A real app never reaches this state: `clientBarrelGuardPlugin`
 * (`modules/bundler/client-barrel-guard.ts`), wired from `spacePlugin({ renderer })`, fails the
 * CLIENT build when the other renderer's hydrate module reaches the graph — keyed on the resolved
 * module, so a re-export or an alias is caught too. `renderer-invariant.test.ts` ([4/4], [4/4b],
 * [4/4c]) owns its regression suite, and the README states the pairing explicitly at its own
 * `hydrateComets` example.
 *
 * This probe documents that failure mode directly, and stays runnable as the evidence for why the
 * build-time guard exists: it reproduces what the mismatch actually does at runtime (nothing
 * throws; the page renders; no Comet is ever interactive). It can still build that mismatch
 * because `build-comets-client.ts` composes `deno()`/`rendererPlugins()`/`cometPlugin()` by hand
 * rather than going through `spacePlugin()` — the guard rides on the latter, so a REAL app (which
 * always builds through `spacePlugin`) cannot reach this state, only this probe can. It measures
 * nothing else — run it and read the console output it captures.
 *
 * @module
 */

import { chromium } from 'npm:playwright-core@1.62.1'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { makeProducts } from './scenario/data.ts'
import { buildCometsClient } from './variants/build-comets-client.ts'
import { findBuiltAsset, serveVariant } from './variants/static-server.ts'
import { renderVariantPreactComets } from './variants/render.ts'
import PreactLikeButtonComet from './scenario/preact/comets/like-button-comet.tsx'
import PreactNewsletterComet from './scenario/preact/comets/newsletter-comet.tsx'
import PreactCartComet from './scenario/preact/comets/cart-comet.tsx'

const REPO_ROOT = Deno.cwd()

async function main(): Promise<void> {
  const products = makeProducts()
  const tmp = await Deno.makeTempDir({
    dir: getTemporaryFolder(import.meta.url),
    prefix: 'space-barrel-probe-',
  })

  // Preact comets — but the REACT client entry (`modules/client/mod.ts`'s `hydrateComets`), which
  // is the exact import every README example shows.
  console.error(
    'Building: Preact comets + React client barrel (the documented-by-default entry)...',
  )
  await buildCometsClient({
    root: REPO_ROOT,
    outDir: tmp,
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
      // THE MISMATCH — React's barrel instead of `preact/client-entry-comets.ts`.
      'client-entry': join(
        REPO_ROOT,
        'src/@tests/benchmarks/space/scenario/react/client-entry-comets.ts',
      ),
    },
  })

  const html = await renderVariantPreactComets(
    products,
    join(tmp, 'comets-manifest.json'),
    await findBuiltAsset(join(tmp, 'assets'), 'client-entry'),
    // deno-lint-ignore no-explicit-any
    PreactLikeButtonComet as any,
    // deno-lint-ignore no-explicit-any
    PreactNewsletterComet as any,
    // deno-lint-ignore no-explicit-any
    PreactCartComet as any,
  )

  const server = serveVariant({ html, assetsRoot: join(tmp, 'assets') })
  const port = (server.addr as Deno.NetAddr).port
  const browser = await chromium.launch()
  const page = await browser.newPage()

  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on('console', (m: { type(): string; text(): string }) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e: Error) => pageErrors.push(e.message))

  // Unhandled promise rejections are the one channel `hydrateComets` could fail through without
  // surfacing anywhere else: it fires each boundary's dynamic `import()` without awaiting them.
  await page.addInitScript(() => {
    ;(globalThis as unknown as { __rejections: string[] }).__rejections = []
    globalThis.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
      ;(globalThis as unknown as { __rejections: string[] }).__rejections.push(
        String(e.reason?.message ?? e.reason),
      )
    })
  })

  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load', timeout: 15_000 })
  await page.waitForTimeout(2500)

  // Is the server-rendered content still on the page, and is a comet actually interactive?
  const probe = await page.evaluate(() => {
    const button = document.querySelector('[data-testid="like-0"]') as HTMLButtonElement | null
    const before = button?.textContent ?? null
    button?.click()
    return {
      boundaries: document.querySelectorAll('[data-comet]').length,
      likeButtonPresent: button !== null,
      textBeforeClick: before,
      productCardsStillRendered: document.querySelectorAll('article, [data-product]').length,
      bodyTextLength: document.body.innerText.length,
    }
  })
  await page.waitForTimeout(500)
  const afterClick = await page.evaluate(() =>
    document.querySelector('[data-testid="like-0"]')?.textContent ?? null
  )

  console.log("\n=== Probe: Preact comets hydrated by React's client barrel ===\n")
  console.log('comet boundaries in DOM: ', probe.boundaries)
  console.log('LikeButton present:      ', probe.likeButtonPresent)
  console.log('text before click:       ', JSON.stringify(probe.textBeforeClick))
  console.log('text after click:        ', JSON.stringify(afterClick))
  console.log(
    'became interactive:      ',
    probe.textBeforeClick !== null && afterClick !== null &&
      probe.textBeforeClick !== afterClick,
  )
  console.log('SSR content still shown: ', probe.bodyTextLength, 'chars of body text')
  console.log('\nconsole errors:', consoleErrors.length)
  for (const e of consoleErrors.slice(0, 6)) console.log('  -', e.slice(0, 200))
  console.log('uncaught page errors:', pageErrors.length)
  for (const e of pageErrors.slice(0, 6)) console.log('  -', e.slice(0, 200))

  const rejections = await page.evaluate(() =>
    (globalThis as unknown as { __rejections: string[] }).__rejections ?? []
  )
  console.log('unhandled rejections:', rejections.length)
  for (const r of rejections.slice(0, 6)) console.log('  -', String(r).slice(0, 220))

  await browser.close()
  await server.shutdown()
  Deno.exit(0)
}

await main()
