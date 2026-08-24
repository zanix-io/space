import { assert, assertEquals, assertNotEquals } from '@std/assert'
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
 * The real end-to-end composition for a VIDEO upload — HTTP -> AssetsController -> AssetService ->
 * AssetStorage -> (via `resolveAssetStorage()`) the real `'s3'` core connector ->
 * `S3ObjectStorage` -> a REAL SeaweedFS instance. Same gating/setup convention as
 * `voice-upload-s3.test.ts`/`image-upload-s3.test.ts`, which this file mirrors for the video kind
 * — previously video only reached S3 inside `assets-encrypted-s3-e2e.test.ts` (a tiny 64x64 fixture
 * proving encryption, never a real size reduction). This file closes that gap: a real,
 * higher-resolution source, transcoded down at the default `'mlg'` breakpoint (720px width), and
 * proven genuinely smaller once actually round-tripped through S3.
 *
 * Its own file, one real server boot — same convention every sibling S3 functional test uses.
 */
const runS3 = Deno.env.get('RUN_S3_TESTS') === 'true'
const availability = await probeFfmpegAvailability()
const ignore = !runS3 || !availability.available

/** Same fixture-generation approach `system-ffmpeg-transcoder.test.ts` already proved reliable for
 * this exact purpose: `testsrc` (real per-frame entropy, unlike a flat `color` source) at a
 * resolution ABOVE the target breakpoint's own cap, so a genuine resize+bitrate-capped re-encode
 * reliably wins over the source — confirmed there empirically before being reused here. */
async function generateFixtureVideo(path: string): Promise<void> {
  const { success, stderr } = await new Deno.Command('ffmpeg', {
    args: [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=1280x720:duration=2:rate=10',
      '-pix_fmt',
      'yuv420p',
      '-c:v',
      'libx264',
      path,
    ],
    stderr: 'piped',
  }).output()
  assert(success, `video fixture generation failed: ${new TextDecoder().decode(stderr)}`)
}

const allowAllGuard = () => Promise.resolve({})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  ignore,
  name: 'AssetsController: real video upload -> transcode -> store -> download, end to end, ' +
    'against a REAL SeaweedFS-backed AssetStorage — the variant is genuinely smaller than the ' +
    'source, not just non-empty',
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
    const sourcePath = `${dir}/source.mp4`
    // 1280x720 — ABOVE the default 'mlg' breakpoint's own 720px width cap, so the real transcode
    // must scale down (same rule `system-ffmpeg-transcoder.test.ts` already proved against
    // `'msm'`, which shares the same 720px width as `'mlg'`).
    await generateFixtureVideo(sourcePath)
    const sourceBytes = await Deno.readFile(sourcePath)

    const service = createAssetService({
      storage: resolveAssetStorage(dir),
      repository: createInMemoryAssetRepository(),
    })

    await ProgramModule.defineApplication('assets-api-video-s3-test', () => {
      createAssetsController({
        prefix: 'assets',
        service,
        guards: { write: [allowAllGuard], read: [allowAllGuard] },
      })
    })
    const [serverId] = await bootstrapServers({
      rest: { application: 'assets-api-video-s3-test', id: 'assets-api-video-s3-test' },
    })
    assert(serverId, 'the server should have been started')
    try {
      const info = webServerManager.info(serverId)
      assert(info.addr, 'the started server should be listening')
      const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${serverId}`

      // No `?breakpoint=` — proves the real, working default ('mlg') actually engages.
      const created = await fetch(`${baseUrl}/assets/video`, {
        method: 'POST',
        headers: { 'Content-Type': 'video/mp4', 'X-Znx-Asset-Filename': 'clip.mp4' },
        body: sourceBytes,
      })
      assertEquals(created.status, 200)
      const record = await created.json()
      assertEquals(record.status, 'completed')
      assertEquals(record.variants.length, 1)
      const variant = record.variants[0]
      assertEquals(variant.kind, 'video')
      assertEquals(variant.transformId, 'video-mlg')

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
      assertNotEquals(variantBytes, sourceBytes)
      assert(
        variantBytes.byteLength < sourceBytes.byteLength,
        `expected the transcoded video (${variantBytes.byteLength}B, capped to 720px width) to ` +
          `be smaller than the 1280x720 source (${sourceBytes.byteLength}B) once actually stored ` +
          `in and re-downloaded from S3`,
      )
    } finally {
      await webServerManager.stop([serverId])
      await Deno.remove(dir, { recursive: true })
    }
  },
})
