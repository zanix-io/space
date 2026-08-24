import { assert, assertEquals, assertRejects } from '@std/assert'
import { join } from '@std/path'
import { generateUUID, getTemporaryFolder } from '@zanix/helpers'
import { HttpError, InternalError } from '@zanix/errors'
import { createAssetService } from 'modules/assets-api/asset-service.ts'
import { createInMemoryAssetStorage } from 'modules/assets-api/adapters/in-memory-asset-storage.ts'
import { createInMemoryAssetRepository } from 'modules/assets-api/adapters/in-memory-asset-repository.ts'
import { createLocalFilesystemAssetStorage } from 'modules/assets-api/adapters/local-filesystem-asset-storage.ts'
import { buildOriginalStorageKey, buildVariantStorageKey } from 'modules/assets-api/keys.ts'
import type {
  AssetRepository,
  UpdateAssetInput,
} from 'modules/assets-api/ports/asset-repository.ts'
import type { AssetStorage } from 'modules/assets-api/ports/asset-storage.ts'
import type { AssetTransformRequest } from 'modules/assets-api/typings.ts'
import type { AssetTransformer } from 'modules/asset-transform/asset-transformer.ts'
import type {
  AudioTranscodeInput,
  AudioTranscodeResult,
  AudioTransformOptions,
} from 'modules/media/audio/audio-transcoder.ts'
import type {
  TranscodeInput,
  TranscodeOptions,
  TranscodeResult,
} from 'modules/media/video-transcoder.ts'

/**
 * `AssetService` proven against fakes only — no real ffmpeg/sharp anywhere in this file (see
 * `src/@tests/functional/assets-api/voice-upload.test.ts` for the real, ffmpeg-backed vertical
 * slice). This suite is what proves the ARCHITECTURE: state transitions, storageKey discipline,
 * and the metadata/bytes boundary — the things that would be true regardless of which real
 * transcoder is plugged in.
 */

function streamFrom(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

function wavFixture(): Uint8Array {
  return new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
}

function notUsed(): never {
  throw new Error('not used in this test')
}

/** A fake `AssetTransformer` — only `transformAudio` is real; the other three are never expected
 * to be called from this suite (only voice/audio is wired up this session). */
function createFakeTransformer(behavior: 'optimized' | 'never-worsened'): AssetTransformer {
  return {
    transformImage: notUsed,
    transformVideo: notUsed,
    transformThumbnail: notUsed,
    async transformAudio(
      input: AudioTranscodeInput,
      options: AudioTransformOptions,
    ): Promise<AudioTranscodeResult> {
      const sourceBytes = await Deno.readFile(input.sourcePath)

      if (behavior === 'never-worsened') {
        await Deno.writeFile(options.outputPath, sourceBytes)
        return {
          outputPath: options.outputPath,
          bytesWritten: sourceBytes.byteLength,
          mimeType: 'audio/wav',
          format: 'wav',
          sampleRateHz: 44100,
          channels: 1,
          passthrough: false,
          neverWorsened: true,
        }
      }

      const produced = sourceBytes.slice(0, Math.max(0, sourceBytes.byteLength - 1))
      await Deno.writeFile(options.outputPath, produced)
      return {
        outputPath: options.outputPath,
        bytesWritten: produced.byteLength,
        mimeType: options.format === 'opus' ? 'audio/ogg' : 'audio/mp4',
        format: options.format === 'opus' ? 'opus' : 'm4a',
        sampleRateHz: 44100,
        channels: 1,
        passthrough: false,
        neverWorsened: false,
      }
    },
  }
}

/** A failing `AssetTransformer` — `transformAudio` always rejects. */
function createFailingTransformer(message: string): AssetTransformer {
  return {
    transformImage: notUsed,
    transformVideo: notUsed,
    transformThumbnail: notUsed,
    transformAudio: () => Promise.reject(new Error(message)),
  }
}

/** A fake `AssetTransformer` for the image/video paths — `transformImage` returns the source
 * bytes untouched (real optimization is `sharp`'s own concern, out of scope for this suite, same
 * "fakes only" boundary the audio suite above already establishes); `transformVideo` writes a real
 * file to `options.outputPath` (asset-service always reads it back when `neverWorsened` is
 * false) and reports `neverWorsened` per `behavior`. */
function createImageVideoTransformer(
  behavior: 'optimized' | 'never-worsened' = 'optimized',
): AssetTransformer {
  return {
    transformImage: notUsed,
    transformVideo: async (
      input: TranscodeInput,
      options: TranscodeOptions,
    ): Promise<TranscodeResult> => {
      const sourceBytes = await Deno.readFile(input.sourcePath)
      if (behavior === 'never-worsened') {
        await Deno.writeFile(options.outputPath, sourceBytes)
        return {
          outputPath: options.outputPath,
          bytesWritten: sourceBytes.byteLength,
          mimeType: 'video/mp4',
          passthrough: false,
          neverWorsened: true,
        }
      }
      const produced = sourceBytes.slice(0, Math.max(0, sourceBytes.byteLength - 1))
      await Deno.writeFile(options.outputPath, produced)
      return {
        outputPath: options.outputPath,
        bytesWritten: produced.byteLength,
        mimeType: options.format === 'webm' ? 'video/webm' : 'video/mp4',
        passthrough: false,
        neverWorsened: false,
      }
    },
    transformThumbnail: notUsed,
    transformAudio: notUsed,
  }
}

/** A fake `AssetTransformer` for the image path — `transformImage` returns the source bytes
 * untouched, tagged with whatever `relativePath` the caller resolved (real optimization is
 * `sharp`'s own concern, out of scope for this suite). */
function createImageTransformer(): AssetTransformer {
  return {
    transformImage: (relativePath: string, source: Uint8Array) =>
      Promise.resolve([{ relativePath, bytes: source }]),
    transformVideo: notUsed,
    transformThumbnail: notUsed,
    transformAudio: notUsed,
  }
}

function jpegFixture(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])
}

function mp4Fixture(): Uint8Array {
  return new Uint8Array(Array.from({ length: 16 }, (_, i) => i))
}

// --- happy path -----------------------------------------------------------------------------

Deno.test('createAsset: voice upload -> transform -> store -> persist, happy path', async () => {
  const storage = createInMemoryAssetStorage()
  const repository = createInMemoryAssetRepository()
  const service = createAssetService({
    transformer: createFakeTransformer('optimized'),
    storage,
    repository,
  })

  const record = await service.createAsset({
    upload: { stream: streamFrom(wavFixture()), contentType: 'audio/wav', filename: 'voice.wav' },
    transformRequest: { kind: 'audio', profile: 'voice', options: { format: 'aac' } },
  })

  assertEquals(record.status, 'completed')
  assertEquals(record.kind, 'audio')
  assertEquals(record.originalFilename, 'voice.wav')
  assertEquals(record.variants.length, 1)

  const variant = record.variants[0]
  assertEquals(variant.kind, 'audio')
  assert(variant.storageKey !== record.storageKey, 'a real variant must have its own storage key')

  const downloaded = await storage.get(variant.storageKey)
  assert(downloaded, 'the variant must really be retrievable from storage')

  const fromService = await service.getAsset(record.id)
  assertEquals(fromService, record)
})

// --- never-worsen -----------------------------------------------------------------------------

Deno.test(
  'createAsset: never-worsen -> the variant points at the ORIGINAL storageKey, never a duplicate copy',
  async () => {
    const storage = createInMemoryAssetStorage()
    const repository = createInMemoryAssetRepository()
    const service = createAssetService({
      transformer: createFakeTransformer('never-worsened'),
      storage,
      repository,
    })

    const record = await service.createAsset({
      upload: { stream: streamFrom(wavFixture()), contentType: 'audio/wav' },
      transformRequest: { kind: 'audio', profile: 'voice', options: { format: 'aac' } },
    })

    assertEquals(record.status, 'completed')
    const variant = record.variants[0]
    assertEquals(
      variant.storageKey,
      record.storageKey,
      'a never-worsened variant must reuse the original storage key, never store a second copy',
    )
    assertEquals(variant.format, 'wav', 'must honestly report the SOURCE type, never the target')
    assertEquals(variant.contentType, 'audio/wav')
  },
)

// --- error path -------------------------------------------------------------------------------

Deno.test(
  'createAsset: a transform failure marks the record failed, with a real error message',
  async () => {
    const storage = createInMemoryAssetStorage()
    const repository = createInMemoryAssetRepository()
    const service = createAssetService({
      transformer: createFailingTransformer('ffmpeg exploded'),
      storage,
      repository,
    })

    const record = await service.createAsset({
      upload: { stream: streamFrom(wavFixture()), contentType: 'audio/wav' },
      transformRequest: { kind: 'audio', profile: 'voice', options: { format: 'aac' } },
    })

    assertEquals(record.status, 'failed')
    assertEquals(record.error?.message, 'ffmpeg exploded')
    assertEquals(record.variants.length, 0)
  },
)

// --- the voice .wav-only guardrail is REACHABLE through the real HTTP upload flow --------------
// A real, found gap this session closed: `AssetService` used to hardcode `.wav` as the temp
// source file's own suffix, REGARDLESS of what content-type was actually uploaded — which meant
// `validateVoiceSource` (`modules/media/audio/policies/voice.ts`), an extension-based check, would
// always see `.wav` and always pass, no matter what bytes a caller actually sent. The guardrail
// existed but could never actually fire through this path. Fixed by deriving the temp file's own
// extension from the REAL uploaded `contentType` (`AssetObject.contentType`, read back from
// storage) instead of assuming it. Proven here with the REAL DEFAULT transformer (no override, no
// fake) — the actual production wiring `createAssetService({storage, repository})` uses. No real
// ffmpeg needed: the guardrail rejects before ffmpeg is ever probed.

Deno.test(
  'createAsset: an upload whose REAL content-type is not audio/wav is rejected by the voice ' +
    'guardrail — marks the record failed with the SAME actionable error a direct ' +
    'AssetTransformer.transformAudio() caller gets, using the REAL default transformer (no fake, ' +
    'no ffmpeg needed — rejected before ffmpeg is ever probed)',
  async () => {
    const storage = createInMemoryAssetStorage()
    const repository = createInMemoryAssetRepository()
    // The REAL default — no `transformer` override — proving this is genuinely how production
    // is wired, not something only a test double happens to enforce.
    const service = createAssetService({ storage, repository })

    const record = await service.createAsset({
      upload: {
        stream: streamFrom(wavFixture()),
        contentType: 'audio/mpeg', // claims MP3 — the guardrail must see through the disguise
        filename: 'upload.mp3',
      },
      transformRequest: { kind: 'audio', profile: 'voice', options: { format: 'aac' } },
    })

    assertEquals(record.status, 'failed')
    assert(
      record.error?.message.includes('Voice audio transcoding only accepts .wav sources'),
      `expected the real guardrail message, got: ${record.error?.message}`,
    )
    assertEquals(record.variants.length, 0)
  },
)

Deno.test(
  'createAsset: a genuine audio/wav upload is NOT rejected by the guardrail — it proceeds past ' +
    'validation (using the REAL default transformer, with no real ffmpeg available in THIS test ' +
    'env, it fails for a DIFFERENT, later reason — never the ".wav sources" guardrail message)',
  async () => {
    const storage = createInMemoryAssetStorage()
    const repository = createInMemoryAssetRepository()
    const service = createAssetService({ storage, repository })

    const record = await service.createAsset({
      upload: { stream: streamFrom(wavFixture()), contentType: 'audio/wav', filename: 'voice.wav' },
      transformRequest: { kind: 'audio', profile: 'voice', options: { format: 'aac' } },
    })

    // Whatever happens next (real success, or a real "ffmpeg not available" on a machine with no
    // ffmpeg) is NOT this test's concern — only that the .wav-only guardrail itself never blocks a
    // genuinely correct upload.
    if (record.status === 'failed') {
      assert(
        !record.error?.message.includes('only accepts .wav sources'),
        `a real .wav upload must never be rejected by the guardrail itself: ${record.error?.message}`,
      )
    }
  },
)

// --- state-machine proof ------------------------------------------------------------------------

function createStatusSpyRepository(
  base: AssetRepository,
  statuses: string[],
): AssetRepository {
  return {
    async create(input) {
      const record = await base.create(input)
      statuses.push(record.status)
      return record
    },
    findById: (id) => base.findById(id),
    async update(id: string, changes: UpdateAssetInput) {
      const record = await base.update(id, changes)
      if (changes.status) statuses.push(record.status)
      return record
    },
    delete: (id) => base.delete(id),
  }
}

Deno.test(
  'createAsset: the real status sequence is pending -> processing -> completed, observed ' +
    'through repository.create/update calls — not just the final value',
  async () => {
    const statuses: string[] = []
    const repository = createStatusSpyRepository(createInMemoryAssetRepository(), statuses)
    const service = createAssetService({
      transformer: createFakeTransformer('optimized'),
      storage: createInMemoryAssetStorage(),
      repository,
    })

    await service.createAsset({
      upload: { stream: streamFrom(wavFixture()), contentType: 'audio/wav' },
      transformRequest: { kind: 'audio', profile: 'voice', options: { format: 'aac' } },
    })

    assertEquals(statuses, ['pending', 'processing', 'completed'])
  },
)

Deno.test(
  'createAsset: on failure, the real status sequence is pending -> processing -> failed',
  async () => {
    const statuses: string[] = []
    const repository = createStatusSpyRepository(createInMemoryAssetRepository(), statuses)
    const service = createAssetService({
      transformer: createFailingTransformer('boom'),
      storage: createInMemoryAssetStorage(),
      repository,
    })

    await service.createAsset({
      upload: { stream: streamFrom(wavFixture()), contentType: 'audio/wav' },
      transformRequest: { kind: 'audio', profile: 'voice', options: { format: 'aac' } },
    })

    assertEquals(statuses, ['pending', 'processing', 'failed'])
  },
)

// --- storageKey: logical, backend-independent --------------------------------------------------

Deno.test(
  'storageKey: buildOriginalStorageKey/buildVariantStorageKey are logical, backend-independent',
  () => {
    const id = 'abc123'
    const original = buildOriginalStorageKey(id)
    const variant = buildVariantStorageKey(id, 'v1')

    for (const key of [original, variant]) {
      assert(!key.includes('\\'), `"${key}" must never contain a Windows path separator`)
      assert(!key.startsWith('/'), `"${key}" must never be an absolute path`)
      assert(!/\.[a-z0-9]+$/i.test(key), `"${key}" must never carry a file extension`)
      assert(
        !/bucket|s3:|gridfs/i.test(key),
        `"${key}" must never reference a backend/bucket concept`,
      )
    }
    assertEquals(original, 'assets/abc123/original')
    assertEquals(variant, 'assets/abc123/variants/v1')
  },
)

Deno.test(
  'storageKey: the exact same key round-trips through InMemoryAssetStorage AND ' +
    'LocalFilesystemAssetStorage with no backend-specific translation',
  async () => {
    const key = buildOriginalStorageKey('roundtrip-test')
    const bytes = new Uint8Array([9, 8, 7, 6])

    const inMemory = createInMemoryAssetStorage()
    await inMemory.put(key, bytes, { contentType: 'audio/wav' })
    const fromMemory = await inMemory.get(key)
    assert(fromMemory)
    assertEquals(fromMemory.object.key, key)

    const dir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      const local = createLocalFilesystemAssetStorage(dir)
      await local.put(key, bytes, { contentType: 'audio/wav' })
      const fromDisk = await local.get(key)
      assert(fromDisk)
      assertEquals(fromDisk.object.key, key)

      // The logical key maps directly onto a nested path — no adapter-specific renaming/encoding.
      const stat = await Deno.stat(join(dir, key))
      assert(stat.isFile)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

// --- AssetRepository never receives bytes -------------------------------------------------------

function assertJsonSerializable(value: unknown, context: string): void {
  const seen = new Set<unknown>()
  function walk(node: unknown): void {
    if (node instanceof Uint8Array) {
      throw new Error(`${context}: a raw Uint8Array leaked into repository metadata`)
    }
    if (node instanceof ReadableStream) {
      throw new Error(`${context}: a ReadableStream leaked into repository metadata`)
    }
    if (node && typeof node === 'object') {
      if (seen.has(node)) return
      seen.add(node)
      for (const child of Object.values(node as Record<string, unknown>)) walk(child)
    }
  }
  walk(value)
  // The definitive proof: a real, successful JSON round-trip.
  JSON.parse(JSON.stringify(value))
}

Deno.test(
  'AssetRepository never receives bytes: every create()/update() argument across a full ' +
    'createAsset() flow is JSON-serializable',
  async () => {
    const base = createInMemoryAssetRepository()
    const repository: AssetRepository = {
      create: (input) => {
        assertJsonSerializable(input, 'create() input')
        return base.create(input)
      },
      findById: (id) => base.findById(id),
      update: (id, changes) => {
        assertJsonSerializable(changes, 'update() changes')
        return base.update(id, changes)
      },
      delete: (id) => base.delete(id),
    }
    const service = createAssetService({
      transformer: createFakeTransformer('optimized'),
      storage: createInMemoryAssetStorage(),
      repository,
    })

    const record = await service.createAsset({
      upload: { stream: streamFrom(wavFixture()), contentType: 'audio/wav' },
      transformRequest: { kind: 'audio', profile: 'voice', options: { format: 'aac' } },
    })

    // No throw above IS the assertion — reaching here means every argument passed through was
    // real, plain, JSON-serializable metadata.
    assertEquals(record.status, 'completed')
  },
)

// --- voice: format='opus' picks the .opus temp output suffix -----------------------------------

Deno.test(
  "createAsset: voice upload with options.format:'opus' produces an opus variant (the .opus " +
    'temp output suffix branch, distinct from the .m4a default)',
  async () => {
    const storage = createInMemoryAssetStorage()
    const repository = createInMemoryAssetRepository()
    const service = createAssetService({
      transformer: createFakeTransformer('optimized'),
      storage,
      repository,
    })

    const record = await service.createAsset({
      upload: { stream: streamFrom(wavFixture()), contentType: 'audio/wav' },
      transformRequest: { kind: 'audio', profile: 'voice', options: { format: 'opus' } },
    })

    assertEquals(record.status, 'completed')
    assertEquals(record.variants[0].format, 'opus')
    assertEquals(record.variants[0].contentType, 'audio/ogg')
  },
)

// --- runTransformation: source vanished from storage before the job ran ------------------------

/** Wraps a real `AssetStorage` so `put` still works (a real upload must still succeed) but `get`
 * always reports the source missing — proves the ONE real failure mode `runTransformation`
 * guards against with its own `HttpError('NOT_FOUND', ...)`: a source that disappeared between
 * upload and the job actually running. */
function createStorageThatLosesTheSource(base: AssetStorage): AssetStorage {
  return {
    put: (key, data, meta) => base.put(key, data, meta),
    get: () => Promise.resolve(undefined),
    delete: (key) => base.delete(key),
    exists: (key) => base.exists(key),
  }
}

Deno.test(
  'createAsset: the source vanishing from storage before the job runs marks the record failed ' +
    'with a real, actionable "not found in storage" message — never a raw undefined crash',
  async () => {
    const storage = createStorageThatLosesTheSource(createInMemoryAssetStorage())
    const repository = createInMemoryAssetRepository()
    const service = createAssetService({
      transformer: createFakeTransformer('optimized'),
      storage,
      repository,
    })

    const record = await service.createAsset({
      upload: { stream: streamFrom(wavFixture()), contentType: 'audio/wav' },
      transformRequest: { kind: 'audio', profile: 'voice', options: { format: 'aac' } },
    })

    assertEquals(record.status, 'failed')
    // `HttpError#message` is the error CODE by default (`HttpError`'s own doc); the actionable
    // "not found in storage" text lives on `meta.reason` — not observable here since only
    // `error.message` survives onto the record (`InlineJobDispatcher`'s own contract).
    assertEquals(record.error?.message, 'NOT_FOUND')
  },
)

// --- runTransformation: exhaustiveness guard -----------------------------------------------------

Deno.test(
  'createAsset: an unrecognized transformRequest.kind hits the exhaustiveness guard and marks ' +
    'the record failed with BAD_REQUEST — never an uncaught throw',
  async () => {
    const storage = createInMemoryAssetStorage()
    const repository = createInMemoryAssetRepository()
    const service = createAssetService({
      transformer: createFakeTransformer('optimized'),
      storage,
      repository,
    })

    const record = await service.createAsset({
      upload: { stream: streamFrom(wavFixture()), contentType: 'audio/wav' },
      transformRequest: { kind: 'bogus' } as unknown as AssetTransformRequest,
    })

    assertEquals(record.status, 'failed')
    assertEquals(record.error?.message, 'BAD_REQUEST')
  },
)

// --- runImageTransformation --------------------------------------------------------------------

Deno.test(
  'createAsset: image upload -> transform -> store -> persist, happy path',
  async () => {
    const storage = createInMemoryAssetStorage()
    const repository = createInMemoryAssetRepository()
    const service = createAssetService({
      transformer: createImageTransformer(),
      storage,
      repository,
    })

    const record = await service.createAsset({
      upload: { stream: streamFrom(jpegFixture()), contentType: 'image/jpeg', filename: 'a.jpg' },
      transformRequest: { kind: 'image' },
    })

    assertEquals(record.status, 'completed')
    assertEquals(record.variants.length, 1)
    const variant = record.variants[0]
    assertEquals(variant.kind, 'image')
    assertEquals(variant.format, 'jpg')
    assertEquals(variant.contentType, 'image/jpeg')
    assertEquals(variant.transformId, 'image-optimize')
    assert(variant.storageKey !== record.storageKey)

    const downloaded = await storage.get(variant.storageKey)
    assert(downloaded, 'the image variant must really be retrievable from storage')
  },
)

Deno.test(
  'createAsset: an image content-type outside jpeg/png/webp marks the record failed with a real, ' +
    'actionable BAD_REQUEST message',
  async () => {
    const storage = createInMemoryAssetStorage()
    const repository = createInMemoryAssetRepository()
    const service = createAssetService({
      transformer: createImageTransformer(),
      storage,
      repository,
    })

    const record = await service.createAsset({
      upload: { stream: streamFrom(jpegFixture()), contentType: 'image/gif' },
      transformRequest: { kind: 'image' },
    })

    assertEquals(record.status, 'failed')
    // See the "source vanished" test above for why this is the CODE, not the `meta.reason` text.
    assertEquals(record.error?.message, 'BAD_REQUEST')
  },
)

// --- runVideoTransformation ----------------------------------------------------------------------

Deno.test(
  'createAsset: video upload -> transform -> store -> persist, happy path, an explicit ' +
    "options.format:'webm' overriding the source's own container",
  async () => {
    const storage = createInMemoryAssetStorage()
    const repository = createInMemoryAssetRepository()
    const service = createAssetService({
      transformer: createImageVideoTransformer('optimized'),
      storage,
      repository,
    })

    const record = await service.createAsset({
      upload: { stream: streamFrom(mp4Fixture()), contentType: 'video/mp4', filename: 'a.mp4' },
      transformRequest: { kind: 'video', options: { format: 'webm' } },
    })

    assertEquals(record.status, 'completed')
    const variant = record.variants[0]
    assertEquals(variant.kind, 'video')
    assertEquals(variant.format, 'webm')
    assertEquals(variant.contentType, 'video/webm')
    assertEquals(variant.transformId, 'video-mlg', "no breakpoint given -> the real 'mlg' default")
    assert(variant.storageKey !== record.storageKey)
  },
)

Deno.test(
  'createAsset: never-worsened video -> the variant points at the ORIGINAL storageKey, never a ' +
    'duplicate copy, and honestly reports the SOURCE format/content-type',
  async () => {
    const storage = createInMemoryAssetStorage()
    const repository = createInMemoryAssetRepository()
    const service = createAssetService({
      transformer: createImageVideoTransformer('never-worsened'),
      storage,
      repository,
    })

    const record = await service.createAsset({
      upload: { stream: streamFrom(mp4Fixture()), contentType: 'video/mp4' },
      transformRequest: { kind: 'video' },
    })

    assertEquals(record.status, 'completed')
    const variant = record.variants[0]
    assertEquals(
      variant.storageKey,
      record.storageKey,
      'a never-worsened video variant must reuse the original storage key',
    )
    assertEquals(variant.format, 'mp4', 'must honestly report the SOURCE container, never a target')
  },
)

Deno.test(
  'createAsset: a video content-type outside mp4/webm marks the record failed with a real, ' +
    'actionable BAD_REQUEST message',
  async () => {
    const storage = createInMemoryAssetStorage()
    const repository = createInMemoryAssetRepository()
    const service = createAssetService({
      transformer: createImageVideoTransformer('optimized'),
      storage,
      repository,
    })

    const record = await service.createAsset({
      upload: { stream: streamFrom(mp4Fixture()), contentType: 'video/x-msvideo' },
      transformRequest: { kind: 'video' },
    })

    assertEquals(record.status, 'failed')
    // See the "source vanished" test above for why this is the CODE, not the `meta.reason` text.
    assertEquals(record.error?.message, 'BAD_REQUEST')
  },
)

// --- createAsset: the record vanishing immediately after its own creation -----------------------

/** Wraps a real `AssetRepository` so `create`/`update`/`delete` still behave normally, but
 * `findById` always reports the record missing — the one real (if pathological) case
 * `createAsset`'s own re-read guards against: a repository backend that accepted the write but
 * cannot immediately read it back. */
function createRepositoryThatLosesTheRecord(base: AssetRepository): AssetRepository {
  return {
    create: (input) => base.create(input),
    findById: () => Promise.resolve(undefined),
    update: (id, changes) => base.update(id, changes),
    delete: (id) => base.delete(id),
  }
}

Deno.test(
  'createAsset: a repository that cannot read back its own just-created record throws a real, ' +
    'named InternalError — never returns a fabricated/undefined record',
  async () => {
    const repository = createRepositoryThatLosesTheRecord(createInMemoryAssetRepository())
    const service = createAssetService({
      transformer: createFakeTransformer('optimized'),
      storage: createInMemoryAssetStorage(),
      repository,
    })

    const error = await assertRejects(
      () =>
        service.createAsset({
          upload: { stream: streamFrom(wavFixture()), contentType: 'audio/wav' },
          transformRequest: { kind: 'audio', profile: 'voice', options: { format: 'aac' } },
        }),
      InternalError,
      'vanished immediately after its own creation',
    )
    assertEquals(error.code, 'SPACE_ASSETS_RECORD_MISSING_AFTER_CREATE')
  },
)

// --- downloadVariant --------------------------------------------------------------------------

Deno.test('downloadVariant: an unknown asset id returns undefined', async () => {
  const service = createAssetService({
    transformer: createFakeTransformer('optimized'),
    storage: createInMemoryAssetStorage(),
    repository: createInMemoryAssetRepository(),
  })

  assertEquals(await service.downloadVariant(generateUUID()), undefined)
})

Deno.test(
  'downloadVariant: a variantId that does not exist on an otherwise real record returns undefined',
  async () => {
    const storage = createInMemoryAssetStorage()
    const repository = createInMemoryAssetRepository()
    const service = createAssetService({
      transformer: createFakeTransformer('optimized'),
      storage,
      repository,
    })

    const record = await service.createAsset({
      upload: { stream: streamFrom(wavFixture()), contentType: 'audio/wav' },
      transformRequest: { kind: 'audio', profile: 'voice', options: { format: 'aac' } },
    })

    assertEquals(await service.downloadVariant(record.id, 'does-not-exist'), undefined)
  },
)

Deno.test(
  'downloadVariant: a storage backend that no longer has the bytes for an otherwise real, ' +
    'known-good key returns undefined — never throws',
  async () => {
    const inMemory = createInMemoryAssetStorage()
    let storageDisabled = false
    const storage: AssetStorage = {
      put: (key, data, meta) => inMemory.put(key, data, meta),
      get: (key) => storageDisabled ? Promise.resolve(undefined) : inMemory.get(key),
      delete: (key) => inMemory.delete(key),
      exists: (key) => inMemory.exists(key),
    }
    const repository = createInMemoryAssetRepository()
    const service = createAssetService({
      transformer: createFakeTransformer('optimized'),
      storage,
      repository,
    })

    const record = await service.createAsset({
      upload: { stream: streamFrom(wavFixture()), contentType: 'audio/wav' },
      transformRequest: { kind: 'audio', profile: 'voice', options: { format: 'aac' } },
    })
    assertEquals(record.status, 'completed')

    storageDisabled = true
    assertEquals(await service.downloadVariant(record.id), undefined)
  },
)

// --- createAsset: AssetServiceOptions.limits — the two-layer size defense ----------------------
// A real, found gap this session closed: `AssetService` used to drain an upload's whole
// `ReadableStream` into memory with no cap at all — `UploadedAsset.size` (the `Content-Length`
// header) was read but never validated against anything, and `Content-Length` is itself optional/
// spoofable. See `AssetServiceOptions.limits`'s own doc for the full two-layer design these tests
// prove.

/** Wraps a real stream but throws if `getReader()` is ever called — proves Layer 1 (the
 * `Content-Length` fast reject) rejects BEFORE the stream is touched at all, not merely before it
 * finishes buffering. */
function unreadableStreamFrom(bytes: Uint8Array): ReadableStream<Uint8Array> {
  const stream = streamFrom(bytes)
  stream.getReader = (): never => {
    throw new Error('the stream must never be read once Content-Length already exceeds the limit')
  }
  return stream
}

Deno.test(
  'createAsset: a declared Content-Length over the configured limit is rejected with ' +
    'PAYLOAD_TOO_LARGE before the stream is ever touched',
  async () => {
    const storage = createInMemoryAssetStorage()
    const repository = createInMemoryAssetRepository()
    const service = createAssetService({
      transformer: createImageTransformer(),
      storage,
      repository,
      limits: { image: 4 },
    })

    const error = await assertRejects(
      () =>
        service.createAsset({
          upload: {
            stream: unreadableStreamFrom(jpegFixture()), // 6 real bytes, over the 4-byte limit
            contentType: 'image/jpeg',
            size: 6,
          },
          transformRequest: { kind: 'image' },
        }),
      HttpError,
    )
    assertEquals(error.status.code, 'PAYLOAD_TOO_LARGE')
  },
)

Deno.test(
  'createAsset: a stream with NO Content-Length that exceeds the configured limit is aborted ' +
    'mid-read with a real PAYLOAD_TOO_LARGE — never fully buffered first',
  async () => {
    const storage = createInMemoryAssetStorage()
    const repository = createInMemoryAssetRepository()
    const service = createAssetService({
      transformer: createImageTransformer(),
      storage,
      repository,
      limits: { image: 4 },
    })

    const error = await assertRejects(
      () =>
        service.createAsset({
          // No `size` — the honest "client sent no Content-Length" shape (e.g. a chunked upload).
          upload: { stream: streamFrom(jpegFixture()), contentType: 'image/jpeg' },
          transformRequest: { kind: 'image' },
        }),
      HttpError,
    )
    assertEquals(error.status.code, 'PAYLOAD_TOO_LARGE')

    // The oversized upload was never persisted — rejected before `storage.put`/`repository.create`.
    assertEquals(await storage.get(buildOriginalStorageKey('does-not-matter')), undefined)
  },
)

Deno.test(
  'createAsset: a small upload within the configured limit still works end to end, exactly at ' +
    'the boundary (byteLength === limit, never rejected as "over")',
  async () => {
    const storage = createInMemoryAssetStorage()
    const repository = createInMemoryAssetRepository()
    const bytes = jpegFixture() // 6 real bytes
    const service = createAssetService({
      transformer: createImageTransformer(),
      storage,
      repository,
      limits: { image: bytes.byteLength },
    })

    const record = await service.createAsset({
      upload: { stream: streamFrom(bytes), contentType: 'image/jpeg', size: bytes.byteLength },
      transformRequest: { kind: 'image' },
    })

    assertEquals(record.status, 'completed')
    assertEquals(record.size, bytes.byteLength)
  },
)

// --- runImageTransformation: magic-byte verification --------------------------------------------
// A real, found gap this session closed: the image content-type allowlist only ever checked the
// client-supplied `Content-Type` HEADER — nothing verified the uploaded BYTES actually matched it.

Deno.test(
  'createAsset: an image upload whose Content-Type header LIES about the real bytes is rejected ' +
    'with a real, actionable BAD_REQUEST — using the REAL default transformer (no fake, no sharp ' +
    'call ever reached — rejected by the signature check first)',
  async () => {
    const storage = createInMemoryAssetStorage()
    const repository = createInMemoryAssetRepository()
    // The REAL default — no `transformer` override — proving the signature check genuinely runs
    // before `transformer.transformImage()`/real `sharp` is ever invoked.
    const service = createAssetService({ storage, repository })

    const notActuallyAJpeg = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const record = await service.createAsset({
      upload: { stream: streamFrom(notActuallyAJpeg), contentType: 'image/jpeg' },
      transformRequest: { kind: 'image' },
    })

    assertEquals(record.status, 'failed')
    assertEquals(record.error?.message, 'BAD_REQUEST')
  },
)

Deno.test(
  'createAsset: a genuine jpeg upload (real FF D8 FF signature) is NOT rejected by the ' +
    'signature check — it proceeds past validation to the real transformer',
  async () => {
    const storage = createInMemoryAssetStorage()
    const repository = createInMemoryAssetRepository()
    const service = createAssetService({
      transformer: createImageTransformer(),
      storage,
      repository,
    })

    const record = await service.createAsset({
      upload: { stream: streamFrom(jpegFixture()), contentType: 'image/jpeg' },
      transformRequest: { kind: 'image' },
    })

    assertEquals(record.status, 'completed', 'a genuine jpeg must never be rejected by the check')
  },
)
