import { assert, assertEquals } from '@std/assert'
import { getTemporaryFolder } from '@zanix/helpers'
import { bootstrapServers, ProgramModule, webServerManager } from '@zanix/server'
import { createAssetsController } from 'modules/assets-api/controllers/assets.controller.ts'
import { createAssetService } from 'modules/assets-api/asset-service.ts'
import { createLocalFilesystemAssetStorage } from 'modules/assets-api/adapters/local-filesystem-asset-storage.ts'
import { createInMemoryAssetRepository } from 'modules/assets-api/adapters/in-memory-asset-repository.ts'

console.error = () => {}

/**
 * Its own file, one real server boot — same convention `voice-upload-wrong-content-type.test.ts`
 * mirrors for the audio kind. Proves the magic-byte check is genuinely enforced at the HTTP layer,
 * not just the unit layer: `runImageTransformation` must never trust the client-supplied
 * `Content-Type` header alone — a real jpeg-labeled, non-jpeg upload must be rejected before ever
 * reaching `sharp`, never handed straight to it on the header's word alone.
 *
 * No S3/ffmpeg gate needed — rejected by the magic-byte check before `sharp` (or any real
 * transform) is ever invoked, using the REAL default transformer (no fake, no override).
 */

const allowAllGuard = () => Promise.resolve({})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'AssetsController: a real HTTP image upload whose Content-Type claims jpeg but whose ' +
    'bytes are not genuinely a jpeg is rejected by the magic-byte check — status: "failed" with ' +
    'the real, actionable error, the original upload still stored/downloadable',
  fn: async () => {
    const dir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    const service = createAssetService({
      storage: createLocalFilesystemAssetStorage(dir),
      repository: createInMemoryAssetRepository(),
    })

    await ProgramModule.defineApplication('assets-api-image-content-type-mismatch-test', () => {
      createAssetsController({
        prefix: 'assets',
        service,
        guards: { write: [allowAllGuard], read: [allowAllGuard] },
      })
    })
    const [serverId] = await bootstrapServers({
      rest: {
        port: 23006,
        application: 'assets-api-image-content-type-mismatch-test',
        id: 'assets-api-image-content-type-mismatch-test',
      },
    })
    assert(serverId, 'the server should have been started')
    try {
      const info = webServerManager.info(serverId)
      assert(info.addr, 'the started server should be listening')
      const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${serverId}`

      // Real bytes, but claiming a jpeg content-type — the exact "disguise" scenario the magic-byte
      // check exists to catch, sent through the REAL upload path (raw body, real headers).
      const created = await fetch(`${baseUrl}/assets/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      })
      // The upload itself is accepted (a real HTTP 200 — creation always succeeds; the signature
      // check is a TRANSFORM-time concern, recorded via status, same shape the content-type
      // allowlist check already has).
      assertEquals(created.status, 200)
      const record = await created.json()
      assertEquals(record.status, 'failed')
      assert(
        record.error?.message === 'BAD_REQUEST',
        `expected a real BAD_REQUEST error, got: ${JSON.stringify(record.error)}`,
      )
      assertEquals(record.variants.length, 0)

      // The ORIGINAL upload is still downloadable — creation/storage succeeded independently of
      // the later transform failure, exactly like the content-type allowlist's own failure mode.
      const download = await fetch(`${baseUrl}/assets/${record.id}/download`)
      assertEquals(download.status, 200)
      await download.body?.cancel()
    } finally {
      await webServerManager.stop([serverId])
      await Deno.remove(dir, { recursive: true })
    }
  },
})
