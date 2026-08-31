import { assert, assertEquals, assertFalse } from '@std/assert'
import { fromFileUrl } from '@std/path'
import '@zanix/space/react'
import { loadRoutes } from 'modules/router/mod.ts'
import { mockHandlerContext } from 'modules/testing/mod.ts'
import {
  ERROR_BOUNDARY_MODULE_ATTR,
  ERROR_BOUNDARY_PARAMS_ATTR,
} from 'modules/router/error-boundary-marker.ts'
import LayoutErrorFixturePage from '../../support/fixtures/layout-error-routes/page.tsx'
import LoadingFixturePage from '../../support/fixtures/loading-routes/page.tsx'

/**
 * Locks the exact structural contract `hydrate-error-boundaries.ts` depends on — confirmed against
 * a real forced-error render (see `render-page-react.tsx`'s own `composeSegments` doc) before this
 * package's client hydrator was ever written, not assumed from React's own docs alone: if React
 * ever changes where its postponed-recovery `<template>` lands relative to a real host wrapper,
 * this test catches it before the client hydrator silently stops finding anything.
 *
 * @module
 */

console.error = () => {}

Deno.test(
  'composeSegments (react): a segment declaring error.tsx gets a real data-error-module wrapper, ' +
    "and React's own postponed-recovery <template> lands as its DIRECT child when that segment " +
    'actually fails during SSR',
  async () => {
    await loadRoutes('src/@tests/support/fixtures/layout-error-routes')

    const ctx = mockHandlerContext()
    const page = new LayoutErrorFixturePage(ctx)
    const response = await page.handleGet(ctx)
    const html = await response.text()

    const moduleAttrIndex = html.indexOf(`${ERROR_BOUNDARY_MODULE_ATTR}="`)
    assert(moduleAttrIndex !== -1, `expected a ${ERROR_BOUNDARY_MODULE_ATTR} attribute in: ${html}`)
    assert(html.includes(ERROR_BOUNDARY_PARAMS_ATTR), html)

    // The wrapper `<div>`'s own closing `>` is immediately followed by React's postponed-recovery
    // markers — no intervening element. `Suspense`/`SpaceErrorBoundary` (while `hasError` stays
    // `false`, which is true for the WHOLE server response here — see that class's own doc) never
    // contribute a DOM node of their own, so this wrapper `<div>` is the direct parent.
    const wrapperCloseIndex = html.indexOf('>', moduleAttrIndex)
    const afterWrapper = html.slice(wrapperCloseIndex + 1)
    // Structural only (`<!--$!-->` + `<template`), never `data-msg=` — `hydrate-error-boundaries.ts`
    // deliberately does not key detection on that attribute's presence either: confirmed
    // empirically (see that module's own doc) that a PRODUCTION react-dom-server build emits a
    // completely bare `<template></template>` here, by design, so requiring `data-msg=` here would
    // make this assertion (and the client hydrator it locks down) dev-build-only.
    assert(
      afterWrapper.startsWith('<!--$!--><template'),
      `expected the postponed <template> immediately after the wrapper div, got: ${
        afterWrapper.slice(0, 120)
      }`,
    )
  },
)

Deno.test(
  'composeSegments (react): under a PRODUCTION react-dom-server build, the postponed <template> ' +
    'carries none of the dev-only data-msg/data-stck/data-cstck attributes at all — confirmed here ' +
    'so hydrate-error-boundaries.ts is never tempted to key detection on their presence',
  async () => {
    // A real subprocess, not `Deno.env.set` in-place: `react-dom/server`'s own dev-vs-production
    // branch (`server.browser.js`) is a plain top-level `if (process.env.NODE_ENV === 'production')`
    // evaluated ONCE, the first time that module is ever imported in a process — already-loaded in
    // THIS test's own process (by the test above, and by every other test file `deno test` happens
    // to run first in the same run), so setting the env var here would do nothing observable.
    //
    // `deno test`, not `deno run`/`deno eval` — see `render-layout-error-fixture.ts`'s own doc for
    // why (a real, confirmed hang under this repo's `--min-dep-age=0` requirement for the other
    // two, not chased down further since this shape works reliably).
    const outputFile = await Deno.makeTempFile()
    try {
      const root = fromFileUrl(import.meta.resolve('../../../../'))
      const { success, stderr } = await new Deno.Command(Deno.execPath(), {
        args: [
          'test',
          '--min-dep-age=0',
          '-A',
          '--no-check',
          'src/@tests/support/scripts/render-layout-error-fixture.ts',
        ],
        cwd: root,
        env: { NODE_ENV: 'production', OUTPUT_FILE: outputFile },
      }).output()

      assert(success, new TextDecoder().decode(stderr))
      const html = await Deno.readTextFile(outputFile)
      assert(html.includes('<!--$!--><template></template><!--/$-->'), html)
      assertFalse(html.includes('data-msg'), html)
    } finally {
      await Deno.remove(outputFile)
    }
  },
)

Deno.test(
  'composeSegments (react): a segment that renders successfully carries the SAME wrapper attributes ' +
    '(unconditional — composeSegments cannot know in advance whether a segment will fail), but the ' +
    "postponed-RECOVERY <!--$!--> error marker never appears as the wrapper's direct child, since " +
    'nothing actually failed',
  async () => {
    await loadRoutes('src/@tests/support/fixtures/loading-routes')

    const ctx = mockHandlerContext()
    const page = new LoadingFixturePage(ctx)
    const response = await page.handleGet(ctx)
    const html = await response.text()

    // This fixture has no `error.tsx` of its own (see its own directory), so `composeSegments`'s
    // fallback branch (see `render-page-react.tsx`'s own doc) adds the DEFAULT error view wrapper
    // unconditionally — the wrapper attribute IS present here too, unlike an earlier version of this
    // test assumed (a page with no `error.tsx` anywhere used to render with no wrapper at all; now
    // it always gets one, pointing at `default-error-view.tsx`, precisely so an unhandled throw never
    // produces a completely empty response again).
    const moduleAttrIndex = html.indexOf(`${ERROR_BOUNDARY_MODULE_ATTR}="`)
    assert(moduleAttrIndex !== -1, `expected a ${ERROR_BOUNDARY_MODULE_ATTR} attribute in: ${html}`)
    assert(html.includes('default-error-view.tsx'), html)

    // What actually matters here: nothing failed, so React's postponed-RECOVERY marker (`<!--$!-->`,
    // reserved for a segment that genuinely threw — see the first test above) must never appear as
    // the wrapper's direct child. This fixture's own `loading.tsx` boundary DOES suspend for real (a
    // genuine delay in `page.tsx`), which legitimately emits a *pending* `<!--$?-->`/`<template>`
    // marker — a different thing entirely — so this checks for the ERROR marker specifically, not
    // for the absence of any `<template>` at all.
    const wrapperCloseIndex = html.indexOf('>', moduleAttrIndex)
    const afterWrapper = html.slice(wrapperCloseIndex + 1)
    assertFalse(
      afterWrapper.startsWith('<!--$!--><template'),
      `expected no postponed-recovery error marker directly after the wrapper div, got: ${
        afterWrapper.slice(0, 120)
      }`,
    )
    assertEquals(response.status, 200)
  },
)
