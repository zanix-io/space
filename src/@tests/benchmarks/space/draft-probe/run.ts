// deno-lint-ignore-file deno-zanix-plugin/no-znx-console no-await-in-loop
// `console` on purpose: a hand-run CLI report, not library code (see `persistence/run.ts`'s own
// header for the full exemption). Every loop is sequential by design: renderer selection and the
// comet manifest are process-global state, and each browser run needs the machine to itself.
/**
 * Browser spike: does the draft probe mark a form as restoring BEFORE the first paint, under the
 * default CSP, on a full load and on an Orbit navigation? And does `ManagedForm`'s
 * `focusFirstInvalid` put the focus on the first control the server rendered as invalid, bring it
 * into view, and stay out of the way of a restored draft, a visitor already typing, reduced motion
 * and `ScrollRestoration`?
 *
 * A manual harness, not a test and not a benchmark: nothing in `deno test` or CI runs it. Pages are
 * real `SpacePageController`s through the real page renderer, the real shipped `ManagedForm` comet,
 * the real client entry and Orbit, and the default nonce-based CSP the framework applies
 * (`default-src 'self'; script-src 'self' 'nonce-<per request>'; style-src` with the same nonce).
 *
 * ```sh
 * deno task spike:draft-probe            # automated run in the installed Google Chrome
 * deno task spike:draft-probe -- --serve # serve the pages, then open the printed URL in any Chrome
 * ```
 *
 * `--serve` prints one URL per renderer. Each page shows a live log of what the page observed
 * (mark set/removed with timestamps against the first paint, CSP violations, whether the document
 * was loaded again), so the checks need no DevTools. The steps and the expected log are in
 * `docs/form-drafts.md`, "Checking the probe in a real browser".
 *
 * @module
 */

import { chromium } from 'npm:playwright-core@1.62.1'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { createElement as reactElement } from 'react'
import { createElement as preactElement } from 'preact'
import { buildCometsClient } from '../variants/build-comets-client.ts'
import { findBuiltAsset } from '../variants/static-server.ts'
import { SpacePageController } from 'modules/router/mod.ts'
import { setPageTree } from 'modules/router/page-tree-registry.ts'
import { setCssManifest } from 'modules/render/css-manifest.ts'
import { setCometManifest } from 'modules/comets/comet-manifest.ts'
import { CLIENT_ENTRY_VIRTUAL_ID, setClientEntryManifest } from 'modules/render/client-entry.ts'
import {
  setModulePreloadEnabled,
  setModulePreloadManifest,
} from 'modules/render/modulepreload-manifest.ts'
import { installReactRuntime } from '../../../../../mod-react.ts'
import { installPreactRuntime } from '../../../../../mod-preact.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { mockPageContext } from 'modules/testing/mod.ts'
import { ORBIT_FRAGMENT_HEADER } from 'modules/router/orbit-protocol.ts'
import { normalizeCspSignature } from 'modules/router/csp-signature.ts'
import { DraftProbe } from 'modules/comets/draft-probe-element.ts'
import {
  resetInitialStatePolicy,
  setInitialStatePolicy,
} from 'modules/render/serialization-registry.ts'
import { parseStateOption } from 'modules/render/initial-state-policy.ts'

const REPO_ROOT = Deno.cwd()
const PERSISTENCE_DIR = 'src/@tests/benchmarks/space/persistence'
const FORM_ID = 'draft-form'
const STORAGE_KEY = 'fixture/draft'
const ERRORS_FORM_ID = 'errors-form'
const ERRORS_STORAGE_KEY = 'fixture/errors'
const STATE_FORM_ID = 'state-form'
const STATE_STORAGE_KEY = 'fixture/state'
/** A message catalog of the size a real page carries: only the server renders with it. */
const CATALOG: Record<string, string> = Object.fromEntries(
  Array.from(
    { length: 400 },
    (_, index) => [`catalog/key-${index}`, `Catalog message number ${index}`],
  ),
)
const GREETING = 'Hola desde el catalogo'
/** How long the client bundle takes to arrive. The marked form has to be painted in the meantime,
 * which is what a visitor on a real connection sees: with the bundle served instantly the form is
 * restored before the first paint and no skeleton would ever show. */
const CLIENT_DELAY_MS = 600
const SERVE_ONLY = Deno.args.includes('--serve')

type Renderer = 'react' | 'preact'

/** Runs in `<head>`, before any page content, and records what the page observes. */
const OBSERVER_SOURCE = `
(function () {
  var log = (window.__draftLog = [])
  var start = performance.now()
  var stamp = function (message) { log.push((performance.now() - start).toFixed(1) + 'ms ' + message) }
  window.__documentLoads = (Number(sessionStorage.getItem('fixture-loads')) || 0) + 1
  sessionStorage.setItem('fixture-loads', String(window.__documentLoads))
  new MutationObserver(function (records) {
    records.forEach(function (record) {
      var target = record.target
      if (!target.getAttribute) return
      var value = target.getAttribute('data-draft-restoring')
      stamp(value === null ? 'MARK REMOVED' : 'MARK SET on <' + target.tagName.toLowerCase() + '> ' + value)
    })
  }).observe(document, { attributes: true, attributeFilter: ['data-draft-restoring'], subtree: true })
  new PerformanceObserver(function (list) {
    list.getEntries().forEach(function (entry) { stamp('PAINT ' + entry.name) })
  }).observe({ type: 'paint', buffered: true })
  document.addEventListener('securitypolicyviolation', function (event) {
    stamp('CSP VIOLATION ' + event.violatedDirective + ' ' + event.blockedURI)
  })
  document.addEventListener('focusin', function (event) {
    var target = event.target
    var label = target.name || target.id || target.tagName
    stamp('FOCUS ' + label + ' value=' + (target.value === undefined ? '' : target.value))
    setTimeout(function () { stamp('SCROLL@40ms y=' + Math.round(window.scrollY)) }, 40)
    setTimeout(function () { stamp('SCROLL@end y=' + Math.round(window.scrollY)) }, 1800)
  })
  stamp('document load #' + window.__documentLoads)
})()`

/** Runs last: shows the log on the page, live, so a visitor needs no DevTools. */
const PANEL_SOURCE = `
(function () {
  var panel = document.getElementById('log')
  var show = function () { panel.textContent = (window.__draftLog || []).join('\\n') }
  setInterval(show, 250)
})()`

async function main(): Promise<void> {
  if (SERVE_ONLY) {
    const renderer = Deno.args.includes('--preact') ? 'preact' : 'react'
    const { port } = await startFixture(renderer)
    console.log(`${renderer}: http://localhost:${port}/`)
    console.log('\nServing. Press Ctrl+C to stop. Pass --preact to serve the Preact build.')
    await new Promise(() => {})
  }

  const results: Record<string, boolean | string> = {}
  const browser = await chromium.launch({ channel: 'chrome' })
  // One renderer at a time: the active renderer is process-global state.
  for (const renderer of ['react', 'preact'] as const) {
    const { port, stop } = await startFixture(renderer)
    await checkRenderer(browser, renderer, port, results)
    await checkFocusFirstInvalid(browser, renderer, port, results)
    await checkState(browser, renderer, port, results)
    await checkLayoutStyles(browser, renderer, port, results)
    await checkModulePreload(browser, renderer, port, results)
    await stop()
  }
  await browser.close()

  console.log(
    '\n=== Draft probe, focusFirstInvalid, serialization.state, layout styles and module preloads in a real browser ===\n',
  )
  let failed = false
  for (const [name, ok] of Object.entries(results)) {
    if (ok !== true) failed = true
    console.log(`  ${ok === true ? 'PASS' : 'FAIL'}  ${name}${ok === true ? '' : `  (${ok})`}`)
  }
  Deno.exit(failed ? 1 : 0)
}

/**
 * Records, the first time each marker element exists, the colour it computes at that very moment:
 * right after an Orbit swap inserts it, before any later load could change the answer.
 */
const STYLE_OBSERVER_SOURCE = `
  window.__swapStyle = {};
  new MutationObserver(function () {
    document.querySelectorAll('[class^="marker-"]').forEach(function (el) {
      var key = el.className + '@' + document.querySelector('h1').textContent;
      if (!(key in window.__swapStyle)) window.__swapStyle[key] = getComputedStyle(el).color;
    });
  }).observe(document, { childList: true, subtree: true });
`

async function checkLayoutStyles(
  // deno-lint-ignore no-explicit-any
  browser: any,
  renderer: Renderer,
  port: number,
  results: Record<string, boolean | string>,
) {
  const name = (label: string) => `${renderer}: layout styles: ${label}`
  const base = `http://localhost:${port}`
  const context = await browser.newContext()
  const page = await context.newPage()
  const problems: string[] = []
  page.on('pageerror', (error: Error) => problems.push(`pageerror: ${error.message}`))
  page.on('console', (message: { type: () => string; text: () => string }) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`)
  })
  const stylesheets = (): Promise<string[]> =>
    page.evaluate(() =>
      [...document.querySelectorAll('link[rel="stylesheet"]')].map((link) =>
        new URL((link as HTMLLinkElement).href).pathname
      )
    )
  const colorOf = (selector: string): Promise<string | null> =>
    page.evaluate((sel: string) => {
      const el = document.querySelector(sel)
      return el ? getComputedStyle(el).color : null
    }, selector)
  const swapColor = (key: string): Promise<string | undefined> =>
    page.evaluate(
      (k: string) => (window as never as { __swapStyle: Record<string, string> }).__swapStyle[k],
      key,
    )
  const hits = (): Promise<Record<string, number>> =>
    page.evaluate(async () => await (await fetch('/__hits')).json())
  const goTo = async (testId: string, heading: string) => {
    await page.click(`[data-testid=${testId}]`)
    await page.waitForFunction(
      (h: string) => document.querySelector('h1')?.textContent === h,
      heading,
      { timeout: 8000 },
    )
  }

  // A full document: the layouts' stylesheets link root layout first, and they apply.
  await page.goto(`${base}/one`, { waitUntil: 'load' })
  await page.waitForTimeout(1500)
  results[name('a full document links the root layout, then the nearest layout')] =
    JSON.stringify(await stylesheets()) === JSON.stringify(['/css/root.css', '/css/one.css'])
  results[name('the layouts styles apply to the document')] =
    (await colorOf('.marker-root')) === 'rgb(10, 20, 30)' &&
    (await colorOf('.marker-one')) === 'rgb(1, 2, 3)'
  await page.evaluate(() => {
    ;(window as never as { __sameDocument: boolean }).__sameDocument = true
  })

  // Inside one layout: no new link, no new request, no reload.
  await goTo('to-one-next', 'one-next')
  const afterSameLayout = await stylesheets()
  const sameLayoutHits = await hits()
  results[name('navigating inside the same layout inserts no stylesheet')] =
    JSON.stringify(afterSameLayout) === JSON.stringify(['/css/root.css', '/css/one.css'])
  results[name('navigating inside the same layout requests no stylesheet again')] =
    sameLayoutHits['/css/root.css'] === 1 && sameLayoutHits['/css/one.css'] === 1
  results[name('navigating inside the same layout is a client navigation')] = await page.evaluate(
    () => (window as never as { __sameDocument?: boolean }).__sameDocument === true,
  )

  // Into another area: its layout stylesheet is inserted, and the swap waits for it.
  await goTo('to-two', 'two')
  results[name('entering another area inserts that layout stylesheet once')] =
    (await stylesheets()).filter((href) => href === '/css/two.css').length === 1
  results[name('the new area is styled at the moment the swap inserts it')] =
    (await swapColor('marker-two@two')) === 'rgb(7, 8, 9)'
  results[name('the shared root layout stylesheet is not requested again')] =
    (await hits())['/css/root.css'] === 1
  results[name('entering another area is a client navigation')] = await page.evaluate(
    () => (window as never as { __sameDocument?: boolean }).__sameDocument === true,
  )

  // Control: a stylesheet declared through a layout's `head` link is neither carried by the Orbit
  // fragment nor waited for, so the new area is unstyled when it appears.
  await goTo('to-head', 'head')
  results[name('control: a head link is not carried by an Orbit navigation')] =
    !(await stylesheets()).includes('/css/head.css')
  results[name('control: the area is unstyled when the swap inserts it')] =
    (await swapColor('marker-head@head')) !== 'rgb(4, 5, 6)'
  await page.goto(`${base}/head`, { waitUntil: 'load' })
  await page.waitForTimeout(1000)
  results[name('control: the same head link does apply on a full document')] =
    (await colorOf('.marker-head')) === 'rgb(4, 5, 6)'

  results[name('no console or page errors, CSP included')] = problems.length === 0
    ? true
    : problems.join(' | ')
  await context.close()
}

/**
 * Module preloads, in a real browser: the head order, what the browser fetches and when, the
 * default CSP, and an Orbit navigation. `/preload` has the preloads on; `/preload-off` is the
 * control with them off, where each comet chunk is requested only after the entry has run.
 */
async function checkModulePreload(
  // deno-lint-ignore no-explicit-any
  browser: any,
  renderer: Renderer,
  port: number,
  results: Record<string, boolean | string>,
) {
  const name = (label: string) => `${renderer}: module preload: ${label}`
  const base = `http://localhost:${port}`
  const context = await browser.newContext()
  const page = await context.newPage()
  const problems: string[] = []
  page.on('pageerror', (error: Error) => problems.push(`pageerror: ${error.message}`))
  page.on('console', (message: { type: () => string; text: () => string }) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`)
  })
  type Asset = { path: string; at: number; done: number }
  const assets = (): Promise<Asset[]> =>
    page.evaluate(async () => await (await fetch('/__assets')).json())
  const reset = () => page.evaluate(async () => await fetch('/__assets/reset'))
  /** Every link in document order: `s:<href>` for a stylesheet, `m:<href>` for a preload. React
   * hoists them into `<head>`; Preact leaves a preload where its comet renders. */
  const headLinks = (): Promise<string[]> =>
    page.evaluate(() =>
      [...document.querySelectorAll('link')].map((l) => {
        const rel = l.getAttribute('rel')
        return `${rel === 'stylesheet' ? 's' : rel === 'modulepreload' ? 'm' : '?'}:${
          new URL(l.href).pathname
        }`
      })
    )
  const hydrated = (): Promise<boolean> =>
    page.evaluate(() => {
      const boundaries = [...document.querySelectorAll('[data-comet]')]
      // Preact marks a hydrated root with `__k`; React puts a `__reactContainer$…` key on it.
      return boundaries.length > 0 && boundaries.every((b) =>
        // deno-lint-ignore no-explicit-any
        (b as any).__k || (b as any)._children ||
        Object.keys(b).some((key) => key.startsWith('__reactContainer'))
      )
    })

  // The control first: with the option off, a comet chunk is asked for only once the entry ran.
  await page.goto(`${base}/preload-off`, { waitUntil: 'load' })
  await page.waitForFunction(() => document.querySelector('[data-comet]') !== null)
  await page.waitForTimeout(2500)
  const control = await assets()
  const controlEntry = control.find((a) => /client-entry-/.test(a.path))
  const controlComets = control.filter((a) => !/client-entry-/.test(a.path))
  results[name('control: with the option off the page links no modulepreload of its own')] =
    !(await headLinks()).some((l) => l.startsWith('m:') && !/client-entry-/.test(l))
  results[name('control: without preloads a comet chunk waits for the entry to arrive')] =
    controlEntry !== undefined && controlComets.length > 0 &&
    controlComets.every((a) => a.at >= controlEntry.done)

  // The page with the preloads on.
  await reset()
  await page.goto(`${base}/preload`, { waitUntil: 'load' })
  await page.waitForFunction(() => document.querySelector('[data-comet]') !== null)
  await page.waitForTimeout(2500)
  const links = await headLinks()
  const firstPreload = links.findIndex((l) => l.startsWith('m:'))
  const lastSheet = links.map((l) => l.startsWith('s:')).lastIndexOf(true)
  results[name('the document links the page stylesheet')] = lastSheet !== -1
  results[name('every stylesheet comes before every modulepreload in the document')] =
    firstPreload !== -1 && lastSheet !== -1 && lastSheet < firstPreload
  const preloadHrefs = links.filter((l) => l.startsWith('m:'))
  results[name('each preload URL is linked once')] = preloadHrefs.length > 0 &&
    new Set(preloadHrefs).size === preloadHrefs.length

  const log = await assets()
  const entry = log.find((a) => /client-entry-/.test(a.path))
  const comets = log.filter((a) => !/client-entry-/.test(a.path))
  results[name('every asset is requested exactly once')] = log.length > 0 &&
    new Set(log.map((a) => a.path)).size === log.length
  results[name('the comet chunks are requested before the entry has arrived')] =
    entry !== undefined && comets.length > 0 && comets.every((a) => a.at < entry.done)
  const noPreloadHits = controlComets.length
  results[name('the comets are hydrated')] = await hydrated()
  results[name('the same chunks load with or without preloads')] =
    new Set(comets.map((a) => a.path)).size === new Set(controlComets.map((a) => a.path)).size &&
    noPreloadHits > 0
  const violations = await page.evaluate(() =>
    ((window as never as { __draftLog?: string[] }).__draftLog ?? []).filter((l) =>
      l.includes('CSP VIOLATION')
    )
  )
  results[name('the default CSP (script-src self + nonce) blocks none of them')] =
    violations.length === 0 ? true : violations.join(' | ')

  // An Orbit navigation to another page with comets: no chunk is fetched twice, no error.
  await page.evaluate(() => {
    ;(window as never as { __sameDocument: boolean }).__sameDocument = true
  })
  await page.click('[data-testid=to-errors]')
  await page.waitForFunction(
    () => document.querySelector('h1')?.textContent === 'Errors fixture',
    undefined,
    {
      timeout: 8000,
    },
  )
  await page.waitForTimeout(1500)
  const afterOrbit = await assets()
  results[name('an Orbit navigation is a client navigation')] = await page.evaluate(
    () => (window as never as { __sameDocument?: boolean }).__sameDocument === true,
  )
  results[name('an Orbit navigation fetches no chunk twice')] =
    new Set(afterOrbit.map((a) => a.path)).size === afterOrbit.length

  results[name('no console or page errors, CSP included')] = problems.length === 0
    ? true
    : problems.join(' | ')
  await context.close()
}

async function checkRenderer(
  // deno-lint-ignore no-explicit-any
  browser: any,
  renderer: Renderer,
  port: number,
  results: Record<string, boolean | string>,
) {
  const page = await browser.newPage()
  const base = `http://localhost:${port}`
  const log = (): Promise<string[]> =>
    page.evaluate(() => (window as never as { __draftLog: string[] }).__draftLog)
  const pageErrors: string[] = []
  page.on('pageerror', (error: Error) => pageErrors.push(error.message))

  // 1. A clean form is never marked.
  await page.goto(`${base}/`, { waitUntil: 'load' })
  await page.waitForTimeout(1800)
  results[`${renderer}: clean form leaves no mark`] = !(await log()).some((l) => l.includes('MARK'))

  // 2. Typing saves a draft.
  await page.fill(`#${FORM_ID} input[name=title]`, 'unsent text')
  await page.waitForTimeout(900)

  // 3. A full load comes back to the unsent draft: marked before the first paint, no CSP
  // violation, the field restored, the mark gone.
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(1800)
  const reloadLog = await log()
  const setAt = reloadLog.findIndex((l) => l.includes('MARK SET'))
  const paintAt = reloadLog.findIndex((l) => l.includes('PAINT'))
  results[`${renderer}: full load marks the form`] = setAt !== -1
  results[`${renderer}: a first paint was observed`] = paintAt !== -1
  results[`${renderer}: full load marks it before the first paint`] = setAt !== -1 &&
    paintAt !== -1 && setAt < paintAt
  const removedAt = reloadLog.findIndex((l) => l.includes('MARK REMOVED'))
  results[`${renderer}: the form is still marked when the first paint happens`] = setAt !== -1 &&
    paintAt !== -1 && removedAt > paintAt
  results[`${renderer}: full load has no CSP violation`] = !reloadLog.some((l) =>
    l.includes('CSP VIOLATION')
  )
  results[`${renderer}: full load restores the field`] =
    (await page.inputValue(`#${FORM_ID} input[name=title]`)) === 'unsent text'
  results[`${renderer}: full load removes the mark once restored`] = reloadLog.some((l) =>
    l.includes('MARK REMOVED')
  )

  // Control: the same unsent draft on a page that renders no probe is never marked, which is what
  // gives the checks above their meaning.
  await page.goto(`${base}/?probe=0`, { waitUntil: 'load' })
  await page.waitForTimeout(1800)
  results[`${renderer}: control without the probe is not marked`] = !(await log()).some((l) =>
    l.includes('MARK')
  )
  await page.goto(`${base}/`, { waitUntil: 'load' })
  await page.waitForTimeout(1800)
  if (renderer === 'react') {
    console.log('\nlog of a full load with a saved draft:\n' + (await log()).join('\n'))
  }
  const fullLoads = await page.evaluate(() =>
    (window as never as { __documentLoads: number }).__documentLoads
  )
  const preOrbitLogLength = (await log()).length

  // 4. Orbit: away and back, with the same unsent draft, never a document load.
  await page.click('[data-testid="to-b"]')
  await page.waitForTimeout(700)
  await page.click('[data-testid="to-a"]')
  await page.waitForTimeout(900)
  const orbitLog = await log()
  const loadsAfter = await page.evaluate(() =>
    (window as never as { __documentLoads: number }).__documentLoads
  )
  const lastSet = orbitLog.map((l) => l.includes('MARK SET')).lastIndexOf(true)
  const lastRemoved = orbitLog.map((l) => l.includes('MARK REMOVED')).lastIndexOf(true)
  results[`${renderer}: Orbit navigation marks the form`] = lastSet !== -1 &&
    lastSet >= preOrbitLogLength
  results[`${renderer}: Orbit navigation removes the mark once restored`] = lastRemoved > lastSet
  results[`${renderer}: Orbit navigation has no CSP violation`] = !orbitLog
    .slice(preOrbitLogLength).some((l) => l.includes('CSP VIOLATION'))
  results[`${renderer}: Orbit navigation is client-side (one document load)`] =
    (await page.evaluate(() => location.pathname)) === '/' && loadsAfter === fullLoads
  results[`${renderer}: Orbit navigation restores the field`] =
    (await page.inputValue(`#${FORM_ID} input[name=title]`)) === 'unsent text'

  results[`${renderer}: no page errors`] = pageErrors.length === 0 || pageErrors.join(' | ')
  await page.close()
}

/** `ManagedForm`'s `focusFirstInvalid` in the real browser: full load, a clean form, a restored
 * draft, a visitor already typing, reduced motion, `ScrollRestoration` on either side of the comet,
 * and an Orbit navigation. The invalid control sits 2200px down the page, so reaching it takes a
 * scroll, and a disabled control marked invalid sits before it. */
async function checkFocusFirstInvalid(
  // deno-lint-ignore no-explicit-any
  browser: any,
  renderer: Renderer,
  port: number,
  results: Record<string, boolean | string>,
) {
  const base = `http://localhost:${port}`
  const name = (what: string) => `${renderer}: focusFirstInvalid ${what}`
  const open = async (
    path: string,
    reducedMotion: 'reduce' | 'no-preference' = 'no-preference',
  ) => {
    const context = await browser.newContext({
      reducedMotion,
      viewport: { width: 900, height: 700 },
    })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error: Error) => errors.push(error.message))
    await page.goto(`${base}${path}`, { waitUntil: 'load' })
    return { page, context, errors }
  }
  const logOf = (
    // deno-lint-ignore no-explicit-any
    page: any,
  ): Promise<string[]> =>
    page.evaluate(() => (window as never as { __draftLog: string[] }).__draftLog)
  const stateOf = (
    // deno-lint-ignore no-explicit-any
    page: any,
  ): Promise<{ active: string; top: number; bottom: number; height: number; y: number }> =>
    page.evaluate(() => {
      const active = document.activeElement as HTMLInputElement | null
      const rect = document.querySelector('[name=bad1]')?.getBoundingClientRect()
      return {
        active: active?.name || active?.tagName || '',
        top: rect?.top ?? -1,
        bottom: rect?.bottom ?? -1,
        height: innerHeight,
        y: Math.round(scrollY),
      }
    })
  const inView = (state: { top: number; bottom: number; height: number }) =>
    state.top >= 0 && state.bottom <= state.height
  const focusLines = (log: string[], control: string) =>
    log.filter((line) => line.includes(`FOCUS ${control} `))
  const scrollSample = (log: string[], at: '40ms' | 'end') => {
    const line = log.find((entry) => entry.includes(`SCROLL@${at} y=`))
    return line ? Number(line.split('y=')[1]) : NaN
  }

  // 1. A full load: the first invalid control (the disabled one skipped) has the focus and is in
  // view, once, under the default CSP.
  {
    const { page, context, errors } = await open('/errors')
    await page.waitForTimeout(3500)
    const state = await stateOf(page)
    const log = await logOf(page)
    results[name('full load focuses the first enabled invalid control')] = state.active === 'bad1'
    results[name('full load brings it into view')] = state.y > 0 && inView(state)
    results[name('full load focuses it once')] = focusLines(log, 'bad1').length === 1
    results[name('full load has no CSP violation')] = !log.some((l) => l.includes('CSP VIOLATION'))
    results[name('full load has no page errors')] = errors.length === 0 || errors.join(' | ')
    await context.close()
  }

  // 2. A clean form: nothing is focused and the page does not move.
  {
    const { page, context } = await open('/errors?mode=clean')
    await page.waitForTimeout(3500)
    const state = await stateOf(page)
    const log = await logOf(page)
    results[name('a form with no invalid control focuses nothing')] = state.active === 'BODY' &&
      !log.some((l) => l.includes('FOCUS ')) && state.y === 0
    await context.close()
  }

  // 3. A restored draft: the focus lands after the restore, on the restored value.
  {
    const { page, context } = await open('/errors?mode=draft')
    await page.evaluate(
      ([key, value]: string[]) => sessionStorage.setItem(key, value),
      [
        `zn-space:${ERRORS_STORAGE_KEY}`,
        JSON.stringify({ first: 'kept', bad1: 'restored text', bad2: '' }),
      ],
    )
    await page.reload({ waitUntil: 'load' })
    await page.waitForTimeout(3500)
    const log = await logOf(page)
    const removedAt = log.findIndex((l) => l.includes('MARK REMOVED'))
    const focusAt = log.findIndex((l) => l.includes('FOCUS bad1 '))
    results[name('with a restored draft the form is marked, then restored')] =
      log.some((l) => l.includes('MARK SET')) && removedAt !== -1
    results[name('with a restored draft the focus comes after the mark is gone')] =
      removedAt !== -1 && focusAt > removedAt
    results[name('with a restored draft the focus lands on the restored value')] = log.some((l) =>
      l.includes('FOCUS bad1 value=restored text')
    )
    results[name('with a restored draft the field keeps the restored text')] =
      (await page.inputValue('[name=bad1]')) === 'restored text'
    await context.close()
  }

  // 4. A visitor already in another field is never moved.
  {
    const { page, context } = await open('/errors?mode=steal')
    await page.waitForTimeout(3500)
    const state = await stateOf(page)
    const log = await logOf(page)
    results[name('never takes the focus from a field the visitor is already in')] =
      state.active === 'other' && focusLines(log, 'bad1').length === 0
    await context.close()
  }

  // 5. Reduced motion scrolls at once; otherwise the scroll is animated.
  {
    const { page, context } = await open('/errors', 'reduce')
    await page.waitForTimeout(3500)
    const log = await logOf(page)
    const early = scrollSample(log, '40ms')
    const final = scrollSample(log, 'end')
    results[name('under prefers-reduced-motion the scroll is instant')] = final > 0 &&
      early === final
    await context.close()
  }
  {
    const { page, context } = await open('/errors')
    await page.waitForTimeout(3500)
    const log = await logOf(page)
    const early = scrollSample(log, '40ms')
    const final = scrollSample(log, 'end')
    results[name('with motion allowed the scroll is animated')] = final > 0 && early < final
    await context.close()
  }

  // 6. ScrollRestoration on either side of the form's comet: it resets the scroll when it attaches,
  // so the focused control has to stay in view whichever hydrates last.
  for (const side of ['before', 'after', 'idle']) {
    const { page, context } = await open(`/errors?scroll=${side}`)
    await page.waitForTimeout(3500)
    const state = await stateOf(page)
    results[
      name(
        side === 'idle'
          ? `stays in view with a ScrollRestoration that hydrates later (comet="idle")`
          : `stays in view with ScrollRestoration ${side} the form's comet`,
      )
    ] = state.active === 'bad1' && state.y > 0 && inView(state)
    await context.close()
  }

  // 7. Orbit: a client-side navigation to the form focuses it, with no document load, and again on a
  // second visit.
  {
    const { page, context } = await open('/')
    await page.waitForTimeout(1800)
    const loads = () =>
      page.evaluate(() => (window as never as { __documentLoads: number }).__documentLoads)
    const before = await loads()
    await page.click('[data-testid="to-errors"]')
    await page.waitForTimeout(3500)
    let state = await stateOf(page)
    results[name('Orbit navigation focuses the first invalid control')] = state.active === 'bad1'
    results[name('Orbit navigation brings it into view')] = state.y > 0 && inView(state)
    results[name('Orbit navigation is client-side (no document load)')] =
      (await page.evaluate(() => location.pathname)) === '/errors' && (await loads()) === before
    await page.click('[data-testid="to-a"]')
    await page.waitForTimeout(1500)
    await page.click('[data-testid="to-errors"]')
    await page.waitForTimeout(3500)
    state = await stateOf(page)
    results[name('a second Orbit visit focuses it again, once per mount')] =
      state.active === 'bad1' && focusLines(await logOf(page), 'bad1').length === 2
    await context.close()
  }
}

/**
 * `serialization.state`: a page whose loader returns a message catalog, rendered through the real
 * page renderer. By default (`'none'`) nothing crosses: no state script, no global, and the page
 * still renders with the catalog on the server, hydrates, saves a draft, and navigates with Orbit
 * with no console or page error. The other modes are checked as controls: `all` serializes the
 * whole result, `omit` leaves the catalog out and `pick` lets only the title through.
 */
async function checkState(
  // deno-lint-ignore no-explicit-any
  browser: any,
  renderer: Renderer,
  port: number,
  results: Record<string, boolean | string>,
) {
  const name = (label: string) => `${renderer}: state: ${label}`
  const base = `http://localhost:${port}`
  const stateOf = (page: { evaluate: (fn: () => unknown) => Promise<unknown> }) =>
    page.evaluate(() => {
      const state = (self as never as { __ZANIX_SPACE_STATE__?: Record<string, unknown> })
        .__ZANIX_SPACE_STATE__
      return state === undefined
        ? null
        : { keys: Object.keys(state), bytes: JSON.stringify(state).length, title: state.title }
    }) as Promise<{ keys: string[]; bytes: number; title: unknown } | null>

  const context = await browser.newContext()
  const page = await context.newPage()
  const problems: string[] = []
  page.on('pageerror', (error: Error) => problems.push(`pageerror: ${error.message}`))
  page.on('console', (message: { type: () => string; text: () => string }) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`)
  })
  const log = (): Promise<string[]> =>
    page.evaluate(() => (window as never as { __draftLog: string[] }).__draftLog)

  // Controls: the other modes on the same page.
  const control = async (mode: string) => {
    await page.goto(`${base}/state?state=${mode}`, { waitUntil: 'load' })
    await page.waitForTimeout(1200)
    return await stateOf(page)
  }
  const all = await control('all')
  results[name("'all' serializes the whole loader result")] = all !== null &&
    all.keys.includes('messages') && all.keys.includes('title') && all.bytes > 10_000
  const omitted = await control('omit')
  results[name('{ omit } leaves the catalog out and keeps the title')] = omitted !== null &&
    !omitted.keys.includes('messages') && omitted.title === 'State fixture' &&
    all !== null && omitted.bytes < all.bytes / 10
  const picked = await control('pick')
  results[name('{ pick } lets only the title through')] = picked !== null &&
    picked.keys.length === 1 && picked.keys[0] === 'title'

  // The default: nothing crosses.
  await page.goto(`${base}/state`, { waitUntil: 'load' })
  await page.waitForTimeout(1800)
  results[name('by default there is no global')] = (await stateOf(page)) === null
  results[name('by default the document has no state script')] = !(await page.content()).includes(
    '__ZANIX_SPACE_STATE__',
  )
  results[name('the server render still used the catalog')] =
    (await page.textContent('#greeting')) === GREETING
  results[name('the document carries no catalog entry')] = !(await page.content()).includes(
    'catalog/key-399',
  )
  console.log(
    `  ${renderer}: state ${all?.bytes ?? '?'} bytes with 'all', ${
      omitted?.bytes ?? '?'
    } with omit, ` +
      `none by default`,
  )

  // Hydration: typing into the form saves a draft, which only the hydrated comet does.
  await page.fill(`#${STATE_FORM_ID} input[name=note]`, 'typed after hydration')
  await page.waitForTimeout(900)
  results[name('the comet hydrates and saves a draft')] = (await page.evaluate(
    (key: string) => sessionStorage.getItem(`zn-space:${key}`),
    STATE_STORAGE_KEY,
  )) !== null
  const loads = (): Promise<number> =>
    page.evaluate(() => (window as never as { __documentLoads: number }).__documentLoads)
  const before = await loads()

  // Orbit: away and back without a document load, the page renders with the catalog again.
  await page.click('[data-testid="to-b"]')
  await page.waitForTimeout(700)
  const onB = await page.evaluate(() => document.body.innerText.includes('Page B'))
  await page.goBack()
  await page.waitForTimeout(900)
  results[name('Orbit goes away and back with no document load')] = onB &&
    (await loads()) === before
  results[name('the page rendered by Orbit still shows the catalog text')] =
    (await page.textContent('#greeting')) === GREETING
  results[name('no CSP violation')] = !(await log()).some((l) => l.includes('CSP VIOLATION'))
  results[name('no console or page errors')] = problems.length === 0 || problems.join(' | ')
  await context.close()
}

async function startFixture(
  renderer: Renderer,
): Promise<{ renderer: Renderer; port: number; stop: () => Promise<void> }> {
  const outDir = await Deno.makeTempDir({
    dir: getTemporaryFolder(import.meta.url),
    prefix: `space-draft-probe-${renderer}-`,
  })
  const managedFile = renderer === 'react' ? 'managed-form-react.tsx' : 'managed-form-preact.tsx'
  const entryFile = renderer === 'react' ? 'client-entry-react.ts' : 'client-entry-preact.ts'
  const scrollFile = renderer === 'react'
    ? 'scroll-restoration-react.tsx'
    : 'scroll-restoration-preact.tsx'
  await buildCometsClient({
    root: REPO_ROOT,
    outDir,
    renderer,
    compiler: false,
    comets: {
      managed: join(REPO_ROOT, `src/modules/comets/${managedFile}`),
      scroll: join(REPO_ROOT, `src/modules/comets/${scrollFile}`),
      'client-entry': join(REPO_ROOT, `${PERSISTENCE_DIR}/${entryFile}`),
    },
  })
  if (renderer === 'preact') installPreactRuntime()
  else installReactRuntime()
  setActiveRenderer(renderer)
  setCometManifest(JSON.parse(await Deno.readTextFile(join(outDir, 'comets-manifest.json'))))
  const preloadManifest = JSON.parse(
    await Deno.readTextFile(join(outDir, 'modulepreload-manifest.json')),
  )
  const entryAsset = await findBuiltAsset(join(outDir, 'assets'), 'client-entry')
  const ManagedForm = (await import(`../../../../modules/comets/${managedFile}`)).default
  const ScrollRestoration = (await import(`../../../../modules/comets/${scrollFile}`)).default
  const { renderPageResponse } = renderer === 'react'
    ? await import('modules/router/render-page-react.tsx')
    : await import('modules/router/render-page-preact.ts')
  const h = (renderer === 'react' ? reactElement : preactElement) as (...a: unknown[]) => unknown
  // deno-lint-ignore no-explicit-any
  const el = (type: any, props: Record<string, unknown> | null, ...kids: unknown[]) =>
    h(type, props, ...kids)

  class PageA extends SpacePageController {
    // deno-lint-ignore no-explicit-any
    public override component = (() => null) as any
  }
  class PageB extends SpacePageController {
    // deno-lint-ignore no-explicit-any
    public override component = (() => null) as any
  }
  setPageTree(PageA, { filePath: '/fake/routes/page.tsx', segments: [] })
  setPageTree(PageB, { filePath: '/fake/routes/b/page.tsx', segments: [] })
  class PageC extends SpacePageController {
    // deno-lint-ignore no-explicit-any
    public override component = (() => null) as any
  }
  setPageTree(PageC, { filePath: '/fake/routes/errors/page.tsx', segments: [] })
  class PageD extends SpacePageController {
    // deno-lint-ignore no-explicit-any
    public override component = (() => null) as any
  }
  setPageTree(PageD, { filePath: '/fake/routes/state/page.tsx', segments: [] })

  // The layout-styles fixture: two areas, each under its own layout, below one root layout. `/one`
  // and `/one/next` share a layout; `/head` declares its stylesheet through the layout's `head`
  // instead of `styles`, as the control.
  const rootSegment = { layoutFilePath: '/fake/routes/layout.tsx' }
  const oneChain = [rootSegment, { layoutFilePath: '/fake/routes/one/layout.tsx' }]
  // The preload fixture: under the root layout, so its stylesheet is a page-level `<link>` in the
  // head, ahead of the preloads the comets ask for.
  class PageE extends SpacePageController {
    // deno-lint-ignore no-explicit-any
    public override component = (() => null) as any
  }
  setPageTree(PageE, { filePath: '/fake/routes/preload/page.tsx', segments: [rootSegment] })
  const makePage = () =>
    class extends SpacePageController {
      // deno-lint-ignore no-explicit-any
      public override component = (() => null) as any
    }
  const layoutPages = {
    '/one': { Target: makePage(), label: 'one', area: 'one' },
    '/one/next': { Target: makePage(), label: 'one-next', area: 'one' },
    '/two': { Target: makePage(), label: 'two', area: 'two' },
    '/head': { Target: makePage(), label: 'head', area: 'head' },
  }
  const layoutChains: Record<string, Parameters<typeof setPageTree>[1]['segments']> = {
    '/one': oneChain,
    '/one/next': oneChain,
    '/two': [rootSegment, { layoutFilePath: '/fake/routes/two/layout.tsx' }],
    '/head': [rootSegment, {
      layoutFilePath: '/fake/routes/head/layout.tsx',
      head: { link: [{ rel: 'stylesheet', href: '/css/head.css' }] },
    }],
  }
  for (const [path, { Target }] of Object.entries(layoutPages)) {
    setPageTree(Target, { filePath: `/fake/routes${path}/page.tsx`, segments: layoutChains[path] })
  }
  setCssManifest({
    global: [],
    layouts: {
      '/fake/routes/layout.tsx': ['/css/root.css'],
      '/fake/routes/one/layout.tsx': ['/css/one.css'],
      '/fake/routes/two/layout.tsx': ['/css/two.css'],
    },
  })
  // Every stylesheet answers after a delay, so a swap that does not wait for it is visible as an
  // unstyled element; `hits` counts the requests each one received.
  const LAYOUT_CSS_DELAY_MS = 350
  const layoutCss: Record<string, string> = {
    '/css/root.css': '.marker-root { color: rgb(10, 20, 30); }',
    '/css/one.css': '.marker-one { color: rgb(1, 2, 3); }',
    '/css/two.css': '.marker-two { color: rgb(7, 8, 9); }',
    '/css/head.css': '.marker-head { color: rgb(4, 5, 6); }',
  }
  const hits: Record<string, number> = {}
  /** Every `/assets/` request in arrival order with the time it arrived and when it was answered,
   * so a check can tell a chunk requested ahead of the entry from one requested after it. */
  const assetLog: { path: string; at: number; done: number }[] = []
  const serverStart = performance.now()

  /** `/preload` renders two comets that share chunks, with the module preloads on (`on`) or off
   * (the control). The client entry is registered only while it renders, so the other fixture
   * pages (which add the entry script by hand) are unchanged. */
  async function renderPreloadPage(on: boolean, fragmentOnly: boolean, nonce: string, csp: string) {
    const draft = { storageKey: 'fixture/preload', hasServerValues: false }
    const body = () =>
      el('div', null, [
        el('h1', { key: 'h' }, 'Preload fixture'),
        el('form', { key: 'f', id: 'preload-form', method: 'post' }, [
          el('input', { key: 'i', name: 'note' }),
        ]),
        el(ManagedForm, { key: 'm', formId: 'preload-form', draft }),
        el(ScrollRestoration, { key: 'sr' }),
        el('a', { key: 'l', href: '/errors', 'data-testid': 'to-errors' }, 'go to errors'),
      ])
    setModulePreloadEnabled(on)
    setModulePreloadManifest(preloadManifest)
    setClientEntryManifest({ [CLIENT_ENTRY_VIRTUAL_ID]: entryAsset })
    try {
      const response = await renderPageResponse(
        // deno-lint-ignore no-explicit-any
        PageE as any,
        body,
        mockPageContext(),
        undefined,
        fragmentOnly,
        nonce,
        undefined,
        normalizeCspSignature(csp),
      )
      let html = await response.text()
      if (!fragmentOnly) {
        html = html.replace('<head>', `<head><script nonce="${nonce}">${OBSERVER_SOURCE}</script>`)
      }
      return html
    } finally {
      setClientEntryManifest(undefined)
      setModulePreloadManifest(undefined)
      setModulePreloadEnabled(true)
    }
  }

  async function renderLayoutPage(path: string, fragmentOnly: boolean, nonce: string, csp: string) {
    const { Target, label, area } = layoutPages[path as keyof typeof layoutPages]
    const body = () =>
      el('div', null, [
        el('h1', { key: 'h' }, label),
        el('p', { key: 'r', className: 'marker-root' }, 'root'),
        el('p', { key: 'a', className: `marker-${area}` }, area),
        ...['/one', '/one/next', '/two', '/head'].map((to) =>
          el('a', { key: to, href: to, 'data-testid': `to${to.replaceAll('/', '-')}` }, to)
        ),
      ])
    const response = await renderPageResponse(
      // deno-lint-ignore no-explicit-any
      Target as any,
      body,
      mockPageContext(),
      undefined,
      fragmentOnly,
      nonce,
      undefined,
      normalizeCspSignature(csp),
    )
    let html = await response.text()
    if (!fragmentOnly) {
      html = html
        .replace('<head>', `<head><script nonce="${nonce}">${STYLE_OBSERVER_SOURCE}</script>`)
        .replace('</body>', `<script type="module" src="${entryAsset}"></script></body>`)
    }
    return html
  }

  async function render(
    which: 'a' | 'b' | 'c' | 'd',
    fragmentOnly: boolean,
    nonce: string,
    csp: string,
    withProbe: boolean,
    errors: { mode: string; scroll: string } = { mode: 'errors', scroll: 'none' },
    state = 'none',
  ) {
    const draft = { storageKey: STORAGE_KEY, hasServerValues: false }
    const bodyA = () =>
      el('div', null, [
        el('style', { key: 's', nonce }, skeletonCss()),
        el('h1', { key: 'h' }, 'Draft probe fixture'),
        el('form', { key: 'f', id: FORM_ID, method: 'post' }, [
          el('input', { key: 'i', name: 'title', placeholder: 'type, then reload' }),
        ]),
        withProbe ? el(DraftProbe, { key: 'p', formId: FORM_ID, draft, nonce }) : null,
        el(ManagedForm, { key: 'm', formId: FORM_ID, draft }),
        el('a', { key: 'l', href: '/b', 'data-testid': 'to-b' }, 'go to B'),
        el('a', { key: 'e', href: '/errors', 'data-testid': 'to-errors' }, 'go to errors'),
        el('pre', { key: 'log', id: 'log' }),
        el('script', {
          key: 'panel',
          nonce,
          dangerouslySetInnerHTML: { __html: PANEL_SOURCE },
        }),
      ])
    const bodyC = () => {
      const invalid = errors.mode === 'clean' ? {} : { 'aria-invalid': 'true' }
      const draft = { storageKey: ERRORS_STORAGE_KEY, hasServerValues: false }
      const managed = el(ManagedForm, {
        key: 'm',
        formId: ERRORS_FORM_ID,
        focusFirstInvalid: true,
        ...(errors.mode === 'draft' ? { draft } : {}),
      })
      const scroll = el(ScrollRestoration, {
        key: 'sr',
        ...(errors.scroll === 'idle' ? { comet: 'idle' } : {}),
      })
      return el('div', null, [
        el('style', { key: 's', nonce }, skeletonCss()),
        el('h1', { key: 'h' }, 'Errors fixture'),
        errors.mode === 'steal'
          ? el('input', { key: 'o', id: 'other', name: 'other', placeholder: 'already typing' })
          : null,
        errors.mode === 'steal'
          ? el('script', {
            key: 'steal',
            nonce,
            dangerouslySetInnerHTML: { __html: `document.getElementById('other').focus()` },
          })
          : null,
        el('form', { key: 'f', id: ERRORS_FORM_ID, method: 'post' }, [
          el('input', { key: 'first', name: 'first' }),
          // Marked invalid but disabled: it has to be skipped for the next one.
          el('input', { key: 'off', name: 'off', disabled: true, ...invalid }),
          // Marked invalid inside a disabled fieldset: the browser disables it, so it is skipped too.
          el('fieldset', { key: 'lock', disabled: true }, [
            el('input', { key: 'locked', name: 'locked', ...invalid }),
          ]),
          el('div', { key: 'gap', className: 'gap' }),
          el('input', { key: 'bad1', name: 'bad1', ...invalid }),
          el('input', { key: 'bad2', name: 'bad2', ...invalid }),
        ]),
        errors.mode === 'draft'
          ? el(DraftProbe, { key: 'p', formId: ERRORS_FORM_ID, draft, nonce })
          : null,
        errors.scroll === 'before' ? scroll : null,
        managed,
        errors.scroll === 'after' || errors.scroll === 'idle' ? scroll : null,
        el('a', { key: 'l', href: '/', 'data-testid': 'to-a' }, 'back to A'),
        el('pre', { key: 'log', id: 'log' }),
        el('script', {
          key: 'panel',
          nonce,
          dangerouslySetInnerHTML: { __html: PANEL_SOURCE },
        }),
      ])
    }
    // The component of the page with a catalog: it receives the whole loader result as props.
    const bodyD = (props: { title: string; messages: Record<string, string> }) => {
      const draft = { storageKey: STATE_STORAGE_KEY, hasServerValues: false }
      return el('div', null, [
        el('h1', { key: 'h' }, props.title),
        el('p', { key: 'g', id: 'greeting' }, props.messages['home/greeting']),
        el('form', { key: 'f', id: STATE_FORM_ID, method: 'post' }, [
          el('input', { key: 'n', name: 'note' }),
        ]),
        el(ManagedForm, { key: 'm', formId: STATE_FORM_ID, draft }),
        el('a', { key: 'l', href: '/b', 'data-testid': 'to-b' }, 'go to B'),
      ])
    }
    const bodyB = () =>
      el('div', null, [
        el('h1', { key: 'h' }, 'Page B'),
        el('a', { key: 'l', href: '/', 'data-testid': 'to-a' }, 'back to A'),
      ])
    // Only the page with a catalog hands the renderer a loader result; the rest have none.
    const data = which === 'd'
      ? { title: 'State fixture', messages: { ...CATALOG, 'home/greeting': GREETING } }
      : undefined
    // The app's policy for this request: only the page with a catalog has data to serialize.
    setInitialStatePolicy(
      parseStateOption(
        state === 'all'
          ? 'all'
          : state === 'omit'
          ? { omit: ['messages'] }
          : state === 'pick'
          ? { pick: ['title'] }
          : 'none',
      ),
    )
    const response = await renderPageResponse(
      // deno-lint-ignore no-explicit-any
      (which === 'a' ? PageA : which === 'b' ? PageB : which === 'c' ? PageC : PageD) as any,
      which === 'a' ? bodyA : which === 'b' ? bodyB : which === 'c' ? bodyC : bodyD,
      mockPageContext(),
      data,
      fragmentOnly,
      nonce,
      undefined,
      normalizeCspSignature(csp),
    )
    let html = await response.text()
    if (!fragmentOnly) {
      html = html
        .replace('<head>', `<head><script nonce="${nonce}">${OBSERVER_SOURCE}</script>`)
        .replace('</body>', `<script type="module" src="${entryAsset}"></script></body>`)
    }
    return html
  }

  const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    const url = new URL(req.url)
    if (url.pathname === '/__assets') return Response.json(assetLog)
    if (url.pathname === '/__assets/reset') {
      assetLog.length = 0
      return new Response('ok')
    }
    if (url.pathname.startsWith('/assets/')) {
      const entry = { path: url.pathname, at: performance.now() - serverStart, done: -1 }
      assetLog.push(entry)
      try {
        const file = await Deno.readFile(join(outDir, url.pathname))
        await new Promise((resolve) => setTimeout(resolve, CLIENT_DELAY_MS))
        entry.done = performance.now() - serverStart
        return new Response(file, {
          headers: { 'content-type': 'text/javascript' },
        })
      } catch {
        return new Response('not found', { status: 404 })
      }
    }
    if (url.pathname === '/__hits') return Response.json(hits)
    if (url.pathname in layoutCss) {
      hits[url.pathname] = (hits[url.pathname] ?? 0) + 1
      await new Promise((resolve) => setTimeout(resolve, LAYOUT_CSS_DELAY_MS))
      return new Response(layoutCss[url.pathname], { headers: { 'content-type': 'text/css' } })
    }
    if (url.pathname === '/preload' || url.pathname === '/preload-off') {
      const nonce = crypto.randomUUID().replaceAll('-', '')
      const csp =
        `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'`
      const html = await renderPreloadPage(
        url.pathname === '/preload',
        req.headers.get(ORBIT_FRAGMENT_HEADER) !== null,
        nonce,
        csp,
      )
      return new Response(html, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp },
      })
    }
    if (url.pathname in layoutPages) {
      // The framework's zero-config default policy, with a fresh nonce per request.
      const nonce = crypto.randomUUID().replaceAll('-', '')
      const csp =
        `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'`
      const html = await renderLayoutPage(
        url.pathname,
        req.headers.get(ORBIT_FRAGMENT_HEADER) !== null,
        nonce,
        csp,
      )
      return new Response(html, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp },
      })
    }
    if (!['/', '/b', '/errors', '/state'].includes(url.pathname)) {
      return new Response('not found', { status: 404 })
    }
    // The framework's zero-config default policy, with a fresh nonce per request.
    const nonce = crypto.randomUUID().replaceAll('-', '')
    const csp =
      `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'`
    const fragment = req.headers.get(ORBIT_FRAGMENT_HEADER) !== null
    const html = await render(
      url.pathname === '/'
        ? 'a'
        : url.pathname === '/b'
        ? 'b'
        : url.pathname === '/state'
        ? 'd'
        : 'c',
      fragment,
      nonce,
      csp,
      url.searchParams.get('probe') !== '0',
      {
        mode: url.searchParams.get('mode') ?? 'errors',
        scroll: url.searchParams.get('scroll') ?? 'none',
      },
      url.searchParams.get('state') ?? 'none',
    )
    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp },
    })
  })
  return {
    renderer,
    port: (server.addr as Deno.NetAddr).port,
    stop: () => {
      resetInitialStatePolicy()
      setCssManifest(undefined)
      return server.shutdown()
    },
  }
}

/** The skeleton an app would write: the form is held back while it is marked. */
function skeletonCss(): string {
  return `@media (scripting: enabled) { :root:has([data-draft-restoring='${FORM_ID}']) #${FORM_ID} ` +
    `{ opacity: 0.4; pointer-events: none; } } #log { font: 12px monospace; white-space: pre-wrap; } ` +
    // A class, not a `style` attribute: the default CSP blocks inline style attributes.
    `.gap { height: 2200px; }`
}

await main()
