import { assertEquals } from '@std/assert'
import {
  bootstrapServers,
  Controller,
  Get,
  Guard,
  webServerManager,
  ZanixController,
} from '@zanix/server'
import { Page, SpacePageController } from 'modules/router/mod.ts'
import { cspGuard, defineMiddleware } from 'modules/middleware/mod.ts'

function View() {
  return <div>ok</div>
}

// A single test, deliberately: `defineMiddleware`/`registerGlobalGuard` have no unregister
// mechanism — once called, a guard applies to every `'ssr'` route for the rest of this process,
// including later tests in other files. Splitting this into multiple `Deno.test` blocks would mean
// the second block runs with the first block's guard already (permanently) active. The guard below
// only ever trips on a header no other test sends, so it's inert everywhere else in the suite.
Deno.test(
  'defineMiddleware: guards apply to every SSR page route, scoped away from REST, and cspGuard ' +
    'sets its header on every SSR response',
  async () => {
    defineMiddleware([
      cspGuard({ 'default-src': ["'self'"] }),
      (ctx) => {
        if (ctx.req.headers.get('x-block-me') === '1') {
          return { response: new Response('blocked', { status: 403 }) }
        }
        return {}
      },
    ])

    // `headers: false` on both pages below: `Page()` now applies its own default CSP/security
    // headers automatically (see `page-decorator.test.tsx`) — leaving it on here would collide with
    // this test's own `defineMiddleware`/`@Guard`-based policies (both write the same header; the
    // framework's own post-handler guard-header merge combines rather than cleanly overrides, per
    // `SpacePageController.headers`'s own doc on not mixing the two mechanisms for the same page).
    @Page({ path: 'middleware/guarded-page', headers: false })
    class GuardedPage extends SpacePageController {
      public override component = View
    }
    void GuardedPage

    // A page-level `@Guard` runs AFTER `defineMiddleware`'s global guards (target-level guards are
    // appended last in `MiddlewaresContainer.getMiddlewares`) — so its own `cspGuard` header wins
    // the merge in `mainGuard` (`{...baseHeaders, ...headers}`, later entries override earlier
    // ones), overriding the app-wide policy for just this page.
    @Page({ path: 'middleware/stricter-csp-page', headers: false })
    @Guard(cspGuard({ 'default-src': ["'none'"] }))
    class StricterCspPage extends SpacePageController {
      public override component = View
    }
    void StricterCspPage

    @Controller()
    class RestSideEffect extends ZanixController {
      @Get('middleware/rest-untouched')
      public helloRest() {
        return { ok: true }
      }
    }
    void RestSideEffect

    const servers = await bootstrapServers({ ssr: { port: 20401 }, rest: { port: 20402 } })
    try {
      const normal = await fetch('http://localhost:20401/middleware/guarded-page')
      assertEquals(normal.headers.get('Content-Security-Policy'), "default-src 'self'")
      await normal.body?.cancel()

      // The page declaring its own `@Guard(cspGuard(...))` gets ITS OWN policy, not the app-wide one.
      const stricter = await fetch('http://localhost:20401/middleware/stricter-csp-page')
      assertEquals(stricter.headers.get('Content-Security-Policy'), "default-src 'none'")
      await stricter.body?.cancel()

      const blocked = await fetch('http://localhost:20401/middleware/guarded-page', {
        headers: { 'x-block-me': '1' },
      })
      assertEquals(blocked.status, 403)
      assertEquals(await blocked.text(), 'blocked')

      // Same trigger header, but against a REST route: `defineMiddleware`'s guards are scoped to
      // `'ssr'` only (via `registerGlobalGuard`'s `exports: { server: ['ssr'] }`) — they never leak
      // into other server types sharing the same process.
      const restUntouched = await fetch('http://localhost:20402/api/middleware/rest-untouched', {
        headers: { 'x-block-me': '1' },
      })
      assertEquals(restUntouched.status, 200)
      assertEquals(await restUntouched.json(), { ok: true })
    } finally {
      await webServerManager.stop(servers)
    }
  },
)
