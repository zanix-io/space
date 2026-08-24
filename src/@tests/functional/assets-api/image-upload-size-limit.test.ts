import { assert, assertEquals } from '@std/assert'
import { getTemporaryFolder } from '@zanix/helpers'
import { bootstrapServers, ProgramModule, webServerManager } from '@zanix/server'
import { createAssetsController } from 'modules/assets-api/controllers/assets.controller.ts'
import { createAssetService } from 'modules/assets-api/asset-service.ts'
import { createLocalFilesystemAssetStorage } from 'modules/assets-api/adapters/local-filesystem-asset-storage.ts'
import { createInMemoryAssetRepository } from 'modules/assets-api/adapters/in-memory-asset-repository.ts'
import { gradientJpeg } from './image-fixtures.ts'

console.error = () => {}

/**
 * Its own file, one real server boot — same convention `voice-upload-wrong-content-type.test.ts`
 * already establishes. No S3/RUN_S3_TESTS gate needed (unlike `image-upload-s3.test.ts`'s own
 * sibling suites): a real disk-backed `LocalFilesystemAssetStorage` is enough to prove the real,
 * found gap this session closed — `AssetService` used to drain an upload's whole `ReadableStream`
 * into memory with no cap, `Content-Length` read but never validated against anything.
 *
 * Proves `AssetServiceOptions.limits`'s two real layers over a REAL HTTP request/response cycle,
 * not just the in-process `createAsset()` calls `asset-service.test.ts` already covers:
 * - a `Content-Length` header (set automatically by `fetch` for a plain `Uint8Array` body) over the
 *   configured limit gets a real `413` — rejected before the body is ever read;
 * - a chunked, `Content-Length`-less body (a real `ReadableStream` body — `fetch` never computes
 *   `Content-Length` up front for one) that still exceeds the limit gets the same real `413`,
 *   proving the cap holds even when the header defense has nothing to check;
 * - a small, genuinely valid jpeg within the limit still uploads, optimizes, and downloads
 *   correctly end to end — configuring a limit never breaks a legitimate upload.
 */

const allowAllGuard = () => Promise.resolve({})
const IMAGE_LIMIT_BYTES = 2000

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'AssetsController: AssetServiceOptions.limits enforced over a real HTTP upload — a ' +
    'declared Content-Length over the limit and a Content-Length-less stream over the limit both ' +
    'get a real 413, while a small legitimate upload still works end to end',
  fn: async () => {
    const dir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    const service = createAssetService({
      storage: createLocalFilesystemAssetStorage(dir),
      repository: createInMemoryAssetRepository(),
      limits: { image: IMAGE_LIMIT_BYTES },
    })

    await ProgramModule.defineApplication('assets-api-image-size-limit-test', () => {
      createAssetsController({
        prefix: 'assets',
        service,
        guards: { write: [allowAllGuard], read: [allowAllGuard] },
      })
    })
    const [serverId] = await bootstrapServers({
      rest: {
        application: 'assets-api-image-size-limit-test',
        id: 'assets-api-image-size-limit-test',
      },
    })
    assert(serverId, 'the server should have been started')
    try {
      const info = webServerManager.info(serverId)
      assert(info.addr, 'the started server should be listening')
      const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${serverId}`

      // 1) A plain Uint8Array body — fetch sets a real Content-Length — over the configured limit.
      const overLimit = new Uint8Array(IMAGE_LIMIT_BYTES + 1)
      const rejectedByHeader = await fetch(`${baseUrl}/assets/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: overLimit,
      })
      assertEquals(rejectedByHeader.status, 413)
      await rejectedByHeader.body?.cancel()

      // 2) A chunked, Content-Length-less body that STILL exceeds the limit — the real defense,
      // since Content-Length is optional/absent for a genuine streamed upload.
      const chunkedOverLimit = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(IMAGE_LIMIT_BYTES + 1))
          controller.close()
        },
      })
      const rejectedByStream = await fetch(`${baseUrl}/assets/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: chunkedOverLimit,
        duplex: 'half',
      } as RequestInit)
      assertEquals(rejectedByStream.status, 413)
      await rejectedByStream.body?.cancel()

      // 3) A small, genuinely valid jpeg well within the limit — the cap must never block a
      // legitimate upload, and the whole vertical slice (upload -> optimize -> store -> download)
      // still works end to end.
      const smallJpeg = await gradientJpeg(16, 16, 50)
      assert(
        smallJpeg.byteLength < IMAGE_LIMIT_BYTES,
        `fixture must genuinely fit under the ${IMAGE_LIMIT_BYTES}-byte limit for this test to ` +
          `prove anything (got ${smallJpeg.byteLength} bytes)`,
      )
      const accepted = await fetch(`${baseUrl}/assets/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: smallJpeg,
      })
      assertEquals(accepted.status, 200)
      const record = await accepted.json()
      assertEquals(record.status, 'completed')
      assertEquals(record.variants.length, 1)

      const downloaded = await fetch(`${baseUrl}/assets/${record.id}/download`)
      assertEquals(downloaded.status, 200)
      const downloadedBytes = new Uint8Array(await downloaded.arrayBuffer())
      assertEquals(downloadedBytes, smallJpeg)
    } finally {
      await webServerManager.stop([serverId])
      await Deno.remove(dir, { recursive: true })
    }
  },
})
