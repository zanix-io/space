import { assert, assertEquals } from '@std/assert'
import { InternalError } from '@zanix/errors'
import { dirname, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { createSystemFfmpegAudioTranscoder } from 'modules/media/audio/system-ffmpeg-audio-transcoder.ts'
import { probeFfmpegAvailability } from 'modules/media/ffmpeg-availability.ts'
import { probeSourceAudio } from 'modules/media/audio/ffprobe-audio.ts'

console.error = () => {}

/**
 * Real `ffmpeg`/`ffprobe` calls throughout, no mocks — same reasoning
 * `integration/media/system-ffmpeg-transcoder.test.ts` already documents. Gated on real
 * availability (`ignore`, top-level `await`, same convention). The contract/logic this exercises
 * is already covered without a real binary by the unit suite (`buildAudioTranscodeArgs`, the
 * real-environment throw/passthrough/fake-ffmpeg tests) — this file is the other half: does WAV ->
 * AAC/Opus actually work end to end, against real encoded bytes.
 */
const availability = await probeFfmpegAvailability()
const ignore = !availability.available

async function tempDir(prefix: string): Promise<string> {
  return await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url), prefix })
}

async function osTempDir(): Promise<string> {
  const probe = await Deno.makeTempFile()
  await Deno.remove(probe)
  return dirname(probe)
}

function snapshotDir(dir: string): Set<string> {
  return new Set([...Deno.readDirSync(dir)].map((entry) => entry.name))
}

/** Generates a real, deterministic WAV fixture via ffmpeg's own `lavfi` synthetic source — no
 * binary fixture checked into the repo, same reasoning
 * `system-ffmpeg-transcoder.test.ts`'s own video fixture generator documents. A sine tone (real
 * audio content, not silence) so the encoded output isn't a degenerate all-zero case. */
async function generateVoiceFixture(
  path: string,
  { durationSeconds = 3, sampleRate = 44100, channels = 1 } = {},
): Promise<void> {
  const { success, stderr } = await new Deno.Command('ffmpeg', {
    args: [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:sample_rate=${sampleRate}:duration=${durationSeconds}`,
      '-ac',
      String(channels),
      path,
    ],
    stderr: 'piped',
  }).output()
  assert(success, `fixture generation failed: ${new TextDecoder().decode(stderr)}`)
}

Deno.test({
  name: 'transcode(): real WAV -> AAC — correct codec/container/mimeType, sample rate preserved',
  ignore,
  async fn() {
    const dir = await tempDir('audio-integration-aac-')
    try {
      const sourcePath = join(dir, 'voice.wav')
      await generateVoiceFixture(sourcePath, { sampleRate: 44100, channels: 1 })
      const outputPath = join(dir, 'voice.m4a')

      const result = await createSystemFfmpegAudioTranscoder().transcode(
        { sourcePath },
        { profile: 'voice', format: 'aac', outputPath },
      )

      assertEquals(result.mimeType, 'audio/mp4')
      assertEquals(result.format, 'm4a')
      assertEquals(result.passthrough, false)

      const probed = await probeSourceAudio(outputPath)
      assertEquals(probed.codecName, 'aac')
      assertEquals(probed.sampleRateHz, 44100, 'AAC must preserve the real source sample rate')
      assertEquals(probed.channels, 1)
      assertEquals(result.sampleRateHz, 44100)
      assertEquals(result.channels, 1)

      const sourceStat = await Deno.stat(sourcePath)
      assert(result.bytesWritten < sourceStat.size, 'a real voice encode must be smaller than PCM')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
})

Deno.test({
  name: 'transcode(): real WAV -> Opus — correct codec/container/mimeType, channels preserved, ' +
    'sample rate is ALWAYS 48000 (a real, intrinsic Opus constraint, not a bug)',
  ignore,
  async fn() {
    const dir = await tempDir('audio-integration-opus-')
    try {
      const sourcePath = join(dir, 'voice.wav')
      await generateVoiceFixture(sourcePath, { sampleRate: 44100, channels: 2 })
      const outputPath = join(dir, 'voice.opus')

      const result = await createSystemFfmpegAudioTranscoder().transcode(
        { sourcePath },
        { profile: 'voice', format: 'opus', outputPath },
      )

      assertEquals(result.mimeType, 'audio/opus')
      assertEquals(result.format, 'opus')
      assertEquals(result.passthrough, false)

      const probed = await probeSourceAudio(outputPath)
      assertEquals(probed.sampleRateHz, 48000, 'Opus always outputs 48kHz regardless of source')
      assertEquals(probed.channels, 2, 'channels must be preserved even though sample rate is not')
      assertEquals(result.sampleRateHz, 48000)
      assertEquals(result.channels, 2)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
})

Deno.test({
  name: 'transcode(): output IS strictly smaller than a real, non-trivial voice source (128kbps ' +
    'target vs. uncompressed PCM)',
  ignore,
  async fn() {
    const dir = await tempDir('audio-integration-size-')
    try {
      const sourcePath = join(dir, 'voice.wav')
      // 10s @ 44100Hz mono PCM16 ≈ 882KB — comfortably larger than a 128kbps encode of the same
      // duration (≈160KB), a real, non-contrived size comparison.
      await generateVoiceFixture(sourcePath, { durationSeconds: 10 })
      const outputPath = join(dir, 'voice.m4a')

      const result = await createSystemFfmpegAudioTranscoder().transcode(
        { sourcePath },
        { profile: 'voice', format: 'aac', outputPath },
      )

      const sourceStat = await Deno.stat(sourcePath)
      assertEquals(result.neverWorsened, false)
      assert(
        result.bytesWritten < sourceStat.size * 0.5,
        `expected a real, substantial reduction: ${result.bytesWritten} vs ${sourceStat.size}`,
      )
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
})

Deno.test({
  name: 'transcode(): never-worsen — a pathologically tiny WAV is left untouched, reports the ' +
    "source's own real type, and leaves no temp file behind",
  ignore,
  async fn() {
    const dir = await tempDir('audio-integration-never-worsen-')
    try {
      const sourcePath = join(dir, 'tiny.wav')
      // A few milliseconds of audio — real encoder container/header overhead alone reliably
      // exceeds this source's own tiny size, the real trigger condition (never fabricated by
      // mocking a size comparison).
      await generateVoiceFixture(sourcePath, { durationSeconds: 0.01 })
      const outputPath = join(dir, 'tiny.m4a')
      const osTemp = await osTempDir()
      const before = snapshotDir(osTemp)

      const result = await createSystemFfmpegAudioTranscoder().transcode(
        { sourcePath },
        { profile: 'voice', format: 'aac', outputPath },
      )

      assertEquals(result.neverWorsened, true)
      assertEquals(result.mimeType, 'audio/wav', "must report the source's own real type")
      assertEquals(result.format, 'wav')

      const outputBytes = await Deno.readFile(outputPath)
      const sourceBytes = await Deno.readFile(sourcePath)
      assertEquals(new Uint8Array(outputBytes), new Uint8Array(sourceBytes))

      const after = snapshotDir(osTemp)
      assertEquals(after, before, 'no temp file must outlive a never-worsened call')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
})

Deno.test({
  name:
    'transcode(): a corrupt/non-audio source makes ffmpeg fail, and never publishes a partial output',
  ignore,
  async fn() {
    const dir = await tempDir('audio-integration-ffmpeg-fails-')
    try {
      const sourcePath = join(dir, 'not-audio.wav')
      await Deno.writeFile(sourcePath, new TextEncoder().encode('this is not a real wav file'))
      const outputPath = join(dir, 'out.m4a')
      const osTemp = await osTempDir()
      const before = snapshotDir(osTemp)

      let caught: unknown
      try {
        await createSystemFfmpegAudioTranscoder().transcode(
          { sourcePath },
          { profile: 'voice', format: 'aac', outputPath },
        )
      } catch (error) {
        caught = error
      }
      assert(caught, 'a corrupt source must throw, never silently produce a bad file')
      assert(caught instanceof InternalError)
      assertEquals(caught.code, 'SPACE_MEDIA_FFMPEG_TRANSCODE_FAILED')

      const outputExists = await Deno.stat(outputPath).then(() => true).catch(() => false)
      assertEquals(outputExists, false, 'no partial output must ever be published on failure')

      const after = snapshotDir(osTemp)
      assertEquals(after, before, 'no temp file must outlive a failed call')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
})

Deno.test({
  name: 'transcode(): a real, smaller encode still lands at outputPath when the temp-to-output ' +
    'move hits a cross-device rename failure (EXDEV) — the copy+remove fallback, not just a ' +
    'same-device Deno.rename',
  ignore,
  async fn() {
    const dir = await tempDir('audio-integration-move-fallback-')
    // `Deno.rename` is reassigned directly (this codebase's own established pattern for this
    // class of problem — see `complete-test-coverage`'s own doc on stubbing a low-level primitive)
    // rather than actually spanning two real filesystems/devices, which CI/dev environments can't
    // reliably guarantee. Scoped to just this one call via try/finally; nothing else in this
    // process calls `Deno.rename` concurrently within an `await`-free window.
    const originalRename = Deno.rename
    try {
      const sourcePath = join(dir, 'voice.wav')
      await generateVoiceFixture(sourcePath, { sampleRate: 44100, channels: 1 })
      const outputPath = join(dir, 'voice.m4a')

      let renameAttempted = false
      Deno.rename = () => {
        renameAttempted = true
        return Promise.reject(new Error('EXDEV: cross-device link not permitted (simulated)'))
      }

      const result = await createSystemFfmpegAudioTranscoder().transcode(
        { sourcePath },
        { profile: 'voice', format: 'aac', outputPath },
      )

      assert(renameAttempted, 'expected the real code path to have tried Deno.rename first')
      assertEquals(result.passthrough, false)
      // The move fallback still landed the REAL encoded bytes at outputPath, not the temp path.
      const probed = await probeSourceAudio(outputPath)
      assertEquals(probed.codecName, 'aac')
      const stat = await Deno.stat(outputPath)
      assertEquals(stat.size, result.bytesWritten)
    } finally {
      Deno.rename = originalRename
      await Deno.remove(dir, { recursive: true })
    }
  },
})
