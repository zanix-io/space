import { assert, assertEquals } from '@std/assert'
import { loadRoutes } from 'modules/router/mod.ts'
import { mockHandlerContext } from 'modules/testing/mod.ts'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'
import LayoutErrorFixturePage from '../../support/fixtures/layout-error-routes/page.tsx'
import LoadingFixturePage from '../../support/fixtures/loading-routes/page.tsx'
import LoaderErrorFixturePage from '../../support/fixtures/loader-error-routes/page.tsx'
import LoaderNotFoundFixturePage from '../../support/fixtures/loader-not-found-routes/page.tsx'
import NestedLoaderErrorFixturePage from '../../support/fixtures/nested-loader-error-routes/page.tsx'
import LoaderErrorActionFixturePage from '../../support/fixtures/loader-error-action-routes/page.tsx'
import LoaderErrorNoBoundaryFixturePage from '../../support/fixtures/loader-error-no-boundary-routes/page.tsx'

// Static imports above resolve to the exact same module instances `loadRoutes()` itself imports
// (same file, same resolved specifier) — so the classes below are the very ones `loadRoutes()`
// populates via `setPageTree()`, with no need to go through HTTP/`bootstrapServers` for this.

console.error = () => {}

Deno.test(
  "SpacePageController.handleGet: a segment's error.tsx keeps a thrown component's page a 200, wrapped in that segment's layout",
  async () => {
    await loadRoutes('src/@tests/support/fixtures/layout-error-routes')

    const ctx = mockHandlerContext()
    const page = new LayoutErrorFixturePage(ctx)
    const response = await page.handleGet(ctx)

    // React's server renderer only recovers a thrown error for content inside a `Suspense`
    // boundary — `composeSegments` always adds one when a segment has an `error.tsx` (see its own
    // doc), which is what keeps this a 200 instead of the shell-breaking 500 an unwrapped throw
    // would produce. The `error.tsx` fallback's own content only becomes visible once the page is
    // hydrated (not implemented yet — see `SpaceErrorBoundary`'s own doc), so it's deliberately
    // not asserted here; the layout around it still renders normally either way.
    assert(response.status === 200, `expected 200, got ${response.status}`)
    const html = stripHydrationComments(await response.text())
    assert(html.includes('data-testid="fixture-layout"'), html)
  },
)

Deno.test(
  "SpacePageController.handleGet: a segment's loading.tsx unblocks the shell without waiting for a suspending page to settle",
  async () => {
    await loadRoutes('src/@tests/support/fixtures/loading-routes')

    const ctx = mockHandlerContext()
    const page = new LoadingFixturePage(ctx)

    const start = performance.now()
    const response = await page.handleGet(ctx)
    const elapsed = performance.now() - start

    // The page's own component suspends for 150ms (see the fixture's own comment on why that
    // margin exists). Without composeSegments wrapping it in a Suspense boundary, React couldn't
    // consider the shell ready until that promise settles, and this await would take at least as
    // long — resolving well before that is what actually proves the boundary is there, rather than
    // asserting on which exact stream chunk the fallback happens to land in (an internal flushing
    // detail this test has no business depending on).
    assert(
      elapsed < 100,
      `handleGet took ${elapsed}ms — expected it to resolve well before the page's own 150ms delay`,
    )
    assert(response.status === 200)

    const html = await response.text()
    assert(html.includes('data-testid="fixture-resolved"'), html)
    assert(html.includes('resolved-content'), html)
  },
)

Deno.test(
  "SpacePageController.handleGet: a page's own loader throwing a generic error renders the " +
    'nearest error.tsx with a real 500, instead of leaking uncaught to a raw JSON error response',
  async () => {
    await loadRoutes('src/@tests/support/fixtures/loader-error-routes')

    const ctx = mockHandlerContext()
    const page = new LoaderErrorFixturePage(ctx)
    const response = await page.handleGet(ctx)

    assertEquals(response.status, 500)
    const html = stripHydrationComments(await response.text())
    assert(html.includes('data-testid="fixture-loader-error"'), html)
    assert(html.includes('fixture-loader-boom'), html)
  },
)

Deno.test(
  "SpacePageController.handleGet: a page's own loader throwing HttpError('NOT_FOUND') renders " +
    "this app's not-found.tsx with a real 404, reusing createNotFoundHandler's own lookup",
  async () => {
    await loadRoutes('src/@tests/support/fixtures/loader-not-found-routes')

    const ctx = mockHandlerContext()
    const page = new LoaderNotFoundFixturePage(ctx)
    const response = await page.handleGet(ctx)

    assertEquals(response.status, 404)
    const html = stripHydrationComments(await response.text())
    assert(html.includes('data-testid="loader-not-found"'), html)
  },
)

Deno.test(
  "SpacePageController.handleGet: a nested layout segment's own loader throwing is caught the " +
    "same way as the page's own loader, rendering that segment's nearest error.tsx",
  async () => {
    await loadRoutes('src/@tests/support/fixtures/nested-loader-error-routes')

    const ctx = mockHandlerContext()
    const page = new NestedLoaderErrorFixturePage(ctx)
    const response = await page.handleGet(ctx)

    assertEquals(response.status, 500)
    const html = stripHydrationComments(await response.text())
    assert(html.includes('data-testid="fixture-segment-loader-error"'), html)
    assert(html.includes('fixture-segment-loader-boom'), html)
  },
)

Deno.test(
  "SpacePageController.handleGet: a page's own loader throwing with NO error.tsx anywhere in its " +
    "own composition chain still renders a real document — this package's own built-in " +
    'DefaultErrorView, with a real 500 status — never a raw, uncaught throw leaking to ' +
    "@zanix/server's own generic JSON error response",
  async () => {
    await loadRoutes('src/@tests/support/fixtures/loader-error-no-boundary-routes')

    const ctx = mockHandlerContext()
    const page = new LoaderErrorNoBoundaryFixturePage(ctx)
    const response = await page.handleGet(ctx)

    assertEquals(response.status, 500)
    const html = stripHydrationComments(await response.text())
    assert(html.includes('data-space="error"'), html)
    assert(html.includes('Something went wrong'), html)
    // The built-in fallback deliberately says nothing about the underlying error itself — only
    // the log carries it (see `loader-error-handler.ts`'s own doc).
    assert(!html.includes('fixture-no-boundary-loader-boom'), html)
  },
)

Deno.test(
  "SpacePageController.handlePost: a page's own loader throwing during the 422 field-validation " +
    're-render is caught the same way as a GET, rendering the nearest error.tsx with a real 500 ' +
    'instead of the 422 re-render (or a raw JSON error response)',
  async () => {
    await loadRoutes('src/@tests/support/fixtures/loader-error-action-routes')

    // An invalid `email` fails `FixtureActionBody`'s own validation, which is what routes
    // `handlePost` into `#renderInvalidAction` — the SAME `loader` the page's own GET uses, and the
    // one this fixture always throws from.
    const ctx = mockHandlerContext({
      payload: { params: {}, search: {}, body: { email: 'not-an-email' } },
    })
    const page = new LoaderErrorActionFixturePage(ctx)
    const response = await page.handlePost(ctx)

    assertEquals(response.status, 500)
    const html = stripHydrationComments(await response.text())
    assert(html.includes('data-testid="fixture-action-loader-error"'), html)
    assert(html.includes('fixture-action-loader-boom'), html)
  },
)
