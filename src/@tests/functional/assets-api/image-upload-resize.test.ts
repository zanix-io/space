import { assert, assertEquals } from '@std/assert'
import sharp from 'sharp'
import { getTemporaryFolder } from '@zanix/helpers'
import { bootstrapServers, ProgramModule, webServerManager } from '@zanix/server'
import { createAssetsController } from 'modules/assets-api/controllers/assets.controller.ts'
import { createAssetService } from 'modules/assets-api/asset-service.ts'
import { createLocalFilesystemAssetStorage } from 'modules/assets-api/adapters/local-filesystem-asset-storage.ts'
import { createInMemoryAssetRepository } from 'modules/assets-api/adapters/in-memory-asset-repository.ts'
import { gradientJpeg } from './image-fixtures.ts'

console.error = () => {}

/**
 * Its own file, one real server boot — same convention every sibling suite in this directory
 * already establishes. Uses the REAL default transformer (real `sharp`, no fake, no override) over
 * a real, disk-backed `LocalFilesystemAssetStorage` — no S3 gate needed, since this only exercises
 * `AssetsControllerOptions.imageOptimizeOptions` end to end, not a specific storage backend.
 *
 * Proves the real regression this suite exists to catch: a `POST /assets/image` upload wider than
 * a configured `imageOptimizeOptions.breakpoints` max width comes back resized, not merely
 * recompressed. Reads the actual pixel width back out of the downloaded variant's own bytes with
 * `sharp` (the same mechanism `optimizeImageAsset` itself uses internally) rather than asserting on
 * byte size alone — a smaller file size alone never proves a resize happened, since recompression
 * can shrink bytes at the same dimensions.
 */

const allowAllGuard = () => Promise.resolve({})
const MAX_WIDTH = 800
const SOURCE_WIDTH = 2000
const SOURCE_HEIGHT = 1500

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'AssetsController: a controller configured with imageOptimizeOptions.breakpoints ' +
    'resizes a real upload wider than the configured max width down to it, storing the resized ' +
    'bytes as a real, independently downloadable variant',
  fn: async () => {
    const dir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    const service = createAssetService({
      storage: createLocalFilesystemAssetStorage(dir),
      repository: createInMemoryAssetRepository(),
    })

    await ProgramModule.defineApplication('assets-api-image-resize-test', () => {
      createAssetsController({
        prefix: 'assets',
        service,
        guards: { write: [allowAllGuard], read: [allowAllGuard] },
        imageOptimizeOptions: { breakpoints: [MAX_WIDTH] },
      })
    })
    const [serverId] = await bootstrapServers({
      rest: {
        port: 23011,
        application: 'assets-api-image-resize-test',
        id: 'assets-api-image-resize-test',
      },
    })
    assert(serverId, 'the server should have been started')
    try {
      const info = webServerManager.info(serverId)
      assert(info.addr, 'the started server should be listening')
      const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${serverId}`

      const sourceBytes = await gradientJpeg(SOURCE_WIDTH, SOURCE_HEIGHT, 90)
      const sourceMeta = await sharp(sourceBytes).metadata()
      assertEquals(sourceMeta.width, SOURCE_WIDTH)
      assert(
        SOURCE_WIDTH > MAX_WIDTH,
        'the fixture must genuinely be wider than the configured max width for this test to prove ' +
          'anything',
      )

      const created = await fetch(`${baseUrl}/assets/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg', 'X-Znx-Asset-Filename': 'photo.jpg' },
        body: sourceBytes,
      })
      assertEquals(created.status, 200)
      const record = await created.json()
      assertEquals(record.status, 'completed')

      // Exactly one derived variant — the untouched original (already stored under
      // `record.storageKey`) is never re-stored as a variant of its own.
      assertEquals(record.variants.length, 1)
      const variant = record.variants[0]
      assertEquals(variant.kind, 'image')
      assertEquals(variant.policyVersion, 'v2')

      const variantDownload = await fetch(
        `${baseUrl}/assets/${record.id}/download?variant=${variant.variantId}`,
      )
      assertEquals(variantDownload.status, 200)
      const variantBytes = new Uint8Array(await variantDownload.arrayBuffer())

      // The real regression check: decode the actual downloaded bytes and read their real pixel
      // width — never inferred from byte size alone.
      const variantMeta = await sharp(variantBytes).metadata()
      assert(
        variantMeta.width !== undefined && variantMeta.width <= MAX_WIDTH,
        `expected the resized variant's real width (${variantMeta.width}px) to be at or under ` +
          `the configured ${MAX_WIDTH}px max`,
      )

      // The original upload is still fully intact and downloadable at its own real, full width —
      // resizing a variant never discards or mutates the original bytes.
      const originalDownload = await fetch(`${baseUrl}/assets/${record.id}/download`)
      assertEquals(originalDownload.status, 200)
      const originalBytes = new Uint8Array(await originalDownload.arrayBuffer())
      assertEquals(originalBytes, sourceBytes)
      const originalMeta = await sharp(originalBytes).metadata()
      assertEquals(originalMeta.width, SOURCE_WIDTH)
    } finally {
      await webServerManager.stop([serverId])
      await Deno.remove(dir, { recursive: true })
    }
  },
})
