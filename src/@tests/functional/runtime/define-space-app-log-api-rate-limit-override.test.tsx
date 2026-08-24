// Installs a renderer, exactly as a real app does — same precedent
// `define-space-app-log-api-guards.test.tsx` already establishes.
import '../../../../mod-react.ts'
// Registers a REAL `'cache'` core provider (in-memory `cache:local` connector) — a module-level
// side effect that, once registered, stays registered for the rest of THIS process. Deliberately
// its own file, not folded into `define-space-app-log-api-fail-open.test.tsx`: `deno test`
// isolates each file into its own worker, so that sibling file's own "no cache provider
// registered" fixture (proving the fail-open path, see ITS own top-level doc — not this file's
// nor `define-space-app-log-api-guards.test.tsx`'s, which only proves wiring) is never
// contaminated by this one — same isolation reasoning `resolve-asset-storage-local.test.ts`'s own
// top-level doc already documents for the identical `@zanix/datamaster/core` side effect. Only
// ever imported from a TEST file — `@zanix/space`'s own runtime source never does this (see
// `modules/assets-api/mod.ts`'s own doc).
import '@zanix/datamaster/core'
import { assert, assertEquals } from '@std/assert'
import { activateApps, deactivateApps } from '@zanix/app/runtime'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { defineSpaceApp } from 'modules/runtime/mod.ts'

/**
 * Real, end-to-end proof that `SpaceAppConfig.logApi.rateLimit` genuinely overrides the default
 * guard's own `anonymousLimit`/`windowSeconds`/`trustProxyHeader` — as opposed to `logApi.guards`
 * (proven in the sibling file), which can only ever ADD restrictions on top, never change the
 * budget itself. Needs a REAL `'cache'` core provider (see the `@zanix/datamaster/core` import
 * above) for the rate limit to actually enforce rather than fail open — see
 * `runDefaultRateLimitGuard`'s own doc in `log.controller.ts` for why a missing provider fails
 * open instead of a hard `500`, which would otherwise mask this test's own intent (every request
 * would 200 regardless of the override).
 */
Deno.test(
  'defineSpaceApp({ logApi: { rateLimit } }) + activateApps: a tightened anonymousLimit is ' +
    'genuinely enforced — the 2nd request within the same window is rejected with 429, the 1st ' +
    'is not',
  async () => {
    const app = defineSpaceApp({
      name: 'fixture-log-api-rate-limit-override-app',
      logApi: { rateLimit: { anonymousLimit: 1, windowSeconds: 60, trustProxyHeader: true } },
    })

    const activated = await activateApps([app])
    // Explicit, distinct port — same reasoning `define-space-app-log-api-guards.test.tsx`'s own
    // comment already establishes for its own multiple real `rest` servers.
    const [serverId] = await bootstrapServers({
      rest: {
        application: 'fixture-log-api-rate-limit-override-app',
        id: 'fixture-log-api-rate-limit-override-app',
        port: 20909,
      },
    })
    assert(serverId, 'the server should have been started')

    try {
      const info = webServerManager.info(serverId)
      assert(info.addr, 'the started server should be listening')
      const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${serverId}`
      const post = () =>
        fetch(`${baseUrl}/api/log`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ level: 'info', message: 'hello' }),
        })

      const first = await post()
      assertEquals(first.status, 200)
      await first.body?.cancel()

      const second = await post()
      assertEquals(second.status, 429)
      await second.body?.cancel()
    } finally {
      await webServerManager.stop([serverId])
      await deactivateApps(activated)
    }
  },
)

Deno.test(
  'defineSpaceApp: omitting logApi.rateLimit still enforces the real, unmodified default ' +
    '(30/60s) — a single request comfortably within it succeeds',
  async () => {
    const app = defineSpaceApp({ name: 'fixture-log-api-real-default-rate-limit-app' })

    const activated = await activateApps([app])
    const [serverId] = await bootstrapServers({
      rest: {
        application: 'fixture-log-api-real-default-rate-limit-app',
        id: 'fixture-log-api-real-default-rate-limit-app',
        port: 20910,
      },
    })
    assert(serverId, 'the server should have been started')

    try {
      const info = webServerManager.info(serverId)
      assert(info.addr, 'the started server should be listening')
      const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${serverId}`

      const res = await fetch(`${baseUrl}/api/log`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ level: 'info', message: 'hello' }),
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
