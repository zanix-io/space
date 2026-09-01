import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { bootstrapServers, ProgramModule, webServerManager } from '@zanix/server'
import { probeFfmpegAvailability } from 'modules/media/ffmpeg-availability.ts'
import { createAssetsController } from 'modules/assets-api/controllers/assets.controller.ts'
import { createAssetService } from 'modules/assets-api/asset-service.ts'
import { createLocalFilesystemAssetStorage } from 'modules/assets-api/adapters/local-filesystem-asset-storage.ts'
import { createInMemoryAssetRepository } from 'modules/assets-api/adapters/in-memory-asset-repository.ts'

/**
 * Real ffmpeg, a real HTTP server (`bootstrapServers`/`webServerManager`, the SAME technique
 * `@zanix/admin`'s own `templates-admin-api.test.ts` uses — its own file, one server boot, see
 * `voice-upload-deny.test.ts`'s own doc for why), and — deliberately —
 * `LocalFilesystemAssetStorage` rather than `InMemoryAssetStorage`: this suite is the concrete
 * proof the complete vertical slice (upload -> AssetService -> AssetTransformer -> AudioTranscoder
 * -> TransformCache -> AssetStorage -> AssetRepository -> status/result) runs for real, locally,
 * with zero Mongo/S3. `ignore`-gated exactly like every sibling ffmpeg-backed suite in this
 * repo.
 */
const availability = await probeFfmpegAvailability()
const ignore = !availability.available

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

// Passes every request through — the explicit opt-in a real integrator would build from
// `@zanix/auth`'s `AuthTokenValidation`; this test only needs SOME guard that doesn't deny.
const allowAllGuard = () => Promise.resolve({})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  ignore,
  name: 'AssetsController: real voice upload -> transform -> store -> persist -> status -> ' +
    'download, end to end, against a real disk-backed AssetStorage',
  fn: async () => {
    const dir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    const sourcePath = join(dir, 'source.wav')
    await generateFixtureAudio(sourcePath, 1)
    const sourceBytes = await Deno.readFile(sourcePath)

    const service = createAssetService({
      storage: createLocalFilesystemAssetStorage(join(dir, 'storage')),
      repository: createInMemoryAssetRepository(),
    })

    await ProgramModule.defineApplication('assets-api-success-test', () => {
      createAssetsController({
        prefix: 'assets',
        service,
        guards: { write: [allowAllGuard], read: [allowAllGuard] },
      })
    })
    const [serverId] = await bootstrapServers({
      rest: { port: 23002, application: 'assets-api-success-test', id: 'assets-api-success-test' },
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
      assertEquals(record.kind, 'audio')
      assertEquals(record.originalFilename, 'voice.wav')
      assertEquals(record.variants.length, 1)
      const variant = record.variants[0]
      assertEquals(variant.kind, 'audio')
      assertEquals(variant.profile, 'voice')

      const fetched = await fetch(`${baseUrl}/assets/${record.id}`)
      assertEquals(fetched.status, 200)
      assertEquals(await fetched.json(), record)

      const status = await fetch(`${baseUrl}/assets/${record.id}/status`)
      assertEquals(status.status, 200)
      assertEquals(await status.json(), { id: record.id, status: 'completed' })

      // The original downloads byte-identical to what was uploaded.
      const originalDownload = await fetch(`${baseUrl}/assets/${record.id}/download`)
      assertEquals(originalDownload.status, 200)
      const originalBytes = new Uint8Array(await originalDownload.arrayBuffer())
      assertEquals(originalBytes, sourceBytes)

      // The variant downloads real, non-empty, transcoded bytes — genuinely different from the
      // source (a real AAC re-encode of a real tone, never a passthrough copy). Asserted, not just
      // claimed in prose: a real AAC re-encode of a 1s 44.1kHz mono tone is reliably much smaller
      // than the uncompressed WAV source.
      const variantDownload = await fetch(
        `${baseUrl}/assets/${record.id}/download?variant=${variant.variantId}`,
      )
      assertEquals(variantDownload.status, 200)
      const variantBytes = new Uint8Array(await variantDownload.arrayBuffer())
      assert(variantBytes.byteLength > 0, 'expected real, non-empty transcoded bytes')
      assert(
        variantBytes.byteLength < sourceBytes.byteLength,
        `expected the AAC-transcoded variant (${variantBytes.byteLength}B) to be smaller than ` +
          `the source WAV (${sourceBytes.byteLength}B)`,
      )

      // Non-UUID-shaped `id`s never reach the "not found" lookup at all — `AssetIdParamsRTO.id`'s
      // `@IsUUID` (`controllers/rtos/assets.rto.ts`) rejects them at the API boundary first, so
      // this is a 400 (RTO validation), not a 404. The genuine "well-formed UUID, but no such
      // asset" 404 case is covered instead by
      // `src/@tests/functional/runtime/define-space-app-assets-api-activation.test.tsx`, which
      // reaches the same route wiring without needing ffmpeg.
      const missing = await fetch(`${baseUrl}/assets/does-not-exist`)
      assertEquals(missing.status, 400)
      await missing.body?.cancel()
    } finally {
      await webServerManager.stop([serverId])
      await Deno.remove(dir, { recursive: true })
    }
  },
})
