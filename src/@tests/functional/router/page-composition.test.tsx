import { assert } from '@std/assert'
import { loadRoutes } from 'modules/router/mod.ts'
import { mockHandlerContext } from 'modules/testing/mod.ts'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'
import LayoutErrorFixturePage from '../../support/fixtures/layout-error-routes/page.tsx'
import LoadingFixturePage from '../../support/fixtures/loading-routes/page.tsx'

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
