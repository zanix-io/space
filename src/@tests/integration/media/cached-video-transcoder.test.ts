import { assert, assertEquals, assertNotEquals, assertRejects } from '@std/assert'
import { dirname, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { createSystemFfmpegTranscoder } from 'modules/media/system-ffmpeg-transcoder.ts'
import { createCachedVideoTranscoder } from 'modules/media/cached-video-transcoder.ts'
import { createFileTransformCacheStore } from 'modules/assets/transform-cache-store.ts'
import { probeFfmpegAvailability } from 'modules/media/ffmpeg-availability.ts'
import type {
  ThumbnailOptions,
  ThumbnailResult,
  TranscodeInput,
  VideoTranscoder,
} from 'modules/media/video-transcoder.ts'

console.error = () => {}

/**
 * Closes the "extractThumbnail() existing doesn't mean the whole flow is proven" gap:
 * real, end-to-end proof — against real `ffmpeg`/`ffprobe`, never a fake — that a thumbnail is a
 * genuinely independent, cached, idempotent asset transformation, and that its own real-world
 * properties (cleanup, format, dimensions, determinism) hold. Same `ignore`-when-unavailable
 * gating as every sibling integration suite in this directory.
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

async function run(args: string[]): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const { success, stdout, stderr } = await new Deno.Command('ffmpeg', {
    args,
    stdout: 'piped',
    stderr: 'piped',
  })
    .output()
  return {
    success,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  }
}

async function generateFixture(path: string, durationSeconds = 2): Promise<void> {
  const { success, stderr } = await run([
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=640x480:duration=${durationSeconds}:rate=10`,
    '-pix_fmt',
    'yuv420p',
    '-c:v',
    'libx264',
    path,
  ])
  assert(success, `fixture generation failed: ${stderr}`)
}

/** Same construction as the sibling `system-ffmpeg-transcoder.test.ts`'s own
 * `generateCorruptMidEncodeFixture`: a real, front-loaded `moov` atom (so `ffprobe` — and hence
 * this decorator's own `Deno.readFile` + hashing — succeeds) whose frame data is truncated away,
 * so `ffmpeg` itself genuinely fails partway through, AFTER its own temp file already exists. */
async function generateCorruptFixture(path: string): Promise<void> {
  const fullPath = `${path}.full.mp4`
  const { success, stderr } = await run([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x480:duration=3:rate=10',
    '-pix_fmt',
    'yuv420p',
    '-c:v',
    'libx264',
    '-movflags',
    '+faststart',
    fullPath,
  ])
  assert(success, stderr)
  const fullBytes = await Deno.readFile(fullPath)
  await Deno.writeFile(path, fullBytes.slice(0, Math.floor(fullBytes.byteLength * 0.4)))
  await Deno.remove(fullPath)
}

async function probeImage(path: string): Promise<{ width: number; height: number }> {
  const { success: ok, stdout: out } = await new Deno.Command('ffprobe', {
    args: ['-v', 'quiet', '-print_format', 'json', '-show_streams', path],
    stdout: 'piped',
  }).output()
  assert(ok, `ffprobe failed to read ${path}`)
  const parsed = JSON.parse(new TextDecoder().decode(out))
  const stream = parsed.streams[0]
  return { width: stream.width, height: stream.height }
}

/** Counts real invocations of the underlying `VideoTranscoder` — wraps the REAL
 * `createSystemFfmpegTranscoder()` (never a fake), so this is a direct, real proof that a cache
 * hit skips `ffmpeg` entirely, not an assumption about the decorator's own internals. */
function withCallCounter(transcoder: VideoTranscoder) {
  const calls = { transcode: 0, thumbnail: 0 }
  const counted: VideoTranscoder = {
    probe: transcoder.probe,
    transcode(input, options) {
      calls.transcode++
      return transcoder.transcode(input, options)
    },
    extractThumbnail(input: TranscodeInput, options: ThumbnailOptions): Promise<ThumbnailResult> {
      calls.thumbnail++
      return transcoder.extractThumbnail(input, options)
    },
  }
  return { transcoder: counted, calls }
}

// --- Real, end-to-end idempotency: a second identical request never calls ffmpeg again ----------

Deno.test({
  name:
    'extractThumbnail(): a second identical request (same source/policy) never calls real ffmpeg again',
  ignore,
  async fn() {
    const dir = await tempDir('cached-thumb-real-idempotent-')
    try {
      const sourcePath = join(dir, 'source.mp4')
      await generateFixture(sourcePath)

      const { transcoder, calls } = withCallCounter(createSystemFfmpegTranscoder())
      const store = createFileTransformCacheStore(join(dir, 'cache'))
      const cached = createCachedVideoTranscoder(transcoder, store)

      const outputPath1 = join(dir, 'thumb1.jpg')
      const first = await cached.extractThumbnail({ sourcePath }, {
        outputPath: outputPath1,
        atSeconds: 1,
        width: 200,
      })
      assertEquals(calls.thumbnail, 1)

      // A second, real request — same source, same policy, even a DIFFERENT outputPath (a fresh
      // build/API request would rarely reuse the exact same temp path).
      const outputPath2 = join(dir, 'thumb2.jpg')
      const second = await cached.extractThumbnail({ sourcePath }, {
        outputPath: outputPath2,
        atSeconds: 1,
        width: 200,
      })
      assertEquals(
        calls.thumbnail,
        1,
        'ffmpeg must not be invoked a second time for an identical request',
      )
      assertEquals(second.bytesWritten, first.bytesWritten)
      assertEquals(await Deno.readFile(outputPath2), await Deno.readFile(outputPath1))
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
})

Deno.test({
  name:
    'transcode(): a second identical request (same source/policy) never calls real ffmpeg again',
  ignore,
  async fn() {
    const dir = await tempDir('cached-transcode-real-idempotent-')
    try {
      const sourcePath = join(dir, 'source.mp4')
      await generateFixture(sourcePath, 3)

      const { transcoder, calls } = withCallCounter(createSystemFfmpegTranscoder())
      const store = createFileTransformCacheStore(join(dir, 'cache'))
      const cached = createCachedVideoTranscoder(transcoder, store)

      const outputPath1 = join(dir, 'out1.mp4')
      await cached.transcode({ sourcePath }, { breakpoint: 'msm', outputPath: outputPath1 })
      assertEquals(calls.transcode, 1)

      const outputPath2 = join(dir, 'out2.mp4')
      await cached.transcode({ sourcePath }, { breakpoint: 'msm', outputPath: outputPath2 })
      assertEquals(
        calls.transcode,
        1,
        'ffmpeg must not be invoked a second time for an identical request',
      )
      assertEquals(await Deno.readFile(outputPath2), await Deno.readFile(outputPath1))
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
})

// --- Format/dimensions: real, ffprobe-verified, not assumed from magic bytes alone ---------------
//
// WebP is a GUARANTEED thumbnail format (see ffmpeg-availability.ts's own `capabilities.
// webpEncoder` doc and system-ffmpeg-transcoder.ts's own explicit capability check) — this test
// asserts the CORRECT branch for whatever THIS real host's real ffmpeg build actually has, never
// skips webp outright. Confirmed separately (Docker: Debian trixie's own `apt-get install
// ffmpeg`) that the officially provisioned runtime always has it; a bare-metal Homebrew build
// commonly does not — both are real, both are asserted here, neither is silently ignored.

Deno.test({
  name:
    'extractThumbnail(): jpeg/png — the requested width is the REAL output width (ffprobe-verified)',
  ignore,
  async fn() {
    const dir = await tempDir('cached-thumb-dimensions-')
    try {
      const sourcePath = join(dir, 'source.mp4')
      await generateFixture(sourcePath)
      const transcoder = createSystemFfmpegTranscoder()

      for (const format of ['jpeg', 'png'] as const) {
        const extension = format === 'jpeg' ? 'jpg' : format
        const outputPath = join(dir, `thumb.${extension}`)
        // deno-lint-ignore no-await-in-loop
        const result = await transcoder.extractThumbnail(
          { sourcePath },
          { outputPath, atSeconds: 1, width: 240, format },
        )
        assertEquals(result.mimeType, `image/${format}`)
        // deno-lint-ignore no-await-in-loop
        const dims = await probeImage(outputPath)
        assertEquals(dims.width, 240, `${format} thumbnail width must match the requested 240`)
        assertEquals(
          dims.height % 2,
          0,
          `${format} thumbnail height must stay even (scale=width:-2)`,
        )
      }
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
})

Deno.test({
  name:
    "extractThumbnail({format:'webp'}): a GUARANTEED capability — real success + ffprobe-verified " +
    'dimensions when libwebp is present, a SPECIFIC actionable error when it is not — never skipped',
  ignore,
  async fn() {
    const dir = await tempDir('cached-thumb-webp-')
    try {
      const sourcePath = join(dir, 'source.mp4')
      await generateFixture(sourcePath)
      const transcoder = createSystemFfmpegTranscoder()
      const outputPath = join(dir, 'thumb.webp')

      const capabilityAvailability = await probeFfmpegAvailability()
      const webpAvailable = capabilityAvailability.capabilities?.webpEncoder === true

      if (webpAvailable) {
        const result = await transcoder.extractThumbnail(
          { sourcePath },
          { outputPath, atSeconds: 1, width: 240, format: 'webp' },
        )
        assertEquals(result.mimeType, 'image/webp')
        const dims = await probeImage(outputPath)
        assertEquals(dims.width, 240, 'webp thumbnail width must match the requested 240')
        assertEquals(dims.height % 2, 0, 'webp thumbnail height must stay even (scale=width:-2)')
      } else {
        await assertRejects(
          () =>
            transcoder.extractThumbnail(
              { sourcePath },
              { outputPath, atSeconds: 1, width: 240, format: 'webp' },
            ),
          Error,
          'System ffmpeg is missing WebP encoder support',
        )
        assertEquals(await Deno.stat(outputPath).catch(() => null), null)
      }
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
})

// --- Determinism: two REAL, uncached extractions of the same source/options are byte-identical ---

Deno.test({
  name:
    'extractThumbnail(): two live (uncached) extractions of the same source/options are byte-identical',
  ignore,
  async fn() {
    const dir = await tempDir('cached-thumb-determinism-')
    try {
      const sourcePath = join(dir, 'source.mp4')
      await generateFixture(sourcePath)
      const transcoder = createSystemFfmpegTranscoder()

      const outputPathA = join(dir, 'a.jpg')
      const outputPathB = join(dir, 'b.jpg')
      await transcoder.extractThumbnail({ sourcePath }, {
        outputPath: outputPathA,
        atSeconds: 1,
        width: 200,
      })
      await transcoder.extractThumbnail({ sourcePath }, {
        outputPath: outputPathB,
        atSeconds: 1,
        width: 200,
      })

      assertEquals(
        await Deno.readFile(outputPathA),
        await Deno.readFile(outputPathB),
        'the real transcoder itself must be deterministic for identical inputs — the cache assumes this',
      )
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
})

Deno.test({
  name:
    'extractThumbnail(): a DIFFERENT atSeconds produces a genuinely different frame (sanity, not a false positive)',
  ignore,
  async fn() {
    const dir = await tempDir('cached-thumb-different-frame-')
    try {
      const sourcePath = join(dir, 'source.mp4')
      await generateFixture(sourcePath, 4)
      const transcoder = createSystemFfmpegTranscoder()

      const outputPathA = join(dir, 'a.jpg')
      const outputPathB = join(dir, 'b.jpg')
      await transcoder.extractThumbnail({ sourcePath }, { outputPath: outputPathA, atSeconds: 1 })
      await transcoder.extractThumbnail({ sourcePath }, { outputPath: outputPathB, atSeconds: 3 })

      assertNotEquals(await Deno.readFile(outputPathA), await Deno.readFile(outputPathB))
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
})

// --- Cleanup on ffmpeg failure: the sibling suite's own transcode() test, mirrored for thumbnails -

Deno.test({
  name:
    'extractThumbnail(): its own temp file is cleaned up when FFMPEG ITSELF fails mid-extraction',
  ignore,
  async fn() {
    const dir = await tempDir('cached-thumb-cleanup-error-')
    try {
      const sourcePath = join(dir, 'corrupt-mid.mp4')
      const outputPath = join(dir, 'thumb.jpg')
      await generateCorruptFixture(sourcePath)

      const tmp = await osTempDir()
      const before = snapshotDir(tmp)

      const transcoder = createSystemFfmpegTranscoder()
      await assertRejects(
        () => transcoder.extractThumbnail({ sourcePath }, { outputPath, atSeconds: 2 }),
        Error,
        'ffmpeg failed to extract a thumbnail',
      )

      assertEquals(await Deno.stat(outputPath).catch(() => null), null)
      const after = snapshotDir(tmp)
      const leftover = [...after].filter((name) => !before.has(name))
      assertEquals(
        leftover.filter((name) =>
          name.endsWith('.jpg') || name.endsWith('.png') || name.endsWith('.webp')
        ),
        [],
        `expected no leftover temp thumbnail file in ${tmp}, found: ${leftover.join(', ')}`,
      )
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
})
