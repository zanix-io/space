import { assert, assertEquals, assertNotEquals } from '@std/assert'
import {
  bootstrapServers,
  closeAllConnections,
  ProgramModule,
  webServerManager,
} from '@zanix/server'
import { registerS3Connector } from '@zanix/datamaster/core'
import { createAssetsController } from 'modules/assets-api/controllers/assets.controller.ts'
import { createAssetService } from 'modules/assets-api/asset-service.ts'
import { createInMemoryAssetRepository } from 'modules/assets-api/adapters/in-memory-asset-repository.ts'
import { resolveAssetStorage } from '../../support/resolve-asset-storage.ts'
import { gradientJpeg } from './image-fixtures.ts'

/**
 * The real end-to-end composition for an IMAGE upload — HTTP -> AssetsController -> AssetService
 * -> AssetStorage -> (via `resolveAssetStorage()`) the real `'s3'` core connector ->
 * `S3ObjectStorage` -> a REAL SeaweedFS instance. Same gating/setup convention as
 * `voice-upload-s3.test.ts`, which this file mirrors for the image kind — that one, plus
 * `assets-encrypted-s3-e2e.test.ts`, previously only proved images STORE and DOWNLOAD via S3, never
 * that the bytes are actually SMALLER/optimized once they get there; this file closes that gap with
 * real, quality-sensitive fixtures (same technique `image-optimize.test.ts` already uses for the
 * transformer itself). The never-worsened counterpart lives in its own sibling file,
 * `image-upload-s3-never-worsened.test.ts` — see that file's own doc for why.
 *
 * Its own file, one real server boot — same convention `voice-upload-s3.test.ts` already
 * establishes.
 */
const runS3 = Deno.env.get('RUN_S3_TESTS') === 'true'

const allowAllGuard = () => Promise.resolve({})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !runS3,
  name: 'AssetsController: real image upload -> optimize -> store -> download, end to end, ' +
    'against a REAL SeaweedFS-backed AssetStorage — the variant is genuinely smaller than the ' +
    'source, not just non-empty',
  fn: async () => {
    Deno.env.set(
      'S3_ENDPOINT',
      Deno.env.get('S3_ENDPOINT') || 'http://localhost:8333',
    )
    // Real, portable replacement for the old query-string-on-a-local-path re-evaluation trick
    // (`datamaster-internal/core.ts?case=...`) — see `resolve-asset-storage-s3.test.ts`'s own doc.
    // `registerS3Connector` is a real, callable export now, so a fresh connector registry entry
    // (reading `S3_ENDPOINT` just set above) needs no module re-evaluation at all.
    await closeAllConnections()
    await registerS3Connector()

    const dir = await Deno.makeTempDir()
    // A high-quality (100) source — re-encoding through the pipeline's own default optimize
    // quality reliably wins, same as `image-optimize.test.ts`'s own "a real improvement" case.
    const sourceBytes = await gradientJpeg(200, 150, 100)

    const service = createAssetService({
      storage: resolveAssetStorage(dir),
      repository: createInMemoryAssetRepository(),
    })

    await ProgramModule.defineApplication('assets-api-image-s3-test', () => {
      createAssetsController({
        prefix: 'assets',
        service,
        guards: { write: [allowAllGuard], read: [allowAllGuard] },
      })
    })
    const [serverId] = await bootstrapServers({
      rest: { application: 'assets-api-image-s3-test', id: 'assets-api-image-s3-test' },
    })
    assert(serverId, 'the server should have been started')
    try {
      const info = webServerManager.info(serverId)
      assert(info.addr, 'the started server should be listening')
      const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${serverId}`

      const created = await fetch(`${baseUrl}/assets/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg', 'X-Znx-Asset-Filename': 'photo.jpg' },
        body: sourceBytes,
      })
      assertEquals(created.status, 200)
      const record = await created.json()
      assertEquals(record.status, 'completed')
      assertEquals(record.variants.length, 1)
      const variant = record.variants[0]
      assertEquals(variant.kind, 'image')

      // Bytes really round-trip through SeaweedFS, not just through the in-process repository.
      const originalDownload = await fetch(`${baseUrl}/assets/${record.id}/download`)
      assertEquals(originalDownload.status, 200)
      const originalBytes = new Uint8Array(await originalDownload.arrayBuffer())
      assertEquals(originalBytes, sourceBytes)

      const variantDownload = await fetch(
        `${baseUrl}/assets/${record.id}/download?variant=${variant.variantId}`,
      )
      assertEquals(variantDownload.status, 200)
      const variantBytes = new Uint8Array(await variantDownload.arrayBuffer())
      assert(variantBytes.byteLength > 0, 'expected real, non-empty optimized bytes')
      assertNotEquals(variantBytes, sourceBytes)
      assert(
        variantBytes.byteLength < sourceBytes.byteLength,
        `expected the optimized image (${variantBytes.byteLength}B) to be smaller than the ` +
          `source (${sourceBytes.byteLength}B) once actually stored in and re-downloaded from S3`,
      )
    } finally {
      await webServerManager.stop([serverId])
      await Deno.remove(dir, { recursive: true })
    }
  },
})
