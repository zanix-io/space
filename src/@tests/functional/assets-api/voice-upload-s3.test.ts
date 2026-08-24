import { assert, assertEquals } from '@std/assert'
import {
  bootstrapServers,
  closeAllConnections,
  ProgramModule,
  webServerManager,
} from '@zanix/server'
import { registerS3Connector } from '@zanix/datamaster/core'
import { probeFfmpegAvailability } from 'modules/media/ffmpeg-availability.ts'
import { createAssetsController } from 'modules/assets-api/controllers/assets.controller.ts'
import { createAssetService } from 'modules/assets-api/asset-service.ts'
import { createInMemoryAssetRepository } from 'modules/assets-api/adapters/in-memory-asset-repository.ts'
import { resolveAssetStorage } from '../../support/resolve-asset-storage.ts'

/**
 * The real end-to-end composition: HTTP upload -> AssetsController -> AssetService -> AssetStorage
 * -> (via `resolveAssetStorage()`, `src/@tests/support/`) the real `'s3'` core connector ->
 * `S3ObjectStorage` -> a REAL SeaweedFS instance. No mock on this path — same "genuinely
 * fail if enabled-but-unreachable" convention `@zanix/datamaster`'s own
 * `s3-object-storage.test.ts` functional suite already establishes for `RUN_S3_TESTS`
 * (reused here verbatim: both suites exercise the SAME real external service, so one flag toggles
 * both, no space-specific variant).
 *
 * Its own file, one real server boot — same convention `voice-upload.test.ts`/
 * `voice-upload-deny.test.ts` already establish.
 */
const runS3 = Deno.env.get('RUN_S3_TESTS') === 'true'
const availability = await probeFfmpegAvailability()
const ignore = !runS3 || !availability.available

async function generateFixtureAudio(path: string, durationSeconds = 1): Promise<void> {
  const { success, stderr } = await new Deno.Command('ffmpeg', {
    args: [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:duration=${durationSeconds}`,
      '-ar',
      '44100',
      '-ac',
      '1',
      path,
    ],
    stderr: 'piped',
  }).output()
  assert(success, `fixture generation failed: ${new TextDecoder().decode(stderr)}`)
}

const allowAllGuard = () => Promise.resolve({})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  ignore,
  name: 'AssetsController: real voice upload -> transform -> store -> persist -> status -> ' +
    'download, end to end, against a REAL SeaweedFS-backed AssetStorage (via resolveAssetStorage)',
  fn: async () => {
    Deno.env.set(
      'S3_ENDPOINT',
      Deno.env.get('S3_ENDPOINT') || 'http://localhost:8333',
    )
    // Real, portable replacement for the old query-string-on-a-local-path re-evaluation trick
    // (`datamaster-internal/core.ts?case=...`) — see `resolve-asset-storage-s3.test.ts`'s own doc.
    await closeAllConnections()
    registerS3Connector()

    const dir = await Deno.makeTempDir()
    const sourcePath = `${dir}/source.wav`
    await generateFixtureAudio(sourcePath, 1)
    const sourceBytes = await Deno.readFile(sourcePath)

    const service = createAssetService({
      storage: resolveAssetStorage(dir),
      repository: createInMemoryAssetRepository(),
    })

    await ProgramModule.defineApplication('assets-api-s3-test', () => {
      createAssetsController({
        prefix: 'assets',
        service,
        guards: { write: [allowAllGuard], read: [allowAllGuard] },
      })
    })
    const [serverId] = await bootstrapServers({
      rest: { application: 'assets-api-s3-test', id: 'assets-api-s3-test' },
    })
    assert(serverId, 'the server should have been started')
    try {
      const info = webServerManager.info(serverId)
      assert(info.addr, 'the started server should be listening')
      const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${serverId}`

      const created = await fetch(`${baseUrl}/assets/audio?format=aac`, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav', 'X-Znx-Asset-Filename': 'voice.wav' },
        body: sourceBytes,
      })
      assertEquals(created.status, 200)
      const record = await created.json()
      assertEquals(record.status, 'completed')
      assertEquals(record.variants.length, 1)
      const variant = record.variants[0]

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
      assert(variantBytes.byteLength > 0, 'expected real, non-empty transcoded bytes')
      // Real evidence of a genuine transcode, not just "something non-empty landed in S3" — a
      // regression that stored the raw WAV bytes under the variant key (still non-empty, still
      // downloadable) would otherwise pass undetected. A real AAC re-encode of a 1s 44.1kHz mono
      // tone is reliably much smaller than the uncompressed WAV source.
      assert(
        variantBytes.byteLength < sourceBytes.byteLength,
        `expected the AAC-transcoded variant (${variantBytes.byteLength}B) to be smaller than ` +
          `the source WAV (${sourceBytes.byteLength}B)`,
      )
    } finally {
      await webServerManager.stop([serverId])
      await Deno.remove(dir, { recursive: true })
    }
  },
})
