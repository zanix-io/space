import { assert, assertEquals } from '@std/assert'
// Side-effect only — installs the React renderer. See `segment-loader.test.tsx`'s own comment on
// this same import for why it's explicit here rather than relying on a sibling file's ordering.
import '../../../../mod-react.ts'
import { loadRoutes } from 'modules/router/mod.ts'
import { mockHandlerContext } from 'modules/testing/mod.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { setPageRenderer } from 'modules/router/page-renderer-registry.ts'
import { renderPageResponse as renderPageResponsePreact } from 'modules/router/render-page-preact.ts'
import { renderPageResponse as renderPageResponseReact } from 'modules/router/render-page-react.tsx'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'
import RequestDedupeFixturePage from '../../support/fixtures/request-dedupe-routes/[id]/page.tsx'
import {
  callCount,
  resetCallCount,
} from '../../support/fixtures/request-dedupe-routes/dedupe-counter.ts'
import RequestDedupePreactFixturePage from '../../support/fixtures/request-dedupe-preact-routes/[id]/page.tsx'
import {
  callCount as preactCallCount,
  resetCallCount as resetPreactCallCount,
} from '../../support/fixtures/request-dedupe-preact-routes/dedupe-counter.ts'

Deno.test(
  'SpacePageController.handleGet: ctx.dedupe() shares ONE fetch across THREE independent loaders ' +
    "— the page's own, its root layout's own, and its nested layout's own — real duplicate-fetch " +
    'prevention, not just three separately-passing loader calls',
  async () => {
    resetCallCount()
    await loadRoutes('src/@tests/support/fixtures/request-dedupe-routes')

    const ctx = mockHandlerContext({
      payload: { params: { id: 'p-1' }, search: {}, body: undefined },
    })
    const page = new RequestDedupeFixturePage(ctx)
    const response = await page.handleGet(ctx)

    assert(response.status === 200, `expected 200, got ${response.status}`)
    const html = stripHydrationComments(await response.text())

    // All three received the SAME resolved value ('ana') — proving the shared cache actually
    // reached every one of them, not just that each happened to resolve independently.
    assert(html.includes('data-root-user="ana"'), html)
    assert(html.includes('data-nested-user="ana"'), html)
    assert(html.includes('data-page-user="ana"'), html)

    // The one assertion that actually proves dedup, not just correctness: `fetchSharedUser` ran
    // exactly ONCE for three independent `ctx.dedupe('shared-user', ...)` calls.
    assertEquals(callCount, 1, `expected fetchSharedUser to run once, ran ${callCount} times`)
  },
)

Deno.test(
  'SpacePageController.handleGet: ctx.dedupe() shares the SAME fetch across three loaders through ' +
    'the REAL Preact renderer too — createDedupeCache/resolveSegmentData touch nothing renderer-' +
    'specific, and this proves it rather than assuming it from that alone. Also the only real-' +
    'Preact-render coverage of segment-level loaders themselves (root + nested layout, each with ' +
    "its own loader) — see this fixture's own layout.tsx for why it needs its own non-JSX fixture " +
    'rather than reusing the React one.',
  async () => {
    // `setActiveRenderer('preact')` + `setPageRenderer(renderPageResponsePreact)` — the same two
    // calls `defineSpaceApp({ renderer: 'preact' })`'s own `setup(ctx)` makes, wired directly rather
    // than pulling in the rest of that setup — same pattern `orbit-fragment-preact.test.tsx`
    // establishes, including its own finding that `setActiveRenderer` ALONE does not change which
    // renderer `handleGet` actually renders through. Reset unconditionally in `finally` so this test
    // can never leak the Preact renderer into whatever runs after it in this same process.
    setActiveRenderer('preact')
    setPageRenderer(renderPageResponsePreact)
    try {
      resetPreactCallCount()
      await loadRoutes('src/@tests/support/fixtures/request-dedupe-preact-routes')

      const ctx = mockHandlerContext({
        payload: { params: { id: 'p-preact' }, search: {}, body: undefined },
      })
      const page = new RequestDedupePreactFixturePage(ctx)
      const response = await page.handleGet(ctx)

      assert(response.status === 200, `expected 200, got ${response.status}`)
      const html = stripHydrationComments(await response.text())

      assert(html.includes('data-testid="root-layout"'), html)
      assert(html.includes('data-root-user="ana"'), html)
      assert(html.includes('data-testid="nested-layout"'), html)
      assert(html.includes('data-nested-user="ana"'), html)
      assert(html.includes('data-testid="fixture-page"'), html)
      assert(html.includes('data-page-user="ana"'), html)
      assertEquals(
        preactCallCount,
        1,
        `expected fetchSharedUser to run once, ran ${preactCallCount} times`,
      )
    } finally {
      setActiveRenderer('react')
      setPageRenderer(renderPageResponseReact)
    }
  },
)
