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
 * Browser spike: does a Comet's client state actually survive an Orbit A → B → A navigation?
 *
 * The repo already has `persist`, an LRU retention cache, unit tests for both, and a confirmed
 * `data-orbit-persist` marker in real SSR output. None of that is evidence that state survives —
 * it is evidence that the machinery exists. This drives a real browser through a real client-side
 * navigation and reads the component's own rendered state afterwards.
 *
 * ## What this is, and is not
 *
 * A **manual spike/harness — not an automated benchmark, and not a test.** `deno test` only
 * collects `src/@tests/**\/*.test.ts(x)` and `deno bench` only collects
 * `benchmarks/renderer/**\/*.bench.ts`, so neither picks this up, and nothing invokes it. It never
 * runs in CI. Run it by hand, from the package root:
 *
 * ```sh
 * deno task spike:persistence
 * ```
 *
 * The task exists only to make this discoverable — a manual spike that nothing references is a
 * manual spike nobody remembers. Having a task changes none of the above: it is still not in CI,
 * still not in `deno test`, and still not a package dependency.
 *
 * It produces **no performance metrics** — only boolean observations printed to stdout. Nothing in
 * this package's acceptance criteria depends on it, and a green suite does not depend on it having
 * been run.
 *
 * ## What it covers that the automated suite cannot
 *
 * Two things, both requiring a real DOM and a real client-side navigation, and neither reachable
 * from `deno test`:
 *
 * 1. **`reuseRetainedComets`** — the third read site for `data-comet-props`, alongside the two
 *    hydrate modules. No automated test touches it; `unit/client/comet-persistence.test.ts` says so
 *    in its own header, and explains why (this project carries no DOM shim, deliberately).
 * 2. **A real Orbit A → B → A round trip on both renderers**, with the un-persisted twin resetting
 *    as the control that proves the navigation genuinely tore the region down.
 *
 * Since the extended-types codec landed, this also happens to be the only place its decoding was
 * verified through `reuseRetainedComets` — the comet renders `date:` only when its `when` prop
 * arrived as a real `Date`.
 *
 * ## Standing position
 *
 * **There is currently a known, documented automated-coverage gap at `reuseRetainedComets`.** That
 * is a statement of fact, not a permanent acceptance: if Space ever adopts a stable browser
 * harness, this scenario should become a real automated test. Until then it is not one, and it
 * must not be turned into one here — doing so would mean taking Playwright as a package dependency
 * and standing up new testing infrastructure, both explicitly out of scope. Playwright stays a
 * dev-time `npm:` import inside this one script.
 *
 * ## Design notes that matter for trusting the result
 *
 * - Pages are real `SpacePageController`s rendered through the REAL page renderer, so the outlet
 *   marker, the fragment path and the `x-space-navigate` protocol are the production ones.
 * - Two identical counters differ ONLY in whether their call site passes `persist`. That is the
 *   single variable; the un-persisted one is the control.
 * - Both renderers run the same script, the same assertions and the same page objects.
 *
 * @module
 */

import { chromium } from 'npm:playwright-core@1.62.1'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { createElement as reactElement } from 'react'
import { createElement as preactElement } from 'preact'
import type { ComponentType as ReactComponentType } from 'react'
import { buildCometsClient } from '../variants/build-comets-client.ts'
import { findBuiltAsset } from '../variants/static-server.ts'
import { SpacePageController } from 'modules/router/mod.ts'
import { setPageTree } from 'modules/router/page-tree-registry.ts'
import { setCometManifest } from 'modules/comets/comet-manifest.ts'
// Both renderer runtimes: `@zanix/space` ships none since the entry-point split, and this harness
// renders by hand without ever reaching `defineSpaceApp`. Installed per renderer, right where the
// active one is selected — one process here renders both, and installing swaps the page/not-found
// renderer wholesale (the Comet element factory keeps one slot per renderer, so both stay usable).
import { installReactRuntime } from '../../../../../mod-react.ts'
import { installPreactRuntime } from '../../../../../mod-preact.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { setExtendedSerialization } from 'modules/render/serialization-registry.ts'
import { mockPageContext } from 'modules/testing/mod.ts'
import { ORBIT_FRAGMENT_HEADER } from 'modules/router/orbit-protocol.ts'

const REPO_ROOT = Deno.cwd()
const DIR = 'src/@tests/benchmarks/space/persistence'

type Renderer = 'react' | 'preact'

interface Result {
  renderer: Renderer
  persistAfterRoundTrip: string | null
  plainAfterRoundTrip: string | null
  persistBeforeNav: string | null
  plainBeforeNav: string | null
  dateDecodedAfterRoundTrip: boolean
  navigatedToB: boolean
  returnedToA: boolean
  consoleErrors: string[]
  pageErrors: string[]
}

async function runRenderer(renderer: Renderer): Promise<Result> {
  const outDir = await Deno.makeTempDir({
    dir: getTemporaryFolder(import.meta.url),
    prefix: `space-persist-${renderer}-`,
  })
  const cometFile = renderer === 'react' ? 'comets.tsx' : 'comets-preact.ts'
  const entryFile = renderer === 'react' ? 'client-entry-react.ts' : 'client-entry-preact.ts'

  await buildCometsClient({
    root: REPO_ROOT,
    outDir,
    renderer,
    compiler: false,
    comets: {
      counters: join(REPO_ROOT, `${DIR}/${cometFile}`),
      'client-entry': join(REPO_ROOT, `${DIR}/${entryFile}`),
    },
  })

  if (renderer === 'preact') installPreactRuntime()
  else installReactRuntime()
  setActiveRenderer(renderer)
  // The spike doubles as the only real-browser coverage of the extended-types codec
  // reaching `reuseRetainedComets` — the third `data-comet-props` read site, which a
  // `deno test` cannot exercise (no DOM). The comet renders `date:` only if its `when`
  // prop arrived as a real Date.
  setExtendedSerialization(true)
  setCometManifest(
    JSON.parse(await Deno.readTextFile(join(outDir, 'comets-manifest.json'))),
  )
  const entryAsset = await findBuiltAsset(join(outDir, 'assets'), 'client-entry')

  // The real comet wrappers, imported AFTER the manifest is set (their module URLs are resolved
  // through it at render time, not at import time — but keeping the order explicit avoids relying
  // on that).
  const mod = renderer === 'react'
    ? await import(`../persistence/comets.tsx`)
    : await import(`../persistence/comets-preact.ts`)
  const PersistComet = mod.default as ReactComponentType<Record<string, unknown>>
  const PlainComet = mod.PlainComet as ReactComponentType<Record<string, unknown>>

  const h = renderer === 'react' ? reactElement : preactElement

  // deno-lint-ignore no-explicit-any
  const el = (type: any, props: Record<string, unknown> | null, ...kids: unknown[]) =>
    (h as (...a: unknown[]) => unknown)(type, props, ...kids)

  /** Page A — both counters plus a real same-origin link Orbit will intercept. */
  const PageABody = () =>
    el('div', null, [
      el('h1', { key: 'h' }, 'Page A'),
      // `persist` is the ONLY difference between these two call sites.
      el(PersistComet, { key: 'p', persist: 'counter-a', when: new Date('2026-08-17T00:00:00Z') }),
      el(PlainComet, { key: 'q' }),
      el('a', { key: 'l', href: '/b', 'data-testid': 'to-b' }, 'go to B'),
    ])

  /** Page B — no comets at all, so returning to A is a genuine re-render of A's region. */
  const PageBBody = () =>
    el('div', null, [
      el('h1', { key: 'h' }, 'Page B'),
      el('a', { key: 'l', href: '/', 'data-testid': 'to-a' }, 'back to A'),
    ])

  class PageA extends SpacePageController {
    // deno-lint-ignore no-explicit-any
    public override component = PageABody as any
  }
  class PageB extends SpacePageController {
    // deno-lint-ignore no-explicit-any
    public override component = PageBBody as any
  }
  setPageTree(PageA, { filePath: '/fake/routes/page.tsx', segments: [] })
  setPageTree(PageB, { filePath: '/fake/routes/b/page.tsx', segments: [] })

  const { renderPageResponse } = renderer === 'react'
    ? await import('modules/router/render-page-react.tsx')
    : await import('modules/router/render-page-preact.ts')

  async function renderPage(which: 'a' | 'b', fragmentOnly: boolean): Promise<string> {
    const Target = which === 'a' ? PageA : PageB
    const Body = which === 'a' ? PageABody : PageBBody
    const response = await renderPageResponse(
      // deno-lint-ignore no-explicit-any
      Target as any,
      Body,
      mockPageContext(),
      undefined,
      fragmentOnly,
      undefined,
      undefined,
    )
    let html = await response.text()
    if (!fragmentOnly) {
      // The built client entry, injected the same way the real document shell would.
      html = html.replace('</body>', `<script type="module" src="${entryAsset}"></script></body>`)
    }
    return html
  }

  const pages = {
    aFull: await renderPage('a', false),
    aFragment: await renderPage('a', true),
    bFull: await renderPage('b', false),
    bFragment: await renderPage('b', true),
  }

  const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    const url = new URL(req.url)
    const isFragment = req.headers.get(ORBIT_FRAGMENT_HEADER) !== null
    if (url.pathname === '/') {
      return new Response(isFragment ? pages.aFragment : pages.aFull, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }
    if (url.pathname === '/b') {
      return new Response(isFragment ? pages.bFragment : pages.bFull, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }
    if (url.pathname.startsWith('/assets/')) {
      try {
        const file = await Deno.readFile(join(outDir, url.pathname))
        return new Response(file, { headers: { 'content-type': 'text/javascript' } })
      } catch {
        return new Response('not found', { status: 404 })
      }
    }
    return new Response('not found', { status: 404 })
  })
  const port = (server.addr as Deno.NetAddr).port

  const browser = await chromium.launch()
  const page = await browser.newPage()
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on('console', (m: { type(): string; text(): string }) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e: Error) => pageErrors.push(e.message))

  const text = (sel: string) =>
    page.evaluate(
      (s: string) => document.querySelector(s)?.textContent ?? null,
      sel,
    ) as Promise<string | null>

  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load', timeout: 20_000 })
  await page.waitForTimeout(1200)

  // Drive both counters to a non-default value, so "survived" cannot be confused with "reset".
  await page.click('[data-testid="persist-counter"]')
  await page.click('[data-testid="persist-counter"]')
  await page.click('[data-testid="plain-counter"]')
  await page.waitForTimeout(300)
  const persistBeforeNav = await text('[data-testid="persist-counter"]')
  const plainBeforeNav = await text('[data-testid="plain-counter"]')

  // A → B, through a real Orbit-intercepted link click (never page.goto, which would be a full
  // document load and would prove nothing about client-side navigation).
  await page.click('[data-testid="to-b"]')
  await page.waitForTimeout(900)
  const navigatedToB = (await page.evaluate(() => location.pathname)) === '/b'

  // B → A.
  await page.click('[data-testid="to-a"]')
  await page.waitForTimeout(1200)
  const returnedToA = (await page.evaluate(() => location.pathname)) === '/'

  const persistAfterRoundTrip = await text('[data-testid="persist-counter"]')
  const dateDecodedAfterRoundTrip = (persistAfterRoundTrip ?? '').includes('date:2026')
  const plainAfterRoundTrip = await text('[data-testid="plain-counter"]')

  await browser.close()
  await server.shutdown()

  return {
    renderer,
    persistBeforeNav,
    plainBeforeNav,
    persistAfterRoundTrip,
    plainAfterRoundTrip,
    dateDecodedAfterRoundTrip,
    navigatedToB,
    returnedToA,
    consoleErrors,
    pageErrors,
  }
}

const results: Result[] = []
for (const renderer of ['react', 'preact'] as const) {
  console.error(`\n=== ${renderer} ===`)
  try {
    results.push(await runRenderer(renderer))
  } catch (error) {
    console.error(`FAILED for ${renderer}:`, error)
  }
}

console.log('\n\n=== Comet state across a real Orbit A → B → A navigation ===\n')
for (const r of results) {
  console.log(`--- ${r.renderer} ---`)
  console.log(`  navigation actually happened:  A→B ${r.navigatedToB}, B→A ${r.returnedToA}`)
  console.log(`  persist counter  before nav:   ${JSON.stringify(r.persistBeforeNav)}`)
  console.log(`  persist counter  after  A→B→A: ${JSON.stringify(r.persistAfterRoundTrip)}`)
  console.log(`  plain   counter  before nav:   ${JSON.stringify(r.plainBeforeNav)}`)
  console.log(`  plain   counter  after  A→B→A: ${JSON.stringify(r.plainAfterRoundTrip)}`)
  const persisted = r.persistBeforeNav !== null &&
    r.persistAfterRoundTrip === r.persistBeforeNav
  const plainReset = r.plainAfterRoundTrip === 'plain:0'
  console.log(`  => persist SURVIVED:           ${persisted}`)
  console.log(`  => plain RESET (control):      ${plainReset}`)
  console.log(
    `  => Date decoded after A→B→A:   ${r.dateDecodedAfterRoundTrip}  (codec through reuseRetainedComets)`,
  )
  console.log(`  console errors: ${r.consoleErrors.length}, page errors: ${r.pageErrors.length}`)
  for (const e of r.consoleErrors.slice(0, 3)) console.log(`     - ${e.slice(0, 160)}`)
  for (const e of r.pageErrors.slice(0, 3)) console.log(`     ! ${e.slice(0, 160)}`)
  console.log()
}

Deno.exit(0)
