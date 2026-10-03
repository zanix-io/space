// deno-lint-ignore-file deno-zanix-plugin/no-znx-console no-await-in-loop
// `console` on purpose: a hand-run CLI report, not library code (see `persistence/run.ts`'s own
// header for the full exemption). Every loop is sequential by design: renderer selection and the
// comet manifest are process-global state, and each browser run needs the machine to itself.
/**
 * Browser spike: does the draft probe mark a form as restoring BEFORE the first paint, under the
 * default CSP, on a full load and on an Orbit navigation?
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
 * `docs/comets.md`, "Checking the probe in a real browser".
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
import { setCometManifest } from 'modules/comets/comet-manifest.ts'
import { installReactRuntime } from '../../../../../mod-react.ts'
import { installPreactRuntime } from '../../../../../mod-preact.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { mockPageContext } from 'modules/testing/mod.ts'
import { ORBIT_FRAGMENT_HEADER } from 'modules/router/orbit-protocol.ts'
import { normalizeCspSignature } from 'modules/router/csp-signature.ts'
import { DraftProbe } from 'modules/comets/draft-probe-element.ts'

const REPO_ROOT = Deno.cwd()
const PERSISTENCE_DIR = 'src/@tests/benchmarks/space/persistence'
const FORM_ID = 'draft-form'
const STORAGE_KEY = 'fixture/draft'
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
    await stop()
  }
  await browser.close()

  console.log('\n=== Draft probe in a real browser ===\n')
  let failed = false
  for (const [name, ok] of Object.entries(results)) {
    if (ok !== true) failed = true
    console.log(`  ${ok === true ? 'PASS' : 'FAIL'}  ${name}${ok === true ? '' : `  (${ok})`}`)
  }
  Deno.exit(failed ? 1 : 0)
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

async function startFixture(
  renderer: Renderer,
): Promise<{ renderer: Renderer; port: number; stop: () => Promise<void> }> {
  const outDir = await Deno.makeTempDir({
    dir: getTemporaryFolder(import.meta.url),
    prefix: `space-draft-probe-${renderer}-`,
  })
  const managedFile = renderer === 'react' ? 'managed-form-react.tsx' : 'managed-form-preact.tsx'
  const entryFile = renderer === 'react' ? 'client-entry-react.ts' : 'client-entry-preact.ts'
  await buildCometsClient({
    root: REPO_ROOT,
    outDir,
    renderer,
    compiler: false,
    comets: {
      managed: join(REPO_ROOT, `src/modules/comets/${managedFile}`),
      'client-entry': join(REPO_ROOT, `${PERSISTENCE_DIR}/${entryFile}`),
    },
  })
  if (renderer === 'preact') installPreactRuntime()
  else installReactRuntime()
  setActiveRenderer(renderer)
  setCometManifest(JSON.parse(await Deno.readTextFile(join(outDir, 'comets-manifest.json'))))
  const entryAsset = await findBuiltAsset(join(outDir, 'assets'), 'client-entry')
  const ManagedForm = (await import(`../../../../modules/comets/${managedFile}`)).default
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

  async function render(
    which: 'a' | 'b',
    fragmentOnly: boolean,
    nonce: string,
    csp: string,
    withProbe: boolean,
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
        el('pre', { key: 'log', id: 'log' }),
        el('script', {
          key: 'panel',
          nonce,
          dangerouslySetInnerHTML: { __html: PANEL_SOURCE },
        }),
      ])
    const bodyB = () =>
      el('div', null, [
        el('h1', { key: 'h' }, 'Page B'),
        el('a', { key: 'l', href: '/', 'data-testid': 'to-a' }, 'back to A'),
      ])
    const response = await renderPageResponse(
      // deno-lint-ignore no-explicit-any
      (which === 'a' ? PageA : PageB) as any,
      which === 'a' ? bodyA : bodyB,
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
        .replace('<head>', `<head><script nonce="${nonce}">${OBSERVER_SOURCE}</script>`)
        .replace('</body>', `<script type="module" src="${entryAsset}"></script></body>`)
    }
    return html
  }

  const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    const url = new URL(req.url)
    if (url.pathname.startsWith('/assets/')) {
      try {
        const file = await Deno.readFile(join(outDir, url.pathname))
        await new Promise((resolve) => setTimeout(resolve, CLIENT_DELAY_MS))
        return new Response(file, {
          headers: { 'content-type': 'text/javascript' },
        })
      } catch {
        return new Response('not found', { status: 404 })
      }
    }
    if (url.pathname !== '/' && url.pathname !== '/b') {
      return new Response('not found', { status: 404 })
    }
    // The framework's zero-config default policy, with a fresh nonce per request.
    const nonce = crypto.randomUUID().replaceAll('-', '')
    const csp =
      `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'`
    const fragment = req.headers.get(ORBIT_FRAGMENT_HEADER) !== null
    const html = await render(
      url.pathname === '/' ? 'a' : 'b',
      fragment,
      nonce,
      csp,
      url.searchParams.get('probe') !== '0',
    )
    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp },
    })
  })
  return {
    renderer,
    port: (server.addr as Deno.NetAddr).port,
    stop: () => server.shutdown(),
  }
}

/** The skeleton an app would write: the form is held back while it is marked. */
function skeletonCss(): string {
  return `@media (scripting: enabled) { :root:has([data-draft-restoring='${FORM_ID}']) #${FORM_ID} ` +
    `{ opacity: 0.4; pointer-events: none; } } #log { font: 12px monospace; white-space: pre-wrap; }`
}

await main()
