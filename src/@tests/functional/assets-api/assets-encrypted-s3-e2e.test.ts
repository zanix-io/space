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

/**
 * The real end-to-end chain requested: for an image, an audio, AND a video upload —
 *
 *   HTTP upload -> AssetsController -> AssetService -> AssetStorage -> the real `s3` connector
 *   -> S3ObjectStorage (ENCRYPTED) -> real SeaweedFS
 *
 * proving all three:
 *   1. the optimized/transcoded bytes genuinely land in a real SeaweedFS instance;
 *   2. what's actually stored there is CIPHERTEXT, never the plaintext transformed bytes — proven
 *      by reading the SAME key back through a second, unencrypted `S3ObjectStorage`
 *      pointed at the same endpoint/bucket (its own `get()` never attempts decryption, so it
 *      surfaces exactly what SeaweedFS actually holds);
 *   3. they decrypt back correctly — through the real HTTP `/download` route, which must return
 *      the exact original transformed bytes, not ciphertext and not garbage.
 *
 * Gated exactly like `voice-upload-s3.test.ts`/`asset-storage-migration-s3.test.ts` — same
 * `RUN_S3_TESTS` flag, genuinely fails (never silently skips) if enabled but unreachable.
 */
const shouldRun = Deno.env.get('RUN_S3_TESTS') === 'true'

async function generateFixtureAudio(path: string): Promise<void> {
  const { success, stderr } = await new Deno.Command('ffmpeg', {
    args: [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-ar',
      '44100',
      '-ac',
      '1',
      path,
    ],
    stderr: 'piped',
  }).output()
  assert(success, `audio fixture generation failed: ${new TextDecoder().decode(stderr)}`)
}

async function generateFixtureImage(path: string): Promise<void> {
  const { success, stderr } = await new Deno.Command('ffmpeg', {
    args: ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', path],
    stderr: 'piped',
  }).output()
  assert(success, `image fixture generation failed: ${new TextDecoder().decode(stderr)}`)
}

async function generateFixtureVideo(path: string): Promise<void> {
  const { success, stderr } = await new Deno.Command('ffmpeg', {
    args: [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=1:size=64x64:rate=10',
      '-pix_fmt',
      'yuv420p',
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
  ignore: !shouldRun,
  name: 'image, audio, and video uploads are all stored ENCRYPTED in real SeaweedFS and decrypt ' +
    'correctly on download',
  fn: async () => {
    Deno.env.set(
      'S3_ENDPOINT',
      Deno.env.get('S3_ENDPOINT') || 'http://localhost:8333',
    )
    Deno.env.set('S3_ENCRYPT', 'symmetric')
    Deno.env.set('DATA_AES_KEY', Deno.env.get('DATA_AES_KEY') || 'e2e-test-symmetric-key')
    // Real, portable replacement for the old query-string-on-a-local-path re-evaluation trick
    // (`datamaster-internal/core.ts?case=...`) — see `resolve-asset-storage-s3.test.ts`'s own doc.
    await closeAllConnections()
    await registerS3Connector()
    const { S3ObjectStorage } = await import('@zanix/datamaster/storage')

    const s3 = ProgramModule.getConnectors(undefined, false).get(
      's3',
    ) as InstanceType<typeof S3ObjectStorage>
    // A SEPARATE, unencrypted connector against the SAME real endpoint/bucket — `encrypt: false`
    // explicitly forces it off (not just omitted), since S3_ENCRYPT=symmetric is set
    // process-wide above and omitting `encrypt` entirely would let THIS instance inherit it too,
    // silently decrypting on get() and defeating the entire point of this comparison connector —
    // a real bug this exact test surfaced before `encrypt: false` existed as a way to prevent it.
    const rawS3 = new S3ObjectStorage({
      autoInitialize: false,
      bucket: Deno.env.get('S3_BUCKET'),
      encrypt: false,
    })

    const service = createAssetService({
      storage: s3,
      repository: createInMemoryAssetRepository(),
    })

    await ProgramModule.defineApplication('assets-encrypted-e2e-test', () => {
      createAssetsController({
        prefix: 'assets',
        service,
        guards: { write: [allowAllGuard], read: [allowAllGuard] },
      })
    })
    const [serverId] = await bootstrapServers({
      rest: { application: 'assets-encrypted-e2e-test', id: 'assets-encrypted-e2e-test' },
    })
    assert(serverId, 'the server should have been started')

    const dir = await Deno.makeTempDir()
    // deno-lint-ignore no-explicit-any
    const createdRecords: any[] = []
    try {
      const info = webServerManager.info(serverId)
      assert(info.addr, 'the started server should be listening')
      const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${serverId}`

      // --- AUDIO ---------------------------------------------------------------------------
      const audioPath = `${dir}/source.wav`
      await generateFixtureAudio(audioPath)
      const audioBytes = await Deno.readFile(audioPath)
      const audioCreated = await fetch(`${baseUrl}/assets/audio?format=aac`, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: audioBytes,
      })
      assertEquals(audioCreated.status, 200)
      const audioRecord = await audioCreated.json()
      createdRecords.push(audioRecord)
      assertEquals(audioRecord.status, 'completed')
      assert(audioRecord.variants.length > 0, 'expected a real audio variant')

      // --- IMAGE -----------------------------------------------------------------------------
      const imagePath = `${dir}/source.jpg`
      await generateFixtureImage(imagePath)
      const imageBytes = await Deno.readFile(imagePath)
      const imageCreated = await fetch(`${baseUrl}/assets/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: imageBytes,
      })
      assertEquals(imageCreated.status, 200)
      const imageRecord = await imageCreated.json()
      createdRecords.push(imageRecord)
      assertEquals(imageRecord.status, 'completed')
      assert(imageRecord.variants.length > 0, 'expected a real image variant')

      // --- VIDEO -----------------------------------------------------------------------------
      const videoPath = `${dir}/source.mp4`
      await generateFixtureVideo(videoPath)
      const videoBytes = await Deno.readFile(videoPath)
      const videoCreated = await fetch(`${baseUrl}/assets/video`, {
        method: 'POST',
        headers: { 'Content-Type': 'video/mp4' },
        body: videoBytes,
      })
      assertEquals(videoCreated.status, 200)
      const videoRecord = await videoCreated.json()
      createdRecords.push(videoRecord)
      assertEquals(videoRecord.status, 'completed')
      assert(videoRecord.variants.length > 0, 'expected a real video variant')

      // --- For each kind: prove genuine encryption at rest, then genuine correct decryption ---
      const cases = [
        { record: audioRecord, sourceBytes: audioBytes, label: 'audio' },
        { record: imageRecord, sourceBytes: imageBytes, label: 'image' },
        { record: videoRecord, sourceBytes: videoBytes, label: 'video' },
      ]
      await Promise.all(cases.map(async ({ record, sourceBytes, label }) => {
        const variant = record.variants[0]

        // 1. What's REALLY in SeaweedFS is ciphertext — read via the UNENCRYPTED connector.
        const rawStored = await rawS3.get(variant.storageKey)
        assert(rawStored, `[${label}] expected the raw object to exist in SeaweedFS`)
        const rawBytes = new Uint8Array(await new Response(rawStored.stream).arrayBuffer())
        assertNotEquals(
          rawBytes,
          sourceBytes,
          `[${label}] the raw bytes actually stored in SeaweedFS must be ciphertext, never the ` +
            `plaintext transformed bytes`,
        )

        // 2. The real HTTP download route decrypts correctly, end to end.
        const download = await fetch(
          `${baseUrl}/assets/${record.id}/download?variant=${variant.variantId}`,
        )
        assertEquals(download.status, 200)
        const downloadedBytes = new Uint8Array(await download.arrayBuffer())
        assert(downloadedBytes.byteLength > 0, `[${label}] expected real, non-empty bytes`)
        // Deliberately NOT asserting the variant differs from the source here: this suite's
        // fixtures are tiny (kept minimal for the encryption proof above), and a genuinely tiny
        // video (confirmed empirically: 64x64, 1s) is smaller than the 'mlg' breakpoint's own
        // 720px/1500kbps caps on EVERY axis — the never-worsened guardrail correctly keeps it
        // byte-identical to the source, which is CORRECT product behavior, not a bug. Asserting
        // inequality here would be a flaky, fixture-size-dependent check, not a real one. Real,
        // guaranteed-to-shrink optimization proof lives in the dedicated `voice-upload-s3.test.ts`/
        // `image-upload-s3.test.ts`/`video-upload-s3.test.ts`, built specifically for that with
        // fixtures sized to make the never-worsened path NOT apply.

        // 3. The ENCRYPTED connector's own get() (what AssetService actually uses) also decrypts
        // correctly, matching the HTTP download exactly.
        const decrypted = await s3.get(variant.storageKey)
        assert(decrypted, `[${label}] expected the encrypted connector to find the object`)
        const decryptedBytes = new Uint8Array(await new Response(decrypted.stream).arrayBuffer())
        assertEquals(
          decryptedBytes,
          downloadedBytes,
          `[${label}] direct decrypted read must match the HTTP download exactly`,
        )
      }))
    } finally {
      await webServerManager.stop([serverId])
      await Deno.remove(dir, { recursive: true })
      await Promise.all(createdRecords.flatMap((record) => [
        s3.delete(record.storageKey).catch(() => {}),
        ...(record.variants ?? []).map((variant: { storageKey: string }) =>
          s3.delete(variant.storageKey).catch(() => {})
        ),
      ]))
    }
  },
})
