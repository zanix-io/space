import { assert, assertEquals } from '@std/assert'
import { getTemporaryFolder } from '@zanix/helpers'
import { bootstrapServers, ProgramModule, webServerManager } from '@zanix/server'
import { createAssetsController } from 'modules/assets-api/controllers/assets.controller.ts'
import { createAssetService } from 'modules/assets-api/asset-service.ts'
import { createLocalFilesystemAssetStorage } from 'modules/assets-api/adapters/local-filesystem-asset-storage.ts'
import { createInMemoryAssetRepository } from 'modules/assets-api/adapters/in-memory-asset-repository.ts'

console.error = () => {}

/**
 * Its own file, one real server boot — same convention `voice-upload.test.ts`/`voice-upload-deny.
 * test.ts` already establish. Proves the voice profile's own `.wav`-only guardrail
 * (`validateVoiceSource`) is genuinely enforced at the HTTP layer, not just the unit layer:
 * `AssetService` must never hardcode `.wav` as the temp source file's own extension regardless of
 * what a caller actually uploads — it derives that extension from the REAL, stored `Content-Type`
 * instead, which is what lets the guardrail actually fire through a real upload rather than always
 * seeing a fixed `.wav` label internally, no matter what content arrives.
 *
 * No `ignore` gate — this never reaches real ffmpeg (rejected before it's ever probed), so it runs
 * unconditionally, unlike its sibling `voice-upload.test.ts`.
 */

const allowAllGuard = () => Promise.resolve({})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'AssetsController: a real HTTP upload whose Content-Type is not audio/wav is rejected ' +
    'by the voice guardrail — status: "failed" with the real, actionable error, never a silent ' +
    'success masquerading a non-wav upload as voice-transcodable',
  fn: async () => {
    const dir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    const service = createAssetService({
      storage: createLocalFilesystemAssetStorage(dir),
      repository: createInMemoryAssetRepository(),
    })

    await ProgramModule.defineApplication('assets-api-wrong-content-type-test', () => {
      createAssetsController({
        prefix: 'assets',
        service,
        guards: { write: [allowAllGuard], read: [allowAllGuard] },
      })
    })
    const [serverId] = await bootstrapServers({
      rest: {
        port: 23001,
        application: 'assets-api-wrong-content-type-test',
        id: 'assets-api-wrong-content-type-test',
      },
    })
    assert(serverId, 'the server should have been started')
    try {
      const info = webServerManager.info(serverId)
      assert(info.addr, 'the started server should be listening')
      const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${serverId}`

      // Real bytes, but claiming a lossy MP3 content-type — the exact "disguise" scenario the
      // guardrail exists to catch, sent through the REAL upload path (raw body, real headers).
      const created = await fetch(`${baseUrl}/assets/audio?format=aac`, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/mpeg', 'X-Znx-Asset-Filename': 'upload.mp3' },
        body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      })
      // The upload itself is accepted (a real HTTP 200 — creation always succeeds; the guardrail
      // is a TRANSFORM-time concern, recorded via status, same as any other transform failure —
      // see `JobDispatcher`'s own doc for why this is never a synchronous 400 here).
      assertEquals(created.status, 200)
      const record = await created.json()
      assertEquals(record.status, 'failed')
      assert(
        record.error?.message.includes('Voice audio transcoding only accepts .wav sources'),
        `expected the real guardrail message, got: ${JSON.stringify(record.error)}`,
      )
      assertEquals(record.variants.length, 0)

      // The status endpoint reports the same failure.
      const status = await fetch(`${baseUrl}/assets/${record.id}/status`)
      assertEquals(status.status, 200)
      const statusBody = await status.json()
      assertEquals(statusBody.status, 'failed')
      assert(statusBody.error?.message.includes('only accepts .wav sources'))

      // The ORIGINAL upload is still downloadable — creation/storage succeeded independently of
      // the later transform failure, exactly like any other transform-failure case.
      const download = await fetch(`${baseUrl}/assets/${record.id}/download`)
      assertEquals(download.status, 200)
      await download.body?.cancel()
    } finally {
      await webServerManager.stop([serverId])
      await Deno.remove(dir, { recursive: true })
    }
  },
})
