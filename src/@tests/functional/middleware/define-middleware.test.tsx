// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assertEquals, assertMatch } from '@std/assert'
import {
  bootstrapServers,
  Controller,
  Get,
  Guard,
  webServerManager,
  ZanixController,
} from '@zanix/server'
import { Page, SpacePageController } from 'modules/router/mod.ts'
import { cspGuard, defineMiddleware, securityHeadersGuard } from 'modules/middleware/mod.ts'

function View() {
  return <div>ok</div>
}

// A single test, deliberately: `defineMiddleware`/`registerGlobalGuard` have no unregister
// mechanism — once called, a guard applies to every `'ssr'` route for the rest of this process,
// including later tests in other files. Splitting this into multiple `Deno.test` blocks would mean
// the second block runs with the first block's guard already (permanently) active. The guard below
// only ever trips on a header no other test sends, so it's inert everywhere else in the suite.
//
// This test's own real subject is the FULL three-tier precedence chain — `Page`'s own explicit
// config (including `false`) > a guard registered via `defineMiddleware`/`@Guard`
// (`cspGuard()`/`securityHeadersGuard()`) > this page's own zero-config default — proved for CSP
// AND for `frameOptions`/`noSniff` (representative of every other field `securityHeadersGuard`
// manages, since the resolution itself is generic/data-driven, not per-field bespoke code). The
// real guarantee under test: this page's own zero-config defaults must never count as "already set"
// by the time a guard's header gets the chance to apply — a guard-registered value must never be
// starved of the one case it's meant to cover. Scenario 4 below (no guard at all) has to run BEFORE
// `defineMiddleware` is ever called in this process — once it's called, there's no way back to a
// "no guard exists yet" state for the rest of the suite.
Deno.test(
  "Security header precedence: Page explicit (incl. false) > a registered guard > this page's " +
    'own zero-config default — CSP, frameOptions, and noSniff',
  async () => {
    // Scenario 4 — no guard + a page with no configuration → Space's own default is kept. Must
    // run first: no guard has been registered anywhere in this process yet.
    @Page({ path: 'middleware/no-guard-default' })
    class NoGuardDefaultPage extends SpacePageController {
      public override component = View
    }
    void NoGuardDefaultPage

    const preGuardServers = await bootstrapServers({ ssr: { port: 20403 } })
    try {
      const res = await fetch('http://localhost:20403/middleware/no-guard-default')
      const csp = res.headers.get('Content-Security-Policy')
      assertMatch(
        csp ?? '',
        /^default-src 'self'; script-src 'self' 'nonce-([^']+)'; style-src 'self' 'nonce-\1'$/,
      )
      assertEquals(res.headers.get('X-Frame-Options'), 'SAMEORIGIN')
      assertEquals(res.headers.get('X-Content-Type-Options'), 'nosniff')
      await res.body?.cancel()
    } finally {
      await webServerManager.stop(preGuardServers)
    }

    // From here on, real guards are registered app-wide — every scenario below runs under them.
    // `securityHeadersGuard` only sets `frameOptions` here (not `noSniff`), deliberately: proves a
    // field a guard DOESN'T cover still falls through to this page's own zero-config default, even
    // while a DIFFERENT field on the same guard is actively overriding it. The plain Set-Cookie
    // guard proves the new block-list mechanism (scenario 3, below) has zero effect on Set-Cookie's
    // own accumulative `.append()` behavior — the two are entirely orthogonal, verified end to end
    // through this package's own real pipeline, not just `@zanix/server`'s own isolated unit test.
    defineMiddleware([
      cspGuard({ 'default-src': ["'self'"] }),
      securityHeadersGuard({ frameOptions: 'DENY' }),
      () => ({ headers: { 'Set-Cookie': 'guard-cookie=1; Path=/' } }),
      (ctx) => {
        if (ctx.req.headers.get('x-block-me') === '1') {
          return { response: new Response('blocked', { status: 403 }) }
        }
        return {}
      },
    ])

    // Scenario 1 — guard + a page with no configuration → the guard wins. No `headers` option at all (not
    // even `headers: false`) — this is the exact case the real bug affected: this page's own
    // zero-config defaults must step aside for the guard's, not silently win by having already set
    // themselves first.
    @Page({ path: 'middleware/no-headers-at-all' })
    class NoHeadersAtAllPage extends SpacePageController {
      public override component = View
    }
    void NoHeadersAtAllPage

    // `headers: false` opts out of ALL of this page's own header defaults (CSP and every security
    // header included) — distinct from scenario 1 (which configures nothing, but still gets this
    // page's OTHER, unrelated defaults for fields the guard doesn't cover). Both end up deferring to
    // the guard for the fields the guard DOES cover, for different reasons — kept as its own fixture
    // since it exercises a different code path (`applySecurityGuards`'s early return) than scenario
    // 1 does.
    @Page({ path: 'middleware/guarded-page', headers: false })
    class GuardedPage extends SpacePageController {
      public override component = View
    }
    void GuardedPage

    // A page-level `@Guard` runs AFTER `defineMiddleware`'s global guards (target-level guards are
    // appended last in `MiddlewaresContainer.getMiddlewares`) — so its own `cspGuard` header wins
    // the merge in `mainGuard` (a real `Headers` accumulator: `.set()` for non-cookie headers means
    // later entries override earlier ones), overriding the app-wide policy for just this page.
    // Still just "a guard," from this page's own `csp`'s point of view — it never configured
    // anything itself either.
    @Page({ path: 'middleware/stricter-csp-page', headers: false })
    @Guard(cspGuard({ 'default-src': ["'none'"] }))
    class StricterCspPage extends SpacePageController {
      public override component = View
    }
    void StricterCspPage

    // Scenario 2 (CSP) — guard + Page({ headers: { csp } }) → the page wins. Declares its OWN CSP,
    // applied directly inside `handleGet`, never through the guard pipeline — sits under the
    // app-wide `defineMiddleware([cspGuard(...)])` registered above, which acts only as the
    // base/default. This page's own, more specific policy must win outright — never combined with
    // the guard's, which would otherwise produce a single, invalid, comma-joined
    // `Content-Security-Policy` value instead of either policy cleanly applying.
    @Page({
      path: 'middleware/page-with-own-csp',
      headers: { csp: { 'default-src': ["'unsafe-inline'"] } },
    })
    class PageWithOwnCsp extends SpacePageController {
      public override component = View
    }
    void PageWithOwnCsp

    // Same shape, but the guard is a page-level `@Guard(cspGuard(...))` instead of a global one —
    // proves the page-wins rule holds regardless of WHICH guard mechanism the page also carries.
    @Page({
      path: 'middleware/page-with-own-csp-class-guard',
      headers: { csp: { 'default-src': ["'unsafe-inline'"] } },
    })
    @Guard(cspGuard({ 'default-src': ["'none'"] }))
    class PageWithOwnCspClassGuard extends SpacePageController {
      public override component = View
    }
    void PageWithOwnCspClassGuard

    // Scenario 3 (CSP) — guard + an explicit csp: false → the header is completely absent. The page
    // explicitly disables CSP while keeping its other security-header defaults — must win even over
    // the guard's own app-wide policy, ending up with NO Content-Security-Policy header on the
    // response at all (never an empty value, never the guard's policy, never the two comma-joined).
    @Page({
      path: 'middleware/csp-explicitly-disabled',
      headers: { csp: false },
    })
    class CspExplicitlyDisabledPage extends SpacePageController {
      public override component = View
    }
    void CspExplicitlyDisabledPage

    // Scenario 2 (frameOptions) — guard + Page({ headers: { frameOptions } }) → the page wins.
    @Page({
      path: 'middleware/page-with-own-frame-options',
      headers: { frameOptions: 'SAMEORIGIN' },
    })
    class PageWithOwnFrameOptions extends SpacePageController {
      public override component = View
    }
    void PageWithOwnFrameOptions

    // Scenario 3 (frameOptions) — guard + an explicit frameOptions: false → the header is
    // completely absent, even though the guard has its own `'DENY'` for this exact field.
    @Page({
      path: 'middleware/frame-options-disabled',
      headers: { frameOptions: false },
    })
    class FrameOptionsDisabledPage extends SpacePageController {
      public override component = View
    }
    void FrameOptionsDisabledPage

    @Controller()
    class RestSideEffect extends ZanixController {
      @Get('middleware/rest-untouched')
      public helloRest() {
        return { ok: true }
      }
    }
    void RestSideEffect

    const servers = await bootstrapServers({
      ssr: { port: 20401 },
      rest: { port: 20402 },
    })
    try {
      // Scenario 1 — CSP and frameOptions (both covered by the guard) defer to it; noSniff (NOT
      // covered by the guard) still gets this page's own zero-config default.
      const noHeadersAtAll = await fetch(
        'http://localhost:20401/middleware/no-headers-at-all',
      )
      assertEquals(
        noHeadersAtAll.headers.get('Content-Security-Policy'),
        "default-src 'self'",
      )
      assertEquals(noHeadersAtAll.headers.get('X-Frame-Options'), 'DENY')
      assertEquals(noHeadersAtAll.headers.get('X-Content-Type-Options'), 'nosniff')
      await noHeadersAtAll.body?.cancel()

      const normal = await fetch(
        'http://localhost:20401/middleware/guarded-page',
      )
      assertEquals(
        normal.headers.get('Content-Security-Policy'),
        "default-src 'self'",
      )
      assertEquals(normal.headers.get('X-Frame-Options'), 'DENY')
      await normal.body?.cancel()

      // The page declaring its own `@Guard(cspGuard(...))` gets ITS OWN policy, not the app-wide one.
      const stricter = await fetch(
        'http://localhost:20401/middleware/stricter-csp-page',
      )
      assertEquals(
        stricter.headers.get('Content-Security-Policy'),
        "default-src 'none'",
      )
      await stricter.body?.cancel()

      // Scenario 2 (CSP).
      const pageWithOwnCsp = await fetch(
        'http://localhost:20401/middleware/page-with-own-csp',
      )
      const pageWithOwnCspCsp = pageWithOwnCsp.headers.get('Content-Security-Policy')
      assertEquals(pageWithOwnCspCsp, "default-src 'unsafe-inline'")
      assertEquals(pageWithOwnCspCsp?.includes(','), false)
      await pageWithOwnCsp.body?.cancel()

      // Same rule holds regardless of whether the page also carries a page-level
      // `@Guard(cspGuard(...))` — the page's own `headers.csp` still wins over it too.
      const pageWithOwnCspClassGuard = await fetch(
        'http://localhost:20401/middleware/page-with-own-csp-class-guard',
      )
      const classGuardCsp = pageWithOwnCspClassGuard.headers.get('Content-Security-Policy')
      assertEquals(classGuardCsp, "default-src 'unsafe-inline'")
      assertEquals(classGuardCsp?.includes(','), false)
      await pageWithOwnCspClassGuard.body?.cancel()

      // Scenario 3 (CSP) — the header must be COMPLETELY ABSENT, not an empty value.
      const disabled = await fetch(
        'http://localhost:20401/middleware/csp-explicitly-disabled',
      )
      assertEquals(disabled.headers.get('Content-Security-Policy'), null)
      assertEquals(disabled.headers.has('Content-Security-Policy'), false)
      // The rest of this page's security-header defaults are untouched — only CSP was disabled.
      assertEquals(disabled.headers.get('X-Frame-Options'), 'DENY')
      // Blocking CSP has zero effect on an unrelated guard's own Set-Cookie — it still accumulates
      // via its normal .append() behavior.
      assertEquals(disabled.headers.getSetCookie(), ['guard-cookie=1; Path=/'])
      await disabled.body?.cancel()

      // Scenario 2 (frameOptions) — this page's own explicit 'SAMEORIGIN' wins over the guard's
      // 'DENY'.
      const pageWithOwnFrameOptions = await fetch(
        'http://localhost:20401/middleware/page-with-own-frame-options',
      )
      assertEquals(pageWithOwnFrameOptions.headers.get('X-Frame-Options'), 'SAMEORIGIN')
      await pageWithOwnFrameOptions.body?.cancel()

      // Scenario 3 (frameOptions) — completely absent, even though the guard has 'DENY' for it.
      const frameOptionsDisabled = await fetch(
        'http://localhost:20401/middleware/frame-options-disabled',
      )
      assertEquals(frameOptionsDisabled.headers.get('X-Frame-Options'), null)
      assertEquals(frameOptionsDisabled.headers.has('X-Frame-Options'), false)
      // CSP (unrelated field, not disabled by this page) still defers to the guard normally.
      assertEquals(
        frameOptionsDisabled.headers.get('Content-Security-Policy'),
        "default-src 'self'",
      )
      await frameOptionsDisabled.body?.cancel()

      const blocked = await fetch(
        'http://localhost:20401/middleware/guarded-page',
        {
          headers: { 'x-block-me': '1' },
        },
      )
      assertEquals(blocked.status, 403)
      assertEquals(await blocked.text(), 'blocked')

      // Same trigger header, but against a REST route: `defineMiddleware`'s guards are scoped to
      // `'ssr'` only (via `registerGlobalGuard`'s `exports: { server: ['ssr'] }`) — they never leak
      // into other server types sharing the same process.
      const restUntouched = await fetch(
        'http://localhost:20402/api/middleware/rest-untouched',
        {
          headers: { 'x-block-me': '1' },
        },
      )
      assertEquals(restUntouched.status, 200)
      assertEquals(await restUntouched.json(), { ok: true })
    } finally {
      await webServerManager.stop(servers)
    }
  },
)
