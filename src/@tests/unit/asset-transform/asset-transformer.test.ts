import { assertEquals, assertRejects, assertStrictEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import {
  type AssetTransformerOptions,
  createAssetTransformer,
  isImplementedAssetKind,
} from 'modules/asset-transform/asset-transformer.ts'
import { createInMemoryTransformCacheStore } from 'modules/assets/transform-cache-store.ts'
import type { OptimizedAssetEntry } from 'modules/assets/image-optimize.ts'
import type { OptimizeImageAssetFn } from 'modules/assets/cached-image-optimizer.ts'
import type {
  ThumbnailOptions,
  ThumbnailResult,
  TranscodeInput,
  TranscodeOptions,
  TranscodeResult,
  VideoTranscoder,
} from 'modules/media/video-transcoder.ts'
import type {
  AudioTranscodeInput,
  AudioTranscoder,
  AudioTranscodeResult,
  AudioTransformOptions,
} from 'modules/media/audio/audio-transcoder.ts'

/**
 * This suite proves ONLY that `createAssetTransformer` wires the ALREADY-tested decorators
 * (`createCachedImageOptimizer`, `createCachedVideoTranscoder`) through correctly — every cache
 * axis itself (source/policy/breakpoint/format hit-miss matrix) is already exhaustively covered by
 * `cached-image-optimizer.test.ts`/`cached-video-transcoder.test.ts`; re-deriving that whole matrix
 * here would be redundant, not more thorough.
 */

async function tempDir(prefix: string): Promise<string> {
  return await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url), prefix })
}

function createFakeImageOptimizer() {
  const calls = { count: 0 }
  const optimize: OptimizeImageAssetFn = (relativePath, source) => {
    calls.count++
    const entries: OptimizedAssetEntry[] = [{ relativePath, bytes: source }]
    return Promise.resolve(entries)
  }
  return { optimize, calls }
}

function createFakeTranscoder() {
  const calls = { transcode: 0, thumbnail: 0 }
  const transcoder: VideoTranscoder = {
    probe: () => Promise.resolve({ available: true }),
    async transcode(input: TranscodeInput, options: TranscodeOptions): Promise<TranscodeResult> {
      calls.transcode++
      const sourceBytes = await Deno.readFile(input.sourcePath)
      const produced = new Uint8Array([...sourceBytes, 0xaa])
      await Deno.writeFile(options.outputPath, produced)
      return {
        outputPath: options.outputPath,
        bytesWritten: produced.byteLength,
        mimeType: 'video/mp4',
        passthrough: false,
        neverWorsened: false,
      }
    },
    async extractThumbnail(
      _input: TranscodeInput,
      options: ThumbnailOptions,
    ): Promise<ThumbnailResult> {
      calls.thumbnail++
      const bytes = new Uint8Array([1, 2, 3])
      await Deno.writeFile(options.outputPath, bytes)
      return {
        outputPath: options.outputPath,
        bytesWritten: bytes.byteLength,
        mimeType: 'image/jpeg',
      }
    },
  }
  return { transcoder, calls }
}

function createFakeAudioTranscoder() {
  const calls = { transcode: 0 }
  const transcoder: AudioTranscoder = {
    probe: () => Promise.resolve({ available: true }),
    async transcode(
      input: AudioTranscodeInput,
      options: AudioTransformOptions,
    ): Promise<AudioTranscodeResult> {
      calls.transcode++
      const sourceBytes = await Deno.readFile(input.sourcePath)
      const produced = new Uint8Array([
        ...sourceBytes.slice(0, Math.max(0, sourceBytes.length - 1)),
      ])
      await Deno.writeFile(options.outputPath, produced)
      return {
        outputPath: options.outputPath,
        bytesWritten: produced.byteLength,
        mimeType: 'audio/mp4',
        format: 'm4a',
        sampleRateHz: 44100,
        channels: 1,
        passthrough: false,
        neverWorsened: false,
      }
    },
  }
  return { transcoder, calls }
}

// --- transformImage: delegates cache wiring to createCachedImageOptimizer unchanged --------------

Deno.test(
  'transformImage: with a cacheDir, same source + same options -> the second call makes ZERO real optimize calls',
  async () => {
    const dir = await tempDir('asset-transformer-image-cache-')
    try {
      const { optimize, calls } = createFakeImageOptimizer()
      const transformer = createAssetTransformer({
        cacheDir: join(dir, 'cache'),
        imageOptimizer: optimize,
      })
      const source = new Uint8Array([1, 2, 3])

      const first = await transformer.transformImage('hero.jpg', source, true)
      const second = await transformer.transformImage('hero.jpg', source, true)

      assertEquals(calls.count, 1, 'the real optimizer must be called exactly once')
      assertEquals(second, first)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'transformImage: with NO cacheDir/cacheStore, transformImage IS the raw optimizer (no wrapper)',
  () => {
    const { optimize } = createFakeImageOptimizer()
    const transformer = createAssetTransformer({ imageOptimizer: optimize })
    assertStrictEquals(transformer.transformImage, optimize)
  },
)

Deno.test('transformImage: default imageOptimizer is optimizeImageAsset itself', async () => {
  const { optimizeImageAsset } = await import('modules/assets/image-optimize.ts')
  const transformer = createAssetTransformer()
  assertStrictEquals(transformer.transformImage, optimizeImageAsset)
})

// --- transformVideo / transformThumbnail: delegate to createCachedVideoTranscoder unchanged ------

Deno.test(
  'transformVideo: with a cacheDir, same source + same breakpoint -> the second call makes ZERO real transcode calls',
  async () => {
    const dir = await tempDir('asset-transformer-video-cache-')
    try {
      const sourcePath = join(dir, 'source.mp4')
      await Deno.writeFile(sourcePath, new Uint8Array([1, 2, 3, 4]))
      const { transcoder, calls } = createFakeTranscoder()
      const transformer = createAssetTransformer({
        cacheDir: join(dir, 'cache'),
        videoTranscoder: transcoder,
      })

      const outputPath1 = join(dir, 'out1.mp4')
      const outputPath2 = join(dir, 'out2.mp4')
      await transformer.transformVideo({ sourcePath }, {
        breakpoint: 'msm',
        outputPath: outputPath1,
      })
      await transformer.transformVideo({ sourcePath }, {
        breakpoint: 'msm',
        outputPath: outputPath2,
      })

      assertEquals(calls.transcode, 1, 'the real transcoder must be called exactly once')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'transformThumbnail: with a cacheDir, same source + same options -> the second call makes ' +
    'ZERO real extractions, and shares the SAME cacheDir as transformVideo without collision ' +
    '(independent policy axes)',
  async () => {
    const dir = await tempDir('asset-transformer-thumb-cache-')
    try {
      const sourcePath = join(dir, 'source.mp4')
      await Deno.writeFile(sourcePath, new Uint8Array([1, 2, 3, 4]))
      const { transcoder, calls } = createFakeTranscoder()
      const cacheDir = join(dir, 'cache')
      const transformer = createAssetTransformer({ cacheDir, videoTranscoder: transcoder })

      await transformer.transformVideo(
        { sourcePath },
        { breakpoint: 'msm', outputPath: join(dir, 'out.mp4') },
      )
      assertEquals(calls.transcode, 1)

      const thumb1 = join(dir, 'thumb1.jpg')
      const thumb2 = join(dir, 'thumb2.jpg')
      await transformer.transformThumbnail({ sourcePath }, { outputPath: thumb1 })
      await transformer.transformThumbnail({ sourcePath }, { outputPath: thumb2 })

      assertEquals(calls.thumbnail, 1, 'the real thumbnail extractor must be called exactly once')
      assertEquals(calls.transcode, 1, 'transcode() and extractThumbnail() must stay independent')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

// --- transformAudio: delegates cache wiring to createCachedAudioTranscoder unchanged -------------

Deno.test(
  'transformAudio: with a cacheDir, same source + same voice options -> the second call makes ZERO real transcode calls',
  async () => {
    const dir = await tempDir('asset-transformer-audio-cache-')
    try {
      const sourcePath = join(dir, 'source.wav')
      await Deno.writeFile(sourcePath, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
      const { transcoder, calls } = createFakeAudioTranscoder()
      const transformer = createAssetTransformer({
        cacheDir: join(dir, 'cache'),
        audioTranscoder: transcoder,
      })

      const outputPath1 = join(dir, 'out1.m4a')
      const outputPath2 = join(dir, 'out2.m4a')
      await transformer.transformAudio(
        { sourcePath },
        { profile: 'voice', format: 'aac', outputPath: outputPath1 },
      )
      await transformer.transformAudio(
        { sourcePath },
        { profile: 'voice', format: 'aac', outputPath: outputPath2 },
      )

      assertEquals(calls.transcode, 1, 'the real audio transcoder must be called exactly once')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'transformAudio: shares the SAME cacheDir as transformVideo/transformThumbnail without collision (independent policy axes)',
  async () => {
    const dir = await tempDir('asset-transformer-audio-shared-cache-')
    try {
      const videoSourcePath = join(dir, 'source.mp4')
      await Deno.writeFile(videoSourcePath, new Uint8Array([1, 2, 3, 4]))
      const audioSourcePath = join(dir, 'source.wav')
      await Deno.writeFile(audioSourcePath, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))

      const { transcoder: videoTranscoder, calls: videoCalls } = createFakeTranscoder()
      const { transcoder: audioTranscoder, calls: audioCalls } = createFakeAudioTranscoder()
      const cacheDir = join(dir, 'cache')
      const transformer = createAssetTransformer({ cacheDir, videoTranscoder, audioTranscoder })

      await transformer.transformVideo(
        { sourcePath: videoSourcePath },
        { breakpoint: 'msm', outputPath: join(dir, 'out.mp4') },
      )
      await transformer.transformAudio(
        { sourcePath: audioSourcePath },
        { profile: 'voice', format: 'aac', outputPath: join(dir, 'out.m4a') },
      )

      assertEquals(videoCalls.transcode, 1)
      assertEquals(audioCalls.transcode, 1, 'video and audio caches must never collide')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

// --- Input-eligibility guardrail: also enforced calling transformAudio() DIRECTLY, with zero
// mediaPlugin involvement — the exact scenario a future AssetService/HTTP Asset API would hit.
// Uses the REAL default audioTranscoder (no override, no fake) — no real ffmpeg needed, since the
// guardrail rejects the request before ffmpeg is ever probed. ------------------------------------

Deno.test(
  'transformAudio: voice + a non-.wav source is rejected calling AssetTransformer directly — no ' +
    'mediaPlugin involved at all, and no real ffmpeg needed (rejected before ffmpeg is probed)',
  async () => {
    // The REAL default transformer — no audioTranscoder override — proving the guardrail is a
    // property of the real production wiring, not something only a test double happens to enforce.
    const transformer = createAssetTransformer()

    await assertRejects(
      () =>
        transformer.transformAudio(
          { sourcePath: 'upload.mp3' },
          { profile: 'voice', format: 'aac', outputPath: 'out.m4a' },
        ),
      Error,
      'Voice audio transcoding only accepts .wav sources',
    )
  },
)

Deno.test(
  'transformAudio: the SAME rejection happens with a cacheDir configured — the cache decorator ' +
    'never masks or bypasses the guardrail (it just reads/hashes the real source first, wasted ' +
    'I/O for a request that will always be rejected, but never a different or missing error)',
  async () => {
    const dir = await tempDir('asset-transformer-audio-guardrail-cached-')
    try {
      const sourcePath = join(dir, 'upload.opus')
      await Deno.writeFile(sourcePath, new Uint8Array([1, 2, 3]))
      const transformer = createAssetTransformer({ cacheDir: join(dir, 'cache') })
      await assertRejects(
        () =>
          transformer.transformAudio(
            { sourcePath },
            { profile: 'voice', format: 'aac', outputPath: join(dir, 'out.m4a') },
          ),
        Error,
        'Voice audio transcoding only accepts .wav sources',
      )
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

// --- cacheStore takes precedence over cacheDir; no directory created on disk when only cacheStore -

Deno.test(
  'createAssetTransformer: an explicit cacheStore takes precedence over cacheDir, and no directory ' +
    'is ever created on disk for a cacheDir that was never actually used',
  async () => {
    const dir = await tempDir('asset-transformer-store-precedence-')
    try {
      const unusedCacheDir = join(dir, 'never-created')
      const store = createInMemoryTransformCacheStore()
      const { optimize, calls } = createFakeImageOptimizer()
      const transformer = createAssetTransformer({
        cacheDir: unusedCacheDir,
        cacheStore: store,
        imageOptimizer: optimize,
      })
      const source = new Uint8Array([1, 2, 3])

      await transformer.transformImage('hero.jpg', source, true)
      await transformer.transformImage('hero.jpg', source, true)
      assertEquals(calls.count, 1, 'the explicit cacheStore must actually be used')

      const exists = await Deno.stat(unusedCacheDir).then(() => true).catch(() => false)
      assertEquals(
        exists,
        false,
        'a cacheDir shadowed by an explicit cacheStore must never be created',
      )
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

// --- AssetKind / isImplementedAssetKind: all four kinds are real today, including audio (its
// `voice` profile) — see `audio-transcoder.ts`'s own doc for why `'audio'` itself is a FAMILY of
// profiles rather than one policy, and why that doesn't need a second `AssetKind` member. --------

Deno.test(
  'isImplementedAssetKind: true for image/video/thumbnail/audio — all four are real',
  () => {
    assertEquals(isImplementedAssetKind('image'), true)
    assertEquals(isImplementedAssetKind('video'), true)
    assertEquals(isImplementedAssetKind('thumbnail'), true)
    assertEquals(isImplementedAssetKind('audio'), true)
  },
)

Deno.test(
  'AssetTransformerOptions: accepts explicit imageOptimizer/videoTranscoder/audioTranscoder overrides',
  () => {
    const options: AssetTransformerOptions = {
      imageOptimizer: createFakeImageOptimizer().optimize,
      videoTranscoder: createFakeTranscoder().transcoder,
      audioTranscoder: createFakeAudioTranscoder().transcoder,
    }
    // Constructing successfully IS the assertion — a type error here would fail `deno check`.
    const transformer = createAssetTransformer(options)
    assertEquals(typeof transformer.transformImage, 'function')
    assertEquals(typeof transformer.transformVideo, 'function')
    assertEquals(typeof transformer.transformThumbnail, 'function')
    assertEquals(typeof transformer.transformAudio, 'function')
  },
)
