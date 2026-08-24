import { assertEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { createCachedAudioTranscoder } from 'modules/media/audio/cached-audio-transcoder.ts'
import { createInMemoryTransformCacheStore } from 'modules/assets/transform-cache-store.ts'
import type {
  AudioTranscodeInput,
  AudioTranscoder,
  AudioTranscodeResult,
  AudioTransformOptions,
} from 'modules/media/audio/audio-transcoder.ts'

async function tempDir(prefix: string): Promise<string> {
  return await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url), prefix })
}

/** A fake `AudioTranscoder` — never touches real ffmpeg/ffprobe. `calls.transcode` counts real
 * invocations, the one thing this whole suite needs to observe: did the decorator actually call
 * through, or did it serve a cache hit. */
function createFakeAudioTranscoder(
  behavior: { outcome?: 'optimized' | 'never-worsened' | 'passthrough' } = {},
) {
  const outcome = behavior.outcome ?? 'optimized'
  const calls = { transcode: 0 }

  const transcoder: AudioTranscoder = {
    probe: () => Promise.resolve({ available: true }),

    async transcode(
      input: AudioTranscodeInput,
      options: AudioTransformOptions,
    ): Promise<AudioTranscodeResult> {
      calls.transcode++
      const sourceBytes = await Deno.readFile(input.sourcePath)
      const format = options.profile === 'voice' ? options.format : 'aac'
      const mimeType = format === 'opus' ? 'audio/opus' : 'audio/mp4'
      const extension = format === 'opus' ? 'opus' : 'm4a'

      if (outcome === 'passthrough') {
        await Deno.writeFile(options.outputPath, sourceBytes)
        return {
          outputPath: options.outputPath,
          bytesWritten: sourceBytes.byteLength,
          mimeType: 'audio/wav',
          format: 'wav',
          passthrough: true,
          neverWorsened: false,
        }
      }
      if (outcome === 'never-worsened') {
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
      // 'optimized' — a deterministic, real-looking transform of the source's own bytes, so two
      // DIFFERENT sources never accidentally produce the same "optimized" output. Always strictly
      // shorter than a real-sized source (see each test's own fixture size).
      const produced = sourceBytes.slice(0, Math.max(0, sourceBytes.length - 1))
      await Deno.writeFile(options.outputPath, produced)
      return {
        outputPath: options.outputPath,
        bytesWritten: produced.byteLength,
        mimeType,
        format: extension,
        sampleRateHz: format === 'opus' ? 48000 : 44100,
        channels: 1,
        passthrough: false,
        neverWorsened: false,
      }
    },
  }

  return { transcoder, calls }
}

// --- cache hit / miss matrix ------------------------------------------------------------------

Deno.test(
  'transcode(): same source + same voice options -> the second call makes ZERO real transcodes, returns identical bytes',
  async () => {
    const dir = await tempDir('cached-audio-hit-')
    try {
      const sourcePath = join(dir, 'source.wav')
      await Deno.writeFile(sourcePath, new Uint8Array(Array.from({ length: 20 }, (_, i) => i)))
      const { transcoder, calls } = createFakeAudioTranscoder()
      const store = createInMemoryTransformCacheStore()
      const cached = createCachedAudioTranscoder(transcoder, store)

      const out1 = join(dir, 'out1.m4a')
      const out2 = join(dir, 'out2.m4a')
      const first = await cached.transcode(
        { sourcePath },
        { profile: 'voice', format: 'aac', outputPath: out1 },
      )
      const second = await cached.transcode(
        { sourcePath },
        { profile: 'voice', format: 'aac', outputPath: out2 },
      )

      assertEquals(calls.transcode, 1, 'real transcoder must be called exactly once')
      assertEquals(second.bytesWritten, first.bytesWritten)
      assertEquals(second.mimeType, 'audio/mp4')
      assertEquals(second.format, 'm4a')
      assertEquals(
        new Uint8Array(await Deno.readFile(out2)),
        new Uint8Array(await Deno.readFile(out1)),
      )
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test('transcode(): a changed SOURCE forces a real recompute', async () => {
  const dir = await tempDir('cached-audio-source-changed-')
  try {
    const sourcePath = join(dir, 'source.wav')
    const { transcoder, calls } = createFakeAudioTranscoder()
    const store = createInMemoryTransformCacheStore()
    const cached = createCachedAudioTranscoder(transcoder, store)

    await Deno.writeFile(sourcePath, new Uint8Array(20).fill(1))
    await cached.transcode(
      { sourcePath },
      { profile: 'voice', format: 'aac', outputPath: join(dir, 'out1.m4a') },
    )
    await Deno.writeFile(sourcePath, new Uint8Array(20).fill(2))
    await cached.transcode(
      { sourcePath },
      { profile: 'voice', format: 'aac', outputPath: join(dir, 'out2.m4a') },
    )

    assertEquals(calls.transcode, 2, 'a real content change must invalidate the cache')
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test(
  'transcode(): aac <-> opus are independent transforms — no collision, both directions',
  async () => {
    const dir = await tempDir('cached-audio-format-changed-')
    try {
      const sourcePath = join(dir, 'source.wav')
      await Deno.writeFile(sourcePath, new Uint8Array(20).fill(3))
      const { transcoder, calls } = createFakeAudioTranscoder()
      const store = createInMemoryTransformCacheStore()
      const cached = createCachedAudioTranscoder(transcoder, store)

      await cached.transcode(
        { sourcePath },
        { profile: 'voice', format: 'aac', outputPath: join(dir, 'out.m4a') },
      )
      await cached.transcode(
        { sourcePath },
        { profile: 'voice', format: 'opus', outputPath: join(dir, 'out.opus') },
      )
      assertEquals(calls.transcode, 2, 'aac and opus must each transcode for real once')

      // Re-requesting each format again must now be a pure cache hit.
      await cached.transcode(
        { sourcePath },
        { profile: 'voice', format: 'aac', outputPath: join(dir, 'out2.m4a') },
      )
      await cached.transcode(
        { sourcePath },
        { profile: 'voice', format: 'opus', outputPath: join(dir, 'out2.opus') },
      )
      assertEquals(calls.transcode, 2, 'both formats must now be cache hits')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'transcode(): a changed bitrateKbps forces a real recompute (part of the identity)',
  async () => {
    const dir = await tempDir('cached-audio-bitrate-changed-')
    try {
      const sourcePath = join(dir, 'source.wav')
      await Deno.writeFile(sourcePath, new Uint8Array(20).fill(4))
      const { transcoder, calls } = createFakeAudioTranscoder()
      const store = createInMemoryTransformCacheStore()
      const cached = createCachedAudioTranscoder(transcoder, store)

      await cached.transcode(
        { sourcePath },
        { profile: 'voice', format: 'aac', outputPath: join(dir, 'out1.m4a') },
      )
      await cached.transcode(
        { sourcePath },
        { profile: 'voice', format: 'aac', bitrateKbps: 96, outputPath: join(dir, 'out2.m4a') },
      )

      assertEquals(calls.transcode, 2, 'a different bitrate is a different transform identity')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'transcode(): a policyVersion override forces a real recompute, independent of format/bitrate',
  async () => {
    const dir = await tempDir('cached-audio-policy-changed-')
    try {
      const sourcePath = join(dir, 'source.wav')
      await Deno.writeFile(sourcePath, new Uint8Array(20).fill(5))
      const { transcoder, calls } = createFakeAudioTranscoder()
      const store = createInMemoryTransformCacheStore()
      const v1 = createCachedAudioTranscoder(transcoder, store)
      const v2 = createCachedAudioTranscoder(transcoder, store, { policyVersion: 'v2' })

      await v1.transcode(
        { sourcePath },
        { profile: 'voice', format: 'aac', outputPath: join(dir, 'out1.m4a') },
      )
      await v2.transcode(
        { sourcePath },
        { profile: 'voice', format: 'aac', outputPath: join(dir, 'out2.m4a') },
      )
      assertEquals(calls.transcode, 2, 'a policy version bump must invalidate the old entry')

      // v1 (called again) must still be a cache hit against its OWN policy's entry.
      await v1.transcode(
        { sourcePath },
        { profile: 'voice', format: 'aac', outputPath: join(dir, 'out3.m4a') },
      )
      assertEquals(calls.transcode, 2, 'v1 must still be a pure cache hit against its own entry')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'transcode(): a never-worsened outcome is cached — replay never re-invokes the real transcoder, ' +
    "and correctly reports the SOURCE's own mimeType/format from cached meta (no ffprobe on replay)",
  async () => {
    const dir = await tempDir('cached-audio-never-worsened-')
    try {
      const sourcePath = join(dir, 'source.wav')
      await Deno.writeFile(sourcePath, new Uint8Array(20).fill(6))
      const { transcoder, calls } = createFakeAudioTranscoder({ outcome: 'never-worsened' })
      const store = createInMemoryTransformCacheStore()
      const cached = createCachedAudioTranscoder(transcoder, store)

      const first = await cached.transcode(
        { sourcePath },
        { profile: 'voice', format: 'aac', outputPath: join(dir, 'out1.m4a') },
      )
      const second = await cached.transcode(
        { sourcePath },
        { profile: 'voice', format: 'aac', outputPath: join(dir, 'out2.m4a') },
      )

      assertEquals(calls.transcode, 1, 'never-worsened must be cached — zero new real calls')
      assertEquals(first.neverWorsened, true)
      assertEquals(second.neverWorsened, true)
      assertEquals(second.mimeType, 'audio/wav')
      assertEquals(second.format, 'wav')
      assertEquals(second.sampleRateHz, 44100, 'replayed from cached meta, not a new ffprobe call')
      assertEquals(second.channels, 1)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'transcode(): a passthrough (ffmpeg unavailable) outcome is NEVER cached — every call re-invokes the real transcoder',
  async () => {
    const dir = await tempDir('cached-audio-passthrough-')
    try {
      const sourcePath = join(dir, 'source.wav')
      await Deno.writeFile(sourcePath, new Uint8Array(20).fill(7))
      const { transcoder, calls } = createFakeAudioTranscoder({ outcome: 'passthrough' })
      const store = createInMemoryTransformCacheStore()
      const cached = createCachedAudioTranscoder(transcoder, store)

      await cached.transcode(
        { sourcePath },
        { profile: 'voice', format: 'aac', outputPath: join(dir, 'out1.m4a') },
      )
      await cached.transcode(
        { sourcePath },
        { profile: 'voice', format: 'aac', outputPath: join(dir, 'out2.m4a') },
      )

      assertEquals(calls.transcode, 2, 'an environment-state passthrough must never be cached')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'transcode(): a corrupt/incompatible cache entry (bytes missing from the store) is treated as a safe miss',
  async () => {
    const dir = await tempDir('cached-audio-corrupt-')
    try {
      const sourcePath = join(dir, 'source.wav')
      await Deno.writeFile(sourcePath, new Uint8Array(20).fill(8))
      const { transcoder, calls } = createFakeAudioTranscoder()
      const store = createInMemoryTransformCacheStore()
      const cached = createCachedAudioTranscoder(transcoder, store)

      await cached.transcode(
        { sourcePath },
        { profile: 'voice', format: 'aac', outputPath: join(dir, 'out1.m4a') },
      )
      assertEquals(calls.transcode, 1)

      // Corrupt the store directly — the entry claims 'optimized' but its own bytes are gone.
      const sourceBytes = await Deno.readFile(sourcePath)
      const { hashSourceBytes, buildTransformCacheKey } = await import(
        'modules/assets/transform-cache.ts'
      )
      const key = buildTransformCacheKey({
        sourceHash: await hashSourceBytes(sourceBytes),
        transformId: 'voice:aac:b128',
        policyVersion: 'v1',
      })
      await store.setEntry(key, { status: 'optimized', bytesWritten: 999999 })

      await cached.transcode(
        { sourcePath },
        { profile: 'voice', format: 'aac', outputPath: join(dir, 'out2.m4a') },
      )
      assertEquals(
        calls.transcode,
        2,
        'a corrupt entry must fall through to a real, safe recompute',
      )
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)
