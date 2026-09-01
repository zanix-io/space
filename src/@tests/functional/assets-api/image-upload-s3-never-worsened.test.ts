import { assert, assertEquals } from '@std/assert'
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
 * The never-worsened counterpart to `image-upload-s3.test.ts` — split into its OWN file (not a
 * second `Deno.test` block in that same file) per the "its own file, one real server boot"
 * convention `voice-upload-deny.test.ts` already establishes: `deno test` runs each file in its
 * own isolated worker, so two server boots sharing one process (and one `webServerManager`/port
 * 8000) never interfere. Two server boots sharing one process and port, confirmed empirically,
 * produce a real, reproducible `Connection refused` on the second boot — not a bug in the product,
 * just why this file stays split from its sibling.
 *
 * Proves the never-worsened guardrail survives the FULL HTTP+S3 round trip — the ONLY place this
 * repo does: `optimizeImageAsset`'s own "no improvement keeps the original bytes exactly" case is
 * otherwise only proven directly against the transformer (`image-optimize.test.ts`), never through
 * `AssetService`/HTTP/S3.
 */
const runS3 = Deno.env.get('RUN_S3_TESTS') === 'true'

const allowAllGuard = () => Promise.resolve({})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !runS3,
  name: 'AssetsController: image upload — the never-worsened guardrail holds through the REAL ' +
    'HTTP+S3 path: an already-low-quality source is stored byte-identical, never re-inflated',
  fn: async () => {
    Deno.env.set(
      'S3_ENDPOINT',
      Deno.env.get('S3_ENDPOINT') || 'http://localhost:8333',
    )
    // Real, portable replacement for the old query-string-on-a-local-path re-evaluation trick
    // (`datamaster-internal/core.ts?case=...`) — see `resolve-asset-storage-s3.test.ts`'s own doc.
    await closeAllConnections()
    await registerS3Connector()

    const dir = await Deno.makeTempDir()
    // A source already encoded at LOW quality (15) — re-encoding at the pipeline's own higher
    // default quality reliably produces a LARGER result (same fixture/reasoning
    // `image-optimize.test.ts`'s own "no improvement keeps the original bytes exactly" case
    // already verifies for the transformer directly; this proves the SAME guardrail survives the
    // full HTTP+S3 round trip, the only place in this repo that does).
    const sourceBytes = await gradientJpeg(200, 150, 15)

    const service = createAssetService({
      storage: resolveAssetStorage(dir),
      repository: createInMemoryAssetRepository(),
    })

    await ProgramModule.defineApplication('assets-api-image-s3-never-worsened-test', () => {
      createAssetsController({
        prefix: 'assets',
        service,
        guards: { write: [allowAllGuard], read: [allowAllGuard] },
      })
    })
    const [serverId] = await bootstrapServers({
      rest: {
        port: 23008,
        application: 'assets-api-image-s3-never-worsened-test',
        id: 'assets-api-image-s3-never-worsened-test',
      },
    })
    assert(serverId, 'the server should have been started')
    try {
      const info = webServerManager.info(serverId)
      assert(info.addr, 'the started server should be listening')
      const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${serverId}`

      const created = await fetch(`${baseUrl}/assets/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg', 'X-Znx-Asset-Filename': 'low-quality.jpg' },
        body: sourceBytes,
      })
      assertEquals(created.status, 200)
      const record = await created.json()
      assertEquals(record.status, 'completed')
      const variant = record.variants[0]

      const variantDownload = await fetch(
        `${baseUrl}/assets/${record.id}/download?variant=${variant.variantId}`,
      )
      assertEquals(variantDownload.status, 200)
      const variantBytes = new Uint8Array(await variantDownload.arrayBuffer())
      assertEquals(
        variantBytes,
        sourceBytes,
        'expected the never-worsened guardrail to keep the ORIGINAL bytes, byte-for-byte, once ' +
          'a real re-encode at the pipeline default quality would have made the file bigger',
      )
    } finally {
      await webServerManager.stop([serverId])
      await Deno.remove(dir, { recursive: true })
    }
  },
})
