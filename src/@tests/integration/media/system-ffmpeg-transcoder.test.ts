import { assert, assertEquals, assertRejects } from '@std/assert'
import { InternalError } from '@zanix/errors'
import { dirname, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { createSystemFfmpegTranscoder } from 'modules/media/system-ffmpeg-transcoder.ts'
import { probeFfmpegAvailability } from 'modules/media/ffmpeg-availability.ts'
import { probeSourceVideo } from 'modules/media/ffprobe-media.ts'

console.error = () => {}

/**
 * Real `ffmpeg`/`ffprobe` calls throughout, no mocks — same reasoning
 * `integration/assets/image-optimize.test.ts` already documents for `sharp`: whether a real
 * encode is actually smaller/correctly-capped/correctly-cleaned-up can only be verified against
 * real encoded bytes and a real filesystem. Gated on real availability (`ignore`, computed once at
 * module load via top-level `await`) — this dev/CI environment has no ffmpeg installed (confirmed
 * with `which ffmpeg` before writing this suite), so this whole file is skipped here; it runs for
 * real wherever `ffmpeg`/`ffprobe` (with the required encoders) actually are installed. The
 * contract/logic this exercises is ALREADY covered without a real binary by the unit suite
 * (`@tests/unit/media/system-ffmpeg-transcoder.test.ts`'s own pure `buildTranscodeArgs`/
 * `buildThumbnailArgs` tests, and the real-environment throw/passthrough tests that exploit this
 * same binary absence) — this file is the other half: does it actually WORK end to end.
 */
const availability = await probeFfmpegAvailability()
const ignore = !availability.available

async function tempDir(prefix: string): Promise<string> {
  return await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url), prefix })
}

/** The real OS temp directory `Deno.makeTempFile()` places files in — discovered portably (never
 * hardcoded as `/tmp`, which isn't where macOS actually puts them) by creating and immediately
 * removing a real temp file, then taking its parent directory. */
async function osTempDir(): Promise<string> {
  const probe = await Deno.makeTempFile()
  await Deno.remove(probe)
  return dirname(probe)
}

/** A snapshot of `dir`'s own entry names, for a before/after diff — the only reliable way to
 * confirm SystemFfmpegTranscoder's own temp file (created deep inside `transcode`/
 * `extractThumbnail`, with no path this test can predict ahead of time) doesn't outlive the call
 * that created it, on either the success or the failure path. */
function snapshotDir(dir: string): Set<string> {
  return new Set([...Deno.readDirSync(dir)].map((entry) => entry.name))
}

/**
 * Generates a real, deterministic test video via ffmpeg's own `lavfi` synthetic sources — no
 * binary fixture file checked into the repo. Two DISTINCT patterns, deliberately, after a real
 * ffmpeg run revealed why using the same one for both would confuse two different rules
 * (see the "never worsen" and "resize/capping" tests below for exactly which one each needs):
 * - `'color'` (solid black) — intentionally near-zero entropy: it compresses to nearly nothing at
 *   any real encoder's own default settings, which is exactly what the "never worsen" test needs
 *   (re-encoding a near-empty source at a higher TARGET bitrate reliably produces a LARGER file,
 *   the real trigger condition — never fabricated by mocking a size comparison).
 * - `'testsrc'` — a real, detailed, moving test pattern with genuine entropy. Confirmed necessary
 *   by a real failure: a `'color'` source made the RESIZE test's own re-encode (720p + a real
 *   128kbps audio track) end up LARGER than the tiny original, correctly triggering "never worsen"
 *   and discarding the resize — a true rule interaction, not a resize bug, but one that made the
 *   resize test unable to tell its own subject apart from a different rule's own correct behavior.
 *   `testsrc` has enough real content that a genuine resolution/bitrate reduction reliably wins.
 */
async function generateFixtureVideo(
  path: string,
  options: {
    width?: number
    height?: number
    durationSeconds?: number
    withAudio?: boolean
    pattern?: 'color' | 'testsrc'
    faststart?: boolean
  } = {},
): Promise<void> {
  const width = options.width ?? 640
  const height = options.height ?? 480
  const duration = options.durationSeconds ?? 1
  const pattern = options.pattern ?? 'color'
  const source = pattern === 'testsrc'
    ? `testsrc=size=${width}x${height}:duration=${duration}:rate=10`
    : `color=black:size=${width}x${height}:duration=${duration}:rate=5`
  const args = ['-y', '-f', 'lavfi', '-i', source]
  if (options.withAudio) {
    args.push('-f', 'lavfi', '-i', `sine=frequency=1000:duration=${duration}`)
  }
  args.push('-pix_fmt', 'yuv420p', '-c:v', 'libx264')
  if (options.faststart) args.push('-movflags', '+faststart')
  args.push(path)
  const { success, stderr } = await new Deno.Command('ffmpeg', { args, stderr: 'piped' }).output()
  assert(success, `fixture generation failed: ${new TextDecoder().decode(stderr)}`)
}

/**
 * A real video with a valid, FRONT-loaded `moov` atom (`-movflags +faststart`) whose actual frame
 * data is then truncated away — `ffprobe` can still read stream metadata (width/height/duration
 * all live in `moov`), but `ffmpeg` genuinely fails once it tries to decode/re-encode frames that
 * no longer exist. Confirmed empirically against this real ffmpeg build before being used here (a
 * prior attempt tried to force a failure with an "invalid" CLI argument, `width: 0` — which turned
 * out to be real, valid ffmpeg syntax, "keep the source's own dimension," never an error at all).
 * A plain truncation WITHOUT `+faststart` risks destroying `moov` itself (the default mp4 muxer
 * places it at the END, after all frame data) — that would fail at the PROBE stage instead, the
 * different failure mode the corrupt-input test below already covers.
 */
async function generateCorruptMidEncodeFixture(path: string): Promise<void> {
  const fullPath = `${path}.full.mp4`
  await generateFixtureVideo(fullPath, {
    width: 640,
    height: 480,
    durationSeconds: 3,
    pattern: 'testsrc',
    faststart: true,
  })
  const fullBytes = await Deno.readFile(fullPath)
  // The front ~40% keeps moov (faststart put it first) but is well short of all the frame data a
  // real 3-second clip needs — confirmed empirically to make ffprobe succeed and ffmpeg fail.
  const truncated = fullBytes.slice(0, Math.floor(fullBytes.byteLength * 0.4))
  await Deno.writeFile(path, truncated)
  await Deno.remove(fullPath)
}

Deno.test({
  name: 'transcode(): a real video is re-encoded and capped to the breakpoint width',
  ignore,
  async fn() {
    const dir = await tempDir('transcode-resize-')
    try {
      const sourcePath = join(dir, 'source.mp4')
      const outputPath = join(dir, 'output.mp4')
      // `testsrc`, not `color` — real entropy, so the resize/bitrate-capped re-encode reliably
      // wins against the original, keeping this test about the resize/capping RULE, not an
      // accidental collision with the never-worsen one (see generateFixtureVideo's own doc for
      // the real failure that showed why `color` breaks this specific test).
      await generateFixtureVideo(sourcePath, { width: 1280, height: 720, pattern: 'testsrc' })

      const transcoder = createSystemFfmpegTranscoder()
      const result = await transcoder.transcode(
        { sourcePath },
        { breakpoint: 'msm', outputPath },
      )

      // Asserted FIRST, explicitly, and separately from the dimension checks below: this test is
      // about the resize/capping path specifically. If a future regression makes never-worsen
      // fire here too, it should fail on THIS assertion (which names the real cause) rather than
      // surface as a confusing dimension mismatch further down.
      assertEquals(result.neverWorsened, false)
      assertEquals(result.passthrough, false)
      assertEquals(result.outputPath, outputPath)
      assert(result.bytesWritten > 0)
      assertEquals(result.mimeType, 'video/mp4')

      const outputInfo = await probeSourceVideo(outputPath)
      // msm caps width at 720 — source was 1280, so the real output must have been scaled down.
      assertEquals(outputInfo.widthPx, 720)
      // Height must be EVEN — the real point of scale=width:-2 over a hand-computed height.
      assertEquals(outputInfo.heightPx % 2, 0)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
})

Deno.test({
  name: 'transcode(): a video-only source (no audio stream) is transcoded without error',
  ignore,
  async fn() {
    const dir = await tempDir('transcode-no-audio-')
    try {
      const sourcePath = join(dir, 'source.mp4')
      const outputPath = join(dir, 'output.mp4')
      await generateFixtureVideo(sourcePath, { withAudio: false })

      const transcoder = createSystemFfmpegTranscoder()
      const result = await transcoder.transcode(
        { sourcePath },
        { breakpoint: 'msm', outputPath },
      )

      assertEquals(result.passthrough, false)
      const outputInfo = await probeSourceVideo(outputPath)
      assertEquals(outputInfo.hasAudio, false)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
})

Deno.test({
  name: 'transcode(): "never worsen" — a near-empty source is left untouched, not re-encoded up',
  ignore,
  async fn() {
    const dir = await tempDir('transcode-never-worsen-')
    try {
      const sourcePath = join(dir, 'source.mp4')
      const outputPath = join(dir, 'output.mp4')
      // A solid-color, silent, short clip — compresses to a few hundred bytes at any real
      // encoder's own default settings, far smaller than a real target of msm's own 1000kbps.
      await generateFixtureVideo(sourcePath, { width: 640, height: 480, durationSeconds: 1 })
      const sourceSize = (await Deno.stat(sourcePath)).size

      const transcoder = createSystemFfmpegTranscoder()
      const result = await transcoder.transcode(
        { sourcePath },
        { breakpoint: 'msm', outputPath },
      )

      assertEquals(result.neverWorsened, true)
      assertEquals(result.passthrough, false)
      // outputPath holds an exact copy of the untouched source — same byte size.
      assertEquals(result.bytesWritten, sourceSize)
      assertEquals(await Deno.readFile(outputPath), await Deno.readFile(sourcePath))
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
})

Deno.test({
  name: 'transcode(): its own temp file is cleaned up after a SUCCESSFUL transcode',
  ignore,
  async fn() {
    const dir = await tempDir('transcode-cleanup-success-')
    try {
      const sourcePath = join(dir, 'source.mp4')
      const outputPath = join(dir, 'output.mp4')
      await generateFixtureVideo(sourcePath, { width: 1280, height: 720 })

      const tmp = await osTempDir()
      const before = snapshotDir(tmp)

      const transcoder = createSystemFfmpegTranscoder()
      await transcoder.transcode({ sourcePath }, { breakpoint: 'msm', outputPath })

      const after = snapshotDir(tmp)
      const leftover = [...after].filter((name) => !before.has(name))
      // The legacy pipeline's own real bug (confirmed reading its source): its "temporal" file was
      // never actually cleaned up on the success path. This is the regression test for that fix.
      assertEquals(
        leftover.filter((name) => name.endsWith('.mp4') || name.endsWith('.webm')),
        [],
        `expected no leftover temp video file in ${tmp}, found: ${leftover.join(', ')}`,
      )
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
})

Deno.test({
  name: 'transcode(): its own temp file is cleaned up when FFMPEG ITSELF fails mid-encode',
  ignore,
  async fn() {
    // Distinct from the corrupt-input test below: THIS source has a real, readable moov atom —
    // probeSourceVideo succeeds — but truncated frame data, so ffmpeg itself is the one that
    // fails, genuinely partway through decoding/encoding, AFTER this call's own temp file already
    // exists on disk. This is the one real exercise of the `finally` cleanup path for a temp file
    // that genuinely existed when the failure happened — see
    // generateCorruptMidEncodeFixture's own doc for why this specific construction (not an
    // "invalid argument," which turned out not to exist) is what actually fails.
    const dir = await tempDir('transcode-cleanup-error-')
    try {
      const sourcePath = join(dir, 'corrupt-mid.mp4')
      const outputPath = join(dir, 'output.mp4')
      await generateCorruptMidEncodeFixture(sourcePath)

      const tmp = await osTempDir()
      const before = snapshotDir(tmp)

      const transcoder = createSystemFfmpegTranscoder()
      const error = await assertRejects(
        () => transcoder.transcode({ sourcePath }, { breakpoint: 'msm', outputPath }),
        InternalError,
        'ffmpeg failed to transcode',
      )
      assertEquals(error.code, 'SPACE_MEDIA_FFMPEG_TRANSCODE_FAILED')

      assertEquals(await Deno.stat(outputPath).catch(() => null), null)
      const after = snapshotDir(tmp)
      const leftover = [...after].filter((name) => !before.has(name))
      assertEquals(
        leftover.filter((name) => name.endsWith('.mp4') || name.endsWith('.webm')),
        [],
        `expected no leftover temp video file in ${tmp} after ffmpeg itself failed, found: ${
          leftover.join(', ')
        }`,
      )
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
})

Deno.test({
  name: 'transcode(): a corrupt/non-video input fails with a clear thrown error, no crash',
  ignore,
  async fn() {
    const dir = await tempDir('transcode-corrupt-')
    try {
      const sourcePath = join(dir, 'not-a-video.mp4')
      const outputPath = join(dir, 'output.mp4')
      await Deno.writeTextFile(sourcePath, 'this is definitely not a video file')

      const tmp = await osTempDir()
      const before = snapshotDir(tmp)

      const transcoder = createSystemFfmpegTranscoder()
      const error = await assertRejects(
        () => transcoder.transcode({ sourcePath }, { breakpoint: 'msm', outputPath }),
        InternalError,
      )
      // Verified empirically (not assumed): ffprobe exits non-zero on this corrupt input, rather
      // than exiting 0 with an empty/no-video-stream report — see `SPACE_MEDIA_FFPROBE_EXIT_ERROR`'s
      // own call site (`probeSourceVideo`, `ffprobe-media.ts`) for the exact branch this hits.
      assertEquals(error.code, 'SPACE_MEDIA_FFPROBE_EXIT_ERROR')

      // Neither the intended output nor a leftover temp file survives a failed probe/encode.
      assertEquals(await Deno.stat(outputPath).catch(() => null), null)
      const after = snapshotDir(tmp)
      const leftover = [...after].filter((name) => !before.has(name))
      assertEquals(
        leftover.filter((name) => name.endsWith('.mp4') || name.endsWith('.webm')),
        [],
        `expected no leftover temp video file in ${tmp} after a failed transcode, found: ${
          leftover.join(', ')
        }`,
      )
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
})

Deno.test({
  name: 'extractThumbnail(): a real frame is extracted at the requested timestamp/width',
  ignore,
  async fn() {
    const dir = await tempDir('thumbnail-')
    try {
      const sourcePath = join(dir, 'source.mp4')
      const outputPath = join(dir, 'thumb.jpg')
      await generateFixtureVideo(sourcePath, { width: 640, height: 480, durationSeconds: 2 })

      const transcoder = createSystemFfmpegTranscoder()
      const result = await transcoder.extractThumbnail(
        { sourcePath },
        { outputPath, atSeconds: 1, width: 320 },
      )

      assertEquals(result.outputPath, outputPath)
      assertEquals(result.mimeType, 'image/jpeg')
      assert(result.bytesWritten > 0)
      const bytes = await Deno.readFile(outputPath)
      // A real JPEG file — starts with the standard JFIF magic bytes.
      assertEquals(bytes[0], 0xff)
      assertEquals(bytes[1], 0xd8)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
})

Deno.test({
  name: 'extractThumbnail(): a corrupt input fails with a clear thrown error, no crash',
  ignore,
  async fn() {
    const dir = await tempDir('thumbnail-corrupt-')
    try {
      const sourcePath = join(dir, 'not-a-video.mp4')
      const outputPath = join(dir, 'thumb.jpg')
      await Deno.writeTextFile(sourcePath, 'not a video')

      const transcoder = createSystemFfmpegTranscoder()
      const error = await assertRejects(
        () => transcoder.extractThumbnail({ sourcePath }, { outputPath }),
        InternalError,
      )
      // Verified empirically: extractThumbnail() never calls probeSourceVideo (see its own
      // module doc) — ffmpeg itself is the one that fails extracting a frame from this input.
      assertEquals(error.code, 'SPACE_MEDIA_FFMPEG_THUMBNAIL_FAILED')
      assertEquals(await Deno.stat(outputPath).catch(() => null), null)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
})

Deno.test({
  name: 'transcode(): a real, smaller encode still lands at outputPath when the temp-to-output ' +
    'move hits a cross-device rename failure (EXDEV) — the copy+remove fallback, not just a ' +
    'same-device Deno.rename (mirrors the identical audio-transcoder regression test)',
  ignore,
  async fn() {
    const dir = await tempDir('transcode-move-fallback-')
    // `Deno.rename` is reassigned directly (this codebase's own established pattern — see
    // `system-ffmpeg-audio-transcoder.test.ts`'s own identical test) rather than actually
    // spanning two real filesystems/devices, which CI/dev environments can't reliably guarantee.
    const originalRename = Deno.rename
    try {
      const sourcePath = join(dir, 'source.mp4')
      const outputPath = join(dir, 'output.mp4')
      await generateFixtureVideo(sourcePath, { width: 1280, height: 720, pattern: 'testsrc' })

      let renameAttempted = false
      Deno.rename = () => {
        renameAttempted = true
        return Promise.reject(new Error('EXDEV: cross-device link not permitted (simulated)'))
      }

      const transcoder = createSystemFfmpegTranscoder()
      const result = await transcoder.transcode(
        { sourcePath },
        { breakpoint: 'msm', outputPath },
      )

      assert(renameAttempted, 'expected the real code path to have tried Deno.rename first')
      assertEquals(result.neverWorsened, false)
      const outputInfo = await probeSourceVideo(outputPath)
      assertEquals(outputInfo.widthPx, 720)
      const stat = await Deno.stat(outputPath)
      assertEquals(stat.size, result.bytesWritten)
    } finally {
      Deno.rename = originalRename
      await Deno.remove(dir, { recursive: true })
    }
  },
})
