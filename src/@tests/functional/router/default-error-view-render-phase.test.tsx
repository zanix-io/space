import { assert, assertEquals } from '@std/assert'
import '@zanix/space/react'
import { loadRoutes } from 'modules/router/mod.ts'
import { mockHandlerContext } from 'modules/testing/mod.ts'
import { ERROR_BOUNDARY_MODULE_ATTR } from 'modules/router/error-boundary-marker.ts'
import RenderErrorNoBoundaryFixturePage from '../../support/fixtures/render-error-no-boundary-routes/page.tsx'

/**
 * A render-phase throw (a component itself throwing, never a `loader`) on a route with NO
 * `error.tsx` anywhere in its own composition chain — confirmed as a real, reproduced gap before
 * this fix existed: `composeSegments` only ever wraps a segment in a `Suspense`/`SpaceErrorBoundary`
 * when that segment ITSELF declares `error.tsx`; with none anywhere, nothing catches the throw at
 * all, and the whole response died as a real `500` with a COMPLETELY EMPTY body — not even this
 * package's own `DefaultErrorView`, which already existed for exactly this "route opted into none"
 * case on the data-phase (`loader`) side (`loader-error-default-view-parity.test.tsx`). This locks
 * the same fallback now applying to the render phase too. Preact's own counterpart lives in its own
 * file (`default-error-view-render-phase-preact.test.ts`) — importing both renderer entry points
 * (`@zanix/space/react` and `@zanix/space/preact`) into the SAME process/file overwrites the
 * shared active-renderer/page-renderer registries, the same reason every other renderer-specific
 * test pair in this package is split the same way.
 *
 * @module
 */

console.error = () => {}

Deno.test(
  'composeSegments (react): a render-phase throw with NO error.tsx anywhere still gets a real ' +
    '200 with DefaultErrorView wrapped in — never the empty 500 this used to produce',
  async () => {
    await loadRoutes('src/@tests/support/fixtures/render-error-no-boundary-routes')
    const ctx = mockHandlerContext()
    const page = new RenderErrorNoBoundaryFixturePage(ctx)
    const response = await page.handleGet(ctx)
    const html = await response.text()

    assertEquals(response.status, 200, html)
    assert(html.length > 0, 'the body must never be empty')
    assert(html.includes(`${ERROR_BOUNDARY_MODULE_ATTR}="`), html)
    assert(html.includes('default-error-view.tsx'), html)
  },
)
