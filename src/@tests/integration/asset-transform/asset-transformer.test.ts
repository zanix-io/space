import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { createAssetTransformer } from 'modules/asset-transform/asset-transformer.ts'
import { probeFfmpegAvailability } from 'modules/media/ffmpeg-availability.ts'

/**
 * Real `sharp` + real system `ffmpeg`/`ffprobe` — no fakes anywhere in this file. Same
 * `ignore`-when-unavailable gating every sibling integration suite in this repo already uses (see
 * `src/@tests/integration/media/cached-video-transcoder.test.ts`). Every import in this file comes
 * from `modules/asset-transform/asset-transformer.ts` directly — never `modules/bundler/*` — a
 * live, executable proof that image/video/thumbnail/audio transformation genuinely works with zero
 * build-tool involvement, on top of `dependency-boundary.test.ts`'s own static graph check.
 */
const availability = await probeFfmpegAvailability()
const ignore = !availability.available

async function tempDir(prefix: string): Promise<string> {
  return await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url), prefix })
}

async function run(args: string[]): Promise<{ success: boolean; stderr: string }> {
  const { success, stderr } = await new Deno.Command('ffmpeg', { args, stderr: 'piped' }).output()
  return { success, stderr: new TextDecoder().decode(stderr) }
}

async function generateFixtureVideo(path: string, durationSeconds = 2): Promise<void> {
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

/** A real, decodable `.wav` — `isVoiceSource` (`modules/media/audio/policies/voice.ts`) only ever
 * accepts `.wav`, so this is the one source extension `transformAudio({profile:'voice'})` actually
 * transcodes. A real tone (never silence) so a real, non-trivial encode genuinely happens — silence
 * would risk collapsing to a degenerate case that says nothing about a live encode. */
async function generateFixtureAudio(path: string, durationSeconds = 2): Promise<void> {
  const { success, stderr } = await run([
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
  ])
  assert(success, `fixture generation failed: ${stderr}`)
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** PNG spec Appendix D's CRC32 (used to checksum every chunk's type+data), built once and reused —
 * poly 0xedb88320, reflected in/out, table-driven for a real (not approximated) checksum. */
const CRC32_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** zlib's own Adler32 (RFC 1950 §9), required as the trailing checksum of the IDAT payload. */
function adler32(bytes: Uint8Array): number {
  const MOD_ADLER = 65521
  let a = 1
  let b = 0
  for (const byte of bytes) {
    a = (a + byte) % MOD_ADLER
    b = (b + a) % MOD_ADLER
  }
  return ((b << 16) | a) >>> 0
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function u32be(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ])
}

/** Assembles one length-prefixed, CRC-terminated PNG chunk (PNG spec §5.3) — the real CRC32 of
 * `type + data`, never a hand-typed constant. */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const body = concatBytes([typeBytes, data])
  return concatBytes([u32be(data.length), body, u32be(crc32(body))])
}

/** Wraps `raw` in a genuinely valid zlib stream (RFC 1950) using a single uncompressed "stored"
 * DEFLATE block (RFC 1951 §3.2.4) — no compression math needed, just a correctly-shaped container,
 * which is all `optimizeImageAsset`'s real `sharp` call needs to decode a real source image. */
function zlibStore(raw: Uint8Array): Uint8Array {
  if (raw.length > 0xffff) {
    throw new Error('zlibStore: stored block only supports up to 65535 bytes')
  }
  const len = raw.length
  const nlen = ~len & 0xffff
  const deflateStoredBlock = concatBytes([
    new Uint8Array([0x01]), // BFINAL=1, BTYPE=00 (no compression), byte-aligned
    new Uint8Array([len & 0xff, (len >>> 8) & 0xff]),
    new Uint8Array([nlen & 0xff, (nlen >>> 8) & 0xff]),
    raw,
  ])
  const zlibHeader = new Uint8Array([0x78, 0x9c]) // CMF=deflate/32K window, FLG checksum-valid
  return concatBytes([zlibHeader, deflateStoredBlock, u32be(adler32(raw))])
}

/** A minimal, real, decodable PNG — a real `sharp`-eligible source, never a fixture that would
 * force `optimizeImageAsset`'s own "unsupported format -> pass through untouched" branch.
 *
 * Built programmatically (real CRC32/Adler32 checksums, a spec-valid uncompressed zlib block)
 * rather than hand-typed IDAT bytes: the previous hand-crafted stream had both a wrong IDAT length
 * field and a truncated/invalid DEFLATE payload — libvips 1.2.4's libpng silently tolerated it, but
 * libvips 1.3.2 (bundled by `sharp` 0.35+) correctly rejects it as unreadable. */
function tinyPngFixture(): Uint8Array {
  const width = 4
  const height = 4
  const colorType = 2 // truecolor RGB
  const bitDepth = 8

  // One filter byte (0 = None) + 3 RGB bytes per pixel, per scanline — a real, non-solid pattern.
  const raw = new Uint8Array(height * (1 + width * 3))
  let offset = 0
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0
    for (let x = 0; x < width; x++) {
      raw[offset++] = (x * 60) % 256
      raw[offset++] = (y * 60) % 256
      raw[offset++] = 128
    }
  }

  const ihdrData = concatBytes([
    u32be(width),
    u32be(height),
    new Uint8Array([bitDepth, colorType, 0, 0, 0]), // compression/filter/interlace = 0
  ])

  return concatBytes([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdrData),
    pngChunk('IDAT', zlibStore(raw)),
    pngChunk('IEND', new Uint8Array(0)),
  ])
}

async function snapshotCacheBlobMtimes(cacheDir: string): Promise<Map<string, number>> {
  const snapshot = new Map<string, number>()
  for await (const entry of Deno.readDir(cacheDir)) {
    if (entry.name === 'index.json') continue
    const stat = await Deno.stat(join(cacheDir, entry.name))
    snapshot.set(entry.name, stat.mtime?.getTime() ?? 0)
  }
  return snapshot
}

Deno.test(
  'transformImage: real sharp — a second identical request never re-runs sharp (cache blob mtimes untouched)',
  async () => {
    const dir = await tempDir('real-asset-transformer-image-')
    try {
      const cacheDir = join(dir, 'cache')
      const transformer = createAssetTransformer({ cacheDir })
      const source = tinyPngFixture()

      const first = await transformer.transformImage('pixel.png', source, {
        breakpoints: ['msm'],
      })
      const firstMtimes = await snapshotCacheBlobMtimes(cacheDir)
      assert(firstMtimes.size > 0, 'expected at least one real cached output blob')

      const second = await transformer.transformImage('pixel.png', source, {
        breakpoints: ['msm'],
      })
      const secondMtimes = await snapshotCacheBlobMtimes(cacheDir)

      assertEquals(
        second.map((entry) => entry.relativePath).sort(),
        first.map((entry) => entry.relativePath).sort(),
        'a repeat request must produce the exact same set of outputs',
      )
      assertEquals(
        [...secondMtimes.entries()],
        [...firstMtimes.entries()],
        'zero new sharp work means zero cache blobs re-written — mtimes must be identical',
      )
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test({
  name:
    'transformVideo + transformThumbnail: real ffmpeg — share ONE cacheDir with no collision, ' +
    'a second identical request for either never re-runs ffmpeg',
  ignore,
  async fn() {
    const dir = await tempDir('real-asset-transformer-video-')
    try {
      const cacheDir = join(dir, 'cache')
      const sourcePath = join(dir, 'source.mp4')
      await generateFixtureVideo(sourcePath, 2)

      const transformer = createAssetTransformer({ cacheDir })

      const videoOut1 = join(dir, 'out1.mp4')
      const videoOut2 = join(dir, 'out2.mp4')
      await transformer.transformVideo(
        { sourcePath },
        { breakpoint: 'msm', outputPath: videoOut1 },
      )
      const afterVideoMtimes = await snapshotCacheBlobMtimes(cacheDir)
      assert(afterVideoMtimes.size > 0, 'expected at least one real cached video blob')

      const thumbOut1 = join(dir, 'thumb1.jpg')
      const thumbOut2 = join(dir, 'thumb2.jpg')
      await transformer.transformThumbnail({ sourcePath }, { outputPath: thumbOut1 })
      const afterThumbnailMtimes = await snapshotCacheBlobMtimes(cacheDir)
      assert(
        afterThumbnailMtimes.size > afterVideoMtimes.size,
        'expected a NEW cache blob for the thumbnail, independent of the video transcode entry',
      )

      // Repeat both, at fresh output paths — cache hits, zero new blobs written for either.
      await transformer.transformVideo(
        { sourcePath },
        { breakpoint: 'msm', outputPath: videoOut2 },
      )
      await transformer.transformThumbnail({ sourcePath }, { outputPath: thumbOut2 })
      const finalMtimes = await snapshotCacheBlobMtimes(cacheDir)

      assertEquals(
        [...finalMtimes.entries()],
        [...afterThumbnailMtimes.entries()],
        'repeat video/thumbnail requests must reuse the cache — zero new ffmpeg invocations',
      )
      assertEquals(await Deno.readFile(videoOut2), await Deno.readFile(videoOut1))
      assertEquals(await Deno.readFile(thumbOut2), await Deno.readFile(thumbOut1))
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
})

Deno.test({
  name: 'transformAudio: real ffmpeg — a second identical request never re-runs ffmpeg, and ' +
    'shares ONE cacheDir with video/thumbnail with no collision across all three kinds',
  ignore,
  async fn() {
    const dir = await tempDir('real-asset-transformer-audio-')
    try {
      const cacheDir = join(dir, 'cache')
      const videoSourcePath = join(dir, 'source.mp4')
      const audioSourcePath = join(dir, 'source.wav')
      await generateFixtureVideo(videoSourcePath, 2)
      await generateFixtureAudio(audioSourcePath, 2)

      const transformer = createAssetTransformer({ cacheDir })

      // Video + thumbnail first, establishing the two kinds audio must never collide with.
      await transformer.transformVideo(
        { sourcePath: videoSourcePath },
        { breakpoint: 'msm', outputPath: join(dir, 'video.mp4') },
      )
      await transformer.transformThumbnail(
        { sourcePath: videoSourcePath },
        { outputPath: join(dir, 'thumb.jpg') },
      )
      const beforeAudioMtimes = await snapshotCacheBlobMtimes(cacheDir)
      assert(beforeAudioMtimes.size > 0, 'expected real cached video + thumbnail blobs already')

      const audioOut1 = join(dir, 'out1.m4a')
      const audioOut2 = join(dir, 'out2.m4a')
      const first = await transformer.transformAudio(
        { sourcePath: audioSourcePath },
        { profile: 'voice', format: 'aac', outputPath: audioOut1 },
      )
      const afterAudioMtimes = await snapshotCacheBlobMtimes(cacheDir)
      assert(
        afterAudioMtimes.size > beforeAudioMtimes.size,
        'expected a NEW cache blob for audio, independent of the video/thumbnail entries',
      )
      for (const [name, mtime] of beforeAudioMtimes) {
        assertEquals(
          afterAudioMtimes.get(name),
          mtime,
          `audio transcoding must never touch the pre-existing video/thumbnail blob "${name}"`,
        )
      }

      // A real fact learned via a real `ffprobe` call on the first transcode — never assumed.
      assertEquals(first.neverWorsened, false)
      assert(first.sampleRateHz && first.sampleRateHz > 0, 'expected a real sampleRateHz')

      // A second identical request, fresh outputPath — a real cache hit, zero new ffmpeg/ffprobe.
      const second = await transformer.transformAudio(
        { sourcePath: audioSourcePath },
        { profile: 'voice', format: 'aac', outputPath: audioOut2 },
      )
      const finalMtimes = await snapshotCacheBlobMtimes(cacheDir)

      assertEquals(
        [...finalMtimes.entries()],
        [...afterAudioMtimes.entries()],
        'a repeat audio request must reuse the cache — zero new ffmpeg/ffprobe invocations',
      )
      assertEquals(await Deno.readFile(audioOut2), await Deno.readFile(audioOut1))
      assertEquals(second.sampleRateHz, first.sampleRateHz, 'a cache hit replays the real metadata')
      assertEquals(second.channels, first.channels)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
})
