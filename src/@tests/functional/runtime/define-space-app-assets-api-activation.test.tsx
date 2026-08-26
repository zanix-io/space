// Installs a renderer, exactly as a real app does — same precedent
// `define-space-app-activation.test.tsx` already establishes.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { activateApps, deactivateApps } from '@zanix/app/runtime'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { defineSpaceApp } from 'modules/runtime/mod.ts'
import { createAssetService } from 'modules/assets-api/asset-service.ts'
import { createInMemoryAssetStorage } from 'modules/assets-api/adapters/in-memory-asset-storage.ts'
import { createInMemoryAssetRepository } from 'modules/assets-api/adapters/in-memory-asset-repository.ts'
import { ZANIX_APP_RUNTIME_SERVER_SKEW_BLOCKED } from '../../support/zanix-app-runtime-server-skew.ts'

/**
 * Real, end-to-end proof that `SpaceAppConfig.assetsApi` actually activates the Asset API —
 * `defineSpaceApp({ assetsApi: { service } })` -> `activateApps()` -> a real HTTP server that
 * reaches the given `AssetService`. Same `activateApps`/`bootstrapServers`/`webServerManager.info`
 * technique every S3 functional test under `src/@tests/functional/assets-api/` already uses.
 *
 * Doesn't re-prove upload/transform/optimize (real ffmpeg/sharp fixtures, already covered
 * end-to-end against real S3 in `src/@tests/functional/assets-api/`) — this test's only job is
 * confirming the WIRING: a record seeded directly through the SAME `AssetService` handed to
 * `assetsApi` is reachable over real HTTP once activated this way, proving the route genuinely
 * reaches the given service rather than some other/no service at all.
 *
 * Also the canonical place for the "well-formed UUID, but no such asset" 404 case: this file
 * already boots a real HTTP server with no ffmpeg involved, so it's the cheaper spot for that
 * plumbing check than `voice-upload.test.ts` (which asserts the separate 400-for-a-non-UUID-`id`
 * case instead — RTO validation, never reaches this lookup at all).
 */
const allowAllGuard = () => Promise.resolve({})

Deno.test({
  ignore: ZANIX_APP_RUNTIME_SERVER_SKEW_BLOCKED,
  name:
    "defineSpaceApp({ assetsApi }) + activateApps: the Asset API registers under this app's own " +
    'Application and reaches the exact AssetService instance handed to it',
  fn: async () => {
    const repository = createInMemoryAssetRepository()
    const service = createAssetService({
      storage: createInMemoryAssetStorage(),
      repository,
    })
    // Seeded directly, bypassing upload/transform entirely — this test proves ROUTING/WIRING,
    // not optimization (see this file's own top-level doc for where that's already proven). A
    // real UUID, same as `AssetService`'s own `generateUUID()` would mint — `AssetIdParamsRTO.id`
    // now requires it (`@IsUUID`), so a placeholder string id would 400 before ever reaching the
    // lookup below.
    const seeded = await repository.create({
      id: crypto.randomUUID(),
      kind: 'image',
      contentType: 'image/jpeg',
      size: 3,
      checksum: 'irrelevant-for-this-test',
      storageKey: 'assets/seeded-asset/original',
    })

    const app = defineSpaceApp({
      name: 'fixture-assets-api-app',
      assetsApi: {
        service,
        guards: { write: [allowAllGuard], read: [allowAllGuard] },
      },
    })

    const activated = await activateApps([app])
    const [serverId] = await bootstrapServers({
      rest: { application: 'fixture-assets-api-app', id: 'fixture-assets-api-app' },
    })
    assert(serverId, 'the server should have been started')
    try {
      const info = webServerManager.info(serverId)
      assert(info.addr, 'the started server should be listening')
      const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${serverId}`

      const res = await fetch(`${baseUrl}/assets/${seeded.id}`)
      assertEquals(res.status, 200)
      const body = await res.json()
      assertEquals(body.id, seeded.id)
      assertEquals(body.kind, 'image')
      assertEquals(body.status, 'pending')

      // Non-UUID-shaped `id`s never reach the lookup — `AssetIdParamsRTO.id`'s `@IsUUID` rejects
      // them at the API boundary first (see `voice-upload.test.ts`'s own equivalent assertion).
      const malformed = await fetch(`${baseUrl}/assets/does-not-exist`)
      assertEquals(malformed.status, 400)
      await malformed.body?.cancel()

      // A syntactically valid UUID that was genuinely never created (never seeded through
      // `AssetService`/the repository above) still 404s — the real "not found" path, as opposed
      // to the 400-for-malformed-`id` case above.
      const missing = await fetch(`${baseUrl}/assets/${crypto.randomUUID()}`)
      assertEquals(missing.status, 404)
      await missing.body?.cancel()
    } finally {
      await webServerManager.stop([serverId])
      await deactivateApps(activated)
    }
  },
})
