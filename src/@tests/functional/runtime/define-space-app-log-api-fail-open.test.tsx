// Installs a renderer, exactly as a real app does — same precedent
// `define-space-app-log-api-guards.test.tsx` already establishes.
import '../../../../mod-react.ts'
// Deliberately NO `import '@zanix/datamaster/core'` here — the whole point of this file is
// proving what happens WITHOUT a real `'cache'` core provider registered. See
// `define-space-app-log-api-rate-limit-override.test.tsx`'s own top-level doc for the sibling
// file that registers one (the mirror scenario: genuine enforcement).
import { assert, assertEquals } from '@std/assert'
import { activateApps, deactivateApps } from '@zanix/app/runtime'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { defineSpaceApp } from 'modules/runtime/mod.ts'

/**
 * Real, end-to-end proof of `runDefaultRateLimitGuard`'s own fail-open path
 * (`log.controller.ts`) — as opposed to `define-space-app-log-api-guards.test.tsx`'s first test
 * (which merely shows a single request under the real, generous 30/60s default succeeds, a result
 * that's consistent with EITHER genuine enforcement or fail-open, and doesn't by itself prove
 * either one — see that file's own doc, which only claims to prove wiring, not fail-open).
 *
 * This file proves fail-open specifically by ruling out the "the rate limit itself allowed it"
 * explanation: it configures `logApi.rateLimit.anonymousLimit: 1` — the EXACT same tightened
 * override `define-space-app-log-api-rate-limit-override.test.tsx`'s own first test uses to prove
 * genuine enforcement (2nd request within the window gets a real 429) — but with no `'cache'` core
 * provider registered. If this route's `rateLimitGuard` were genuinely enforcing that budget here,
 * the 2nd request would 429 exactly like that sibling test's own. Instead, BOTH requests succeed —
 * the only explanation left is `runDefaultRateLimitGuard`'s own fail-open catch (a real, confirmed
 * `InternalError` with `meta.kind === 'provider'` / `meta.slot === 'cache'`, thrown by
 * `rateLimitGuard` itself the moment it tries to read the missing `'cache'` provider) letting the
 * request through unthrottled rather than failing the whole relay. A regression that made this
 * route silently start hard-failing (500) OR silently start enforcing without a cache provider
 * (impossible today, but would still contradict this route's own documented "always works, no
 * infrastructure to compose" contract) would both be caught here — the first by these requests no
 * longer both returning 200, the second by the 2nd request suddenly 429ing like the "with a real
 * cache provider" sibling.
 */
Deno.test(
  "defineSpaceApp({ logApi: { rateLimit } }) + activateApps: with NO 'cache' core provider " +
    "registered, the route's own default rateLimitGuard fails OPEN — a tightened " +
    'anonymousLimit of 1 does NOT actually get enforced, unlike the identical override WITH a ' +
    'real cache provider (see the sibling rate-limit-override.test.tsx file)',
  async () => {
    const app = defineSpaceApp({
      name: 'fixture-log-api-fail-open-app',
      logApi: { rateLimit: { anonymousLimit: 1, windowSeconds: 60, trustProxyHeader: true } },
    })

    const activated = await activateApps([app])
    // Explicit, distinct port — same reasoning `define-space-app-log-api-guards.test.tsx`'s own
    // comment already establishes for its own multiple real `rest` servers.
    const [serverId] = await bootstrapServers({
      rest: {
        application: 'fixture-log-api-fail-open-app',
        id: 'fixture-log-api-fail-open-app',
        port: 20911,
      },
    })
    assert(serverId, 'the server should have been started')

    try {
      const info = webServerManager.info(serverId)
      assert(info.addr, 'the started server should be listening')
      // `/log`, not `/api/log` — this server is ANCHORED (explicit `id` above), which skips
      // `@zanix/server`'s own default `/api` globalPrefix entirely (see `bootstrapServerType`'s own
      // doc, `@zanix/server`), and `createLogApiController`'s own `prefix` now defaults to empty
      // (see `log.controller.ts`'s own doc for why) — an UNANCHORED rest server (the real,
      // common case: `zanix space dev`'s own, and a plain `bootstrapRemoteApp(spaceApp,
      // getBootstrapSpaceAppConfig())` production `mod.ts`) is what actually lands on `/api/log`.
      const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${serverId}`
      const post = () =>
        fetch(`${baseUrl}/log`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ level: 'info', message: 'hello' }),
        })

      const first = await post()
      assertEquals(first.status, 200)
      await first.body?.cancel()

      // With a real cache provider (`rate-limit-override.test.tsx`'s own equivalent test), THIS
      // 2nd request 429s. Here it must still succeed — the missing cache provider makes
      // `rateLimitGuard` throw internally, and `runDefaultRateLimitGuard` catches exactly that
      // and lets the request through, never actually counting it against the budget of 1.
      const second = await post()
      assertEquals(
        second.status,
        200,
        'expected the 2nd request to succeed BECAUSE of the fail-open path, not because the ' +
          'rate limit itself allowed it — a real anonymousLimit of 1 would 429 here otherwise, ' +
          "exactly like rate-limit-override.test.tsx's own equivalent test with a real cache " +
          'provider does',
      )
      const body = await second.json()
      assertEquals(body, { ok: true })
    } finally {
      await webServerManager.stop([serverId])
      await deactivateApps(activated)
    }
  },
)
