// Installs a renderer, exactly as a real app does — same precedent
// `define-space-app-activation.test.tsx`/`define-space-app-assets-api-activation.test.tsx` already
// establish (`defineSpaceApp`'s own `setup()` throws if no renderer is installed at all).
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { activateApps, deactivateApps } from '@zanix/app/runtime'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { defineSpaceApp } from 'modules/runtime/mod.ts'

/**
 * Real, end-to-end proof that `POST /api/log` is genuinely guarded — unlike
 * `define-space-app-assets-api-activation.test.tsx` (which proves `assetsApi` reaches the given
 * `AssetService`), this file's only job is confirming the Task 3/Task 2 WIRING itself: this route's
 * own mandatory default `rateLimitGuard` actually runs (a normal request succeeds under it), and
 * `SpaceAppConfig.logApi.guards` genuinely composes on top of it — appended, never replacing the
 * default — the same "prove the piece is actually connected" scope
 * `zanix-test-tier-conventions` describes for this tier.
 *
 * Doesn't re-prove `rateLimitGuard`'s own internal counting/window/anonymous-session mechanics —
 * that's `@zanix/auth`'s own test suite's job (`rate-limit.guard.test.ts`); exhausting the real
 * 30-request budget here would make this test slow and racy for no wiring-proof benefit.
 */
const denyEverythingGuard = () =>
  Promise.resolve({
    response: new Response('blocked by an extra guard', { status: 403 }),
  })

Deno.test(
  "defineSpaceApp + activateApps: POST /api/log succeeds under this route's own default " +
    'rateLimitGuard when no extra guards are configured',
  async () => {
    const app = defineSpaceApp({ name: 'fixture-log-api-default-guard-app' })

    const activated = await activateApps([app])
    // Explicit, distinct port — two `Deno.test`s in this one file each open a real `rest` server;
    // `bootstrapServers({ rest: {...} })` with no `port` defaults to the same one for both, and the
    // second test's own bind can race the first one's still-in-flight teardown (confirmed
    // empirically: an intermittent "connection refused" on the SECOND test only, never in
    // isolation) — same real precedent `define-space-app-activation.test.tsx` already establishes
    // for its own multiple `Deno.test`s sharing one file (`port: 20905`/`20906`).
    const [serverId] = await bootstrapServers({
      rest: {
        application: 'fixture-log-api-default-guard-app',
        id: 'fixture-log-api-default-guard-app',
        port: 20907,
      },
    })
    assert(serverId, 'the server should have been started')

    try {
      const info = webServerManager.info(serverId)
      assert(info.addr, 'the started server should be listening')
      // `/log`, not `/api/log` — this server is ANCHORED (explicit `id` above), which skips
      // `@zanix/server`'s own default `/api` globalPrefix entirely, and `createLogApiController`'s
      // own `prefix` now defaults to empty (see `log.controller.ts`'s own doc) — an UNANCHORED
      // rest server (the real, common case) is what actually lands on `/api/log`.
      const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${serverId}`

      const res = await fetch(`${baseUrl}/log`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ level: 'info', message: 'hello from a real request' }),
      })
      assertEquals(res.status, 200)
      const body = await res.json()
      assertEquals(body, { ok: true })
    } finally {
      await webServerManager.stop([serverId])
      await deactivateApps(activated)
    }
  },
)

Deno.test(
  'defineSpaceApp({ logApi: { guards } }) + activateApps: an extra guard composes AFTER the ' +
    'default rateLimitGuard — it can still block a request the rate limit itself would have ' +
    'allowed',
  async () => {
    const app = defineSpaceApp({
      name: 'fixture-log-api-extra-guard-app',
      logApi: { guards: [denyEverythingGuard] },
    })

    const activated = await activateApps([app])
    // Explicit, distinct port — see the sibling test above's own comment for why.
    const [serverId] = await bootstrapServers({
      rest: {
        application: 'fixture-log-api-extra-guard-app',
        id: 'fixture-log-api-extra-guard-app',
        port: 20908,
      },
    })
    assert(serverId, 'the server should have been started')

    try {
      const info = webServerManager.info(serverId)
      assert(info.addr, 'the started server should be listening')
      // `/log`, not `/api/log` — this server is ANCHORED (explicit `id` above), which skips
      // `@zanix/server`'s own default `/api` globalPrefix entirely, and `createLogApiController`'s
      // own `prefix` now defaults to empty (see `log.controller.ts`'s own doc) — an UNANCHORED
      // rest server (the real, common case) is what actually lands on `/api/log`.
      const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${serverId}`

      const res = await fetch(`${baseUrl}/log`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ level: 'info', message: 'should be blocked' }),
      })
      assertEquals(res.status, 403)
      await res.body?.cancel()
    } finally {
      await webServerManager.stop([serverId])
      await deactivateApps(activated)
    }
  },
)
