// Installs a renderer, exactly as a real app does — same precedent
// `define-space-app-log-api-guards.test.tsx` already establishes.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { activateApps, deactivateApps } from '@zanix/app/runtime'
import {
  bootstrapServers,
  Provider,
  registerCoreProviderSlot,
  webServerManager,
  ZanixCacheProvider,
} from '@zanix/server'
import { defineSpaceApp } from 'modules/runtime/mod.ts'

/**
 * Registers a real `'cache'` core provider slot, backed by a deliberately BROKEN implementation
 * (extends `ZanixCacheProvider` without overriding `local`/`withLock`) — a real `'cache'` provider
 * IS present, unlike `define-space-app-log-api-fail-open.test.tsx`'s own fixture (no provider
 * registered at all), so `rateLimitGuard`'s own `ctx.providers.get('cache')` lookup succeeds and
 * never throws the specific `InternalError` (`meta.kind === 'provider'`, `meta.slot === 'cache'`)
 * `runDefaultRateLimitGuard` (`log.controller.ts`) narrowly catches. Only once this guard actually
 * tries to USE the cache (`checkRateLimit`'s own `cache.withLock(...)` call) does it fail — with
 * `ZanixCacheProvider`'s own base `methodNotImplementedError`, a genuinely different bug that
 * carries no `meta.kind`/`meta.slot` at all. Own file, same isolation reasoning
 * `define-space-app-log-api-rate-limit-override.test.tsx`'s own top-level doc already documents for
 * its `@zanix/datamaster/core` side effect — `deno test` isolates each file into its own worker, so
 * this fixture's own broken `'cache'` registration never reaches a sibling file's real one.
 */
registerCoreProviderSlot('cache', ZanixCacheProvider, {
  sourcePackage: 'define-space-app-log-api-rate-limit-guard-error.test.tsx',
})
class BrokenCacheProvider extends ZanixCacheProvider {}
Provider('cache')(BrokenCacheProvider)

/**
 * Real, end-to-end proof of `runDefaultRateLimitGuard`'s OWN "never a different, genuine bug"
 * rethrow (`log.controller.ts`) — the one branch neither sibling fixture file exercises:
 * `define-space-app-log-api-fail-open.test.tsx` proves the narrow catch (missing provider, fails
 * OPEN), `define-space-app-log-api-rate-limit-override.test.tsx` proves the no-exception-at-all
 * path (a real, working cache, genuinely enforcing). This file proves the third, documented case —
 * a `'cache'` provider that IS registered but is itself broken — is never mistaken for the
 * missing-provider one and never silently swallowed either: it reaches the caller as a real `500`,
 * the same "in HTTP applications, exceptions are captured by the framework's middleware and
 * translated into the corresponding HTTP response" contract `registerGlobalGuard`'s own doc
 * describes, `@zanix/space` never adding a second, broader catch of its own around it.
 */
Deno.test(
  "defineSpaceApp + activateApps: a 'cache' provider that IS registered but is itself broken " +
    "is a genuinely different bug — runDefaultRateLimitGuard's narrow catch never mistakes it " +
    'for the missing-provider case, so it is rethrown (a real 500), never fails open (200) and ' +
    'never gets treated as enforced (429)',
  async () => {
    const app = defineSpaceApp({ name: 'fixture-log-api-broken-cache-app' })

    const activated = await activateApps([app])
    // Explicit, distinct port — same reasoning `define-space-app-log-api-guards.test.tsx`'s own
    // comment already establishes for its own multiple real `rest` servers.
    const [serverId] = await bootstrapServers({
      rest: {
        application: 'fixture-log-api-broken-cache-app',
        id: 'fixture-log-api-broken-cache-app',
        port: 20912,
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
        body: JSON.stringify({ level: 'info', message: 'hello' }),
      })
      assertEquals(
        res.status,
        500,
        'a broken (but present) cache provider is a genuine bug, not the documented ' +
          'missing-provider case — it must never fail open (200) the way ' +
          "define-space-app-log-api-fail-open.test.tsx's own missing-provider fixture does",
      )
      const body = await res.json()
      // `METHOD_NOT_IMPLEMENTED` — `ZanixCacheProvider`'s own base `withLock`, never the
      // `MISSING_CORE_PROVIDER_SLOT`-shaped error the fail-open fixture's own log line carries —
      // confirms this really is the "different, genuine bug" branch, not a relabeled version of
      // the missing-provider one.
      assertEquals(body.code, 'METHOD_NOT_IMPLEMENTED')
    } finally {
      await webServerManager.stop([serverId])
      await deactivateApps(activated)
    }
  },
)
