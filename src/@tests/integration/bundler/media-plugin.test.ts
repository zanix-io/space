import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { buildSpaceClient } from 'modules/bundler/build-client.ts'
import { probeFfmpegAvailability } from 'modules/media/ffmpeg-availability.ts'
import {
  resetAssetsDirConfig,
  resetMediaConfig,
  resetOptimizeConfig,
  setAssetsDirConfig,
  setMediaConfig,
} from 'modules/assets/asset-registry.ts'

/**
 * End-to-end: `znx space build` -> `buildSpaceClient` -> `mediaPlugin` -> transform cache ->
 * `VideoTranscoder` -> real `ffmpeg`/`ffprobe` -> video variants + thumbnails -> manifest. Same
 * `ignore`-when-unavailable gating every sibling media integration suite already uses — this dev
 * machine has real ffmpeg installed, so these run for real here.
 */
const availability = await probeFfmpegAvailability()
const ignore = !availability.available

const TMP_ROOT = getTemporaryFolder(import.meta.url)

async function withTempDir(run: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    await run(root)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

async function generateFixtureVideo(path: string, durationSeconds = 2): Promise<void> {
  const { success, stderr } = await new Deno.Command('ffmpeg', {
    args: [
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
    ],
    stderr: 'piped',
  }).output()
  assert(success, `fixture generation failed: ${new TextDecoder().decode(stderr)}`)
}

async function generateFixtureVoice(path: string, durationSeconds = 3): Promise<void> {
  const { success, stderr } = await new Deno.Command('ffmpeg', {
    args: [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:sample_rate=44100:duration=${durationSeconds}`,
      '-ac',
      '1',
      path,
    ],
    stderr: 'piped',
  }).output()
  assert(success, `voice fixture generation failed: ${new TextDecoder().decode(stderr)}`)
}

async function generateFixtureMp3(path: string, durationSeconds = 1): Promise<void> {
  const { success, stderr } = await new Deno.Command('ffmpeg', {
    args: [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:sample_rate=44100:duration=${durationSeconds}`,
      '-c:a',
      'libmp3lame',
      path,
    ],
    stderr: 'piped',
  }).output()
  assert(success, `mp3 fixture generation failed: ${new TextDecoder().decode(stderr)}`)
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

Deno.test({
  name: "buildSpaceClient: with media omitted, defaults to getMediaConfig() — a single app's own " +
    'defineSpaceApp({ assetsDir, media }) reaches the production build with no explicit option, ' +
    'real video breakpoints + thumbnail produced, manifest reflects every real output',
  ignore,
  async fn() {
    await withTempDir(async (root) => {
      const assetsDir = join(root, 'assets-src')
      const cacheDir = join(root, 'transform-cache')
      await Deno.mkdir(assetsDir, { recursive: true })
      await generateFixtureVideo(join(assetsDir, 'clip.mp4'), 3)
      try {
        // Stands in for a single defineSpaceApp({ assetsDir, media }) call having already run —
        // exactly what `zanix space build` (via `importSpaceApp`) triggers before ever calling
        // `buildSpaceClient`, with NO explicit option threaded through by the CLI itself.
        setAssetsDirConfig(assetsDir)
        setMediaConfig({
          video: { breakpoints: ['msm'] },
          thumbnails: { atSeconds: 1, width: 240, formats: ['jpeg'] },
          cacheDir,
        })

        const result = await buildSpaceClient({ root, css: { tailwind: false } })

        const manifest: Record<string, string> = JSON.parse(
          await Deno.readTextFile(join(result.outDir, 'assets-manifest.json')),
        )
        assert('clip.mp4' in manifest, JSON.stringify(manifest))
        assert(
          /clip\.msm-[\w-]+\.mp4$/.test(manifest['clip.msm.mp4'] ?? ''),
          JSON.stringify(manifest),
        )
        assert(
          /clip\.thumb-[\w-]+\.jpg$/.test(manifest['clip.thumb.jpg'] ?? ''),
          JSON.stringify(manifest),
        )

        // The transform cache was REALLY used, from the official path — not a bypass.
        const cacheEntries: string[] = []
        for await (const entry of Deno.readDir(cacheDir)) cacheEntries.push(entry.name)
        assert(cacheEntries.includes('index.json'), 'expected a real persisted cache index')
        assert(cacheEntries.length > 1, 'expected at least one real cached output blob')
      } finally {
        resetAssetsDirConfig()
        resetMediaConfig()
      }
    })
  },
})

Deno.test({
  name:
    'buildSpaceClient: media.cacheDir survives a SECOND real znx-space-build-equivalent run — ' +
    'zero new real ffmpeg invocations (cache blob mtimes untouched), byte-identical manifest output',
  ignore,
  async fn() {
    await withTempDir(async (root) => {
      const assetsDir = join(root, 'assets-src')
      const cacheDir = join(root, 'transform-cache')
      await Deno.mkdir(assetsDir, { recursive: true })
      await generateFixtureVideo(join(assetsDir, 'clip.mp4'), 3)
      try {
        setAssetsDirConfig(assetsDir)
        setMediaConfig({
          video: { breakpoints: ['msm'] },
          thumbnails: { formats: ['jpeg'] },
          cacheDir,
        })

        const first = await buildSpaceClient({ root, css: { tailwind: false } })
        const firstManifest: Record<string, string> = JSON.parse(
          await Deno.readTextFile(join(first.outDir, 'assets-manifest.json')),
        )
        const firstBlobMtimes = await snapshotCacheBlobMtimes(cacheDir)
        assert(firstBlobMtimes.size > 0, 'expected real cache blobs after the first build')

        // A SECOND build, same source/options/cacheDir. `outDir` is emptied by Vite each build
        // (`emptyOutDir: true`), so a byte-identical manifest here can ONLY come from the cache,
        // never a leftover file.
        const second = await buildSpaceClient({ root, css: { tailwind: false } })
        const secondManifest: Record<string, string> = JSON.parse(
          await Deno.readTextFile(join(second.outDir, 'assets-manifest.json')),
        )
        assertEquals(
          secondManifest,
          firstManifest,
          'a repeat build must reuse the exact same cached output',
        )

        // The real, load-bearing idempotency proof: `setBytes`/`setEntry` ALWAYS re-touch a blob's
        // mtime, even when writing byte-identical content — so an UNCHANGED mtime after the second
        // build is direct, real evidence ffmpeg was never asked to re-run for this source.
        const secondBlobMtimes = await snapshotCacheBlobMtimes(cacheDir)
        assertEquals(
          [...secondBlobMtimes.entries()],
          [...firstBlobMtimes.entries()],
          'zero new ffmpeg invocations means zero cache blobs re-written — mtimes must be identical',
        )
      } finally {
        resetAssetsDirConfig()
        resetMediaConfig()
      }
    })
  },
})

Deno.test({
  name:
    'buildSpaceClient: assetsPlugin (images) + mediaPlugin (video) both configured together -> ' +
    'ONE shared assets-manifest.json with entries from both, no collision',
  ignore,
  async fn() {
    await withTempDir(async (root) => {
      const assetsDir = join(root, 'assets-src')
      await Deno.mkdir(assetsDir, { recursive: true })
      await Deno.writeFile(join(assetsDir, 'logo.svg'), new TextEncoder().encode('<svg>x</svg>'))
      await generateFixtureVideo(join(assetsDir, 'clip.mp4'), 2)
      try {
        setAssetsDirConfig(assetsDir)
        setMediaConfig({ thumbnails: { formats: ['jpeg'] } })

        const result = await buildSpaceClient({ root, css: { tailwind: false } })
        const manifest: Record<string, string> = JSON.parse(
          await Deno.readTextFile(join(result.outDir, 'assets-manifest.json')),
        )

        assert('logo.svg' in manifest, "expected assetsPlugin's own entry in the shared manifest")
        assert('clip.mp4' in manifest, "expected mediaPlugin's own entry in the shared manifest")
        assert(
          /clip\.thumb-[\w-]+\.jpg$/.test(manifest['clip.thumb.jpg'] ?? ''),
          JSON.stringify(manifest),
        )
      } finally {
        resetAssetsDirConfig()
        resetOptimizeConfig()
        resetMediaConfig()
      }
    })
  },
})

Deno.test({
  name: 'buildSpaceClient: with media omitted (assetsDir alone), the video file is hashed and ' +
    'copied untouched — no video-specific behavior fires without an explicit opt-in',
  ignore,
  async fn() {
    await withTempDir(async (root) => {
      const assetsDir = join(root, 'assets-src')
      await Deno.mkdir(assetsDir, { recursive: true })
      await generateFixtureVideo(join(assetsDir, 'clip.mp4'), 1)
      const sourceBytes = await Deno.readFile(join(assetsDir, 'clip.mp4'))
      try {
        setAssetsDirConfig(assetsDir)

        const result = await buildSpaceClient({ root, css: { tailwind: false } })
        const manifest: Record<string, string> = JSON.parse(
          await Deno.readTextFile(join(result.outDir, 'assets-manifest.json')),
        )
        const clipKeys = Object.keys(manifest).filter((key) => key.startsWith('clip'))
        assertEquals(
          clipKeys,
          ['clip.mp4'],
          'no variants/thumbnails without an explicit media option',
        )

        const clipPath = join(result.outDir, manifest['clip.mp4'].replace(/^\//, ''))
        assertEquals(
          new Uint8Array(await Deno.readFile(clipPath)),
          new Uint8Array(sourceBytes),
          'must be the exact original bytes',
        )
      } finally {
        resetAssetsDirConfig()
      }
    })
  },
})

// --- Voice audio: znx space build -> mediaPlugin -> AssetTransformer.transformAudio -> cached
// audio transcoder -> real ffmpeg -> AAC/Opus -> shared AssetManifestRegistry -> assets-manifest.
// json. Same real-ffmpeg, `ignore`-when-unavailable gating as every test above. ------------------

Deno.test({
  name: 'buildSpaceClient: media.audio.voice configured — a real .wav in assetsDir gets real ' +
    'AAC/Opus voice variants via the official build path, manifest correct, cache populated',
  ignore,
  async fn() {
    await withTempDir(async (root) => {
      const assetsDir = join(root, 'assets-src')
      const cacheDir = join(root, 'transform-cache')
      await Deno.mkdir(assetsDir, { recursive: true })
      await generateFixtureVoice(join(assetsDir, 'memo.wav'))
      try {
        setAssetsDirConfig(assetsDir)
        setMediaConfig({
          audio: { voice: { formats: ['aac', 'opus'] } },
          cacheDir,
        })

        const result = await buildSpaceClient({ root, css: { tailwind: false } })

        const manifest: Record<string, string> = JSON.parse(
          await Deno.readTextFile(join(result.outDir, 'assets-manifest.json')),
        )
        assert('memo.wav' in manifest, JSON.stringify(manifest))
        assert(
          /memo\.voice-[\w-]+\.m4a$/.test(manifest['memo.voice.m4a'] ?? ''),
          JSON.stringify(manifest),
        )
        assert(
          /memo\.voice-[\w-]+\.opus$/.test(manifest['memo.voice.opus'] ?? ''),
          JSON.stringify(manifest),
        )

        // The transform cache was REALLY used, from the official path — not a bypass.
        const cacheEntries: string[] = []
        for await (const entry of Deno.readDir(cacheDir)) cacheEntries.push(entry.name)
        assert(cacheEntries.includes('index.json'), 'expected a real persisted cache index')
        assert(cacheEntries.length > 1, 'expected at least one real cached output blob')
      } finally {
        resetAssetsDirConfig()
        resetMediaConfig()
      }
    })
  },
})

Deno.test({
  name: 'buildSpaceClient: media.audio.voice.cacheDir survives a SECOND real build — zero new ' +
    'real ffmpeg invocations (cache blob mtimes untouched), byte-identical manifest output',
  ignore,
  async fn() {
    await withTempDir(async (root) => {
      const assetsDir = join(root, 'assets-src')
      const cacheDir = join(root, 'transform-cache')
      await Deno.mkdir(assetsDir, { recursive: true })
      await generateFixtureVoice(join(assetsDir, 'memo.wav'))
      try {
        setAssetsDirConfig(assetsDir)
        setMediaConfig({ audio: { voice: { formats: ['aac'] } }, cacheDir })

        const first = await buildSpaceClient({ root, css: { tailwind: false } })
        const firstManifest: Record<string, string> = JSON.parse(
          await Deno.readTextFile(join(first.outDir, 'assets-manifest.json')),
        )
        const firstBlobMtimes = await snapshotCacheBlobMtimes(cacheDir)
        assert(firstBlobMtimes.size > 0, 'expected real cache blobs after the first build')

        const second = await buildSpaceClient({ root, css: { tailwind: false } })
        const secondManifest: Record<string, string> = JSON.parse(
          await Deno.readTextFile(join(second.outDir, 'assets-manifest.json')),
        )
        assertEquals(
          secondManifest,
          firstManifest,
          'a repeat build must reuse the exact same cached output',
        )

        const secondBlobMtimes = await snapshotCacheBlobMtimes(cacheDir)
        assertEquals(
          [...secondBlobMtimes.entries()],
          [...firstBlobMtimes.entries()],
          'zero new ffmpeg invocations means zero cache blobs re-written — mtimes must be identical',
        )
      } finally {
        resetAssetsDirConfig()
        resetMediaConfig()
      }
    })
  },
})

Deno.test({
  name: 'buildSpaceClient: image + video + voice audio all configured together -> ONE shared ' +
    'assets-manifest.json with entries from all three, no collision',
  ignore,
  async fn() {
    await withTempDir(async (root) => {
      const assetsDir = join(root, 'assets-src')
      await Deno.mkdir(assetsDir, { recursive: true })
      await Deno.writeFile(join(assetsDir, 'logo.svg'), new TextEncoder().encode('<svg>x</svg>'))
      await generateFixtureVideo(join(assetsDir, 'clip.mp4'), 2)
      await generateFixtureVoice(join(assetsDir, 'memo.wav'))
      try {
        setAssetsDirConfig(assetsDir)
        setMediaConfig({
          thumbnails: { formats: ['jpeg'] },
          audio: { voice: { formats: ['aac'] } },
        })

        const result = await buildSpaceClient({ root, css: { tailwind: false } })
        const manifest: Record<string, string> = JSON.parse(
          await Deno.readTextFile(join(result.outDir, 'assets-manifest.json')),
        )

        assert('logo.svg' in manifest, "expected assetsPlugin's own entry in the shared manifest")
        assert('clip.mp4' in manifest, "expected mediaPlugin's video entry in the shared manifest")
        assert('memo.wav' in manifest, "expected mediaPlugin's audio entry in the shared manifest")
        assert(
          /clip\.thumb-[\w-]+\.jpg$/.test(manifest['clip.thumb.jpg'] ?? ''),
          JSON.stringify(manifest),
        )
        assert(
          /memo\.voice-[\w-]+\.m4a$/.test(manifest['memo.voice.m4a'] ?? ''),
          JSON.stringify(manifest),
        )
      } finally {
        resetAssetsDirConfig()
        resetOptimizeConfig()
        resetMediaConfig()
      }
    })
  },
})

Deno.test({
  name: 'buildSpaceClient: with media.audio omitted, a .wav is hashed and copied untouched — no ' +
    'audio-specific behavior fires without an explicit opt-in, existing .wav/.mp3 assets unaffected',
  ignore,
  async fn() {
    await withTempDir(async (root) => {
      const assetsDir = join(root, 'assets-src')
      await Deno.mkdir(assetsDir, { recursive: true })
      await generateFixtureVoice(join(assetsDir, 'memo.wav'), 1)
      const sourceBytes = await Deno.readFile(join(assetsDir, 'memo.wav'))
      try {
        setAssetsDirConfig(assetsDir)
        setMediaConfig({ video: { breakpoints: ['msm'] } }) // media configured, but NOT audio

        const result = await buildSpaceClient({ root, css: { tailwind: false } })
        const manifest: Record<string, string> = JSON.parse(
          await Deno.readTextFile(join(result.outDir, 'assets-manifest.json')),
        )
        const memoKeys = Object.keys(manifest).filter((key) => key.startsWith('memo'))
        assertEquals(memoKeys, ['memo.wav'], 'no voice variant without an explicit audio option')

        const memoPath = join(result.outDir, manifest['memo.wav'].replace(/^\//, ''))
        assertEquals(
          new Uint8Array(await Deno.readFile(memoPath)),
          new Uint8Array(sourceBytes),
          'must be the exact original bytes',
        )
      } finally {
        resetAssetsDirConfig()
        resetMediaConfig()
      }
    })
  },
})

Deno.test({
  name: 'buildSpaceClient: a never-worsened voice encode is NEVER published under a .voice.m4a ' +
    'manifest key — the manifest never falsely announces AAC/Opus for a real, tiny WAV',
  ignore,
  async fn() {
    await withTempDir(async (root) => {
      const assetsDir = join(root, 'assets-src')
      await Deno.mkdir(assetsDir, { recursive: true })
      // Pathologically tiny — real AAC container overhead alone reliably exceeds it, the real
      // never-worsen trigger (never fabricated by mocking a size comparison).
      await generateFixtureVoice(join(assetsDir, 'tiny.wav'), 0.01)
      try {
        setAssetsDirConfig(assetsDir)
        setMediaConfig({ audio: { voice: { formats: ['aac'] } } })

        const result = await buildSpaceClient({ root, css: { tailwind: false } })
        const manifest: Record<string, string> = JSON.parse(
          await Deno.readTextFile(join(result.outDir, 'assets-manifest.json')),
        )

        assert('tiny.wav' in manifest, JSON.stringify(manifest))
        assert(
          !('tiny.voice.m4a' in manifest),
          `a never-worsened result must never be published as its own manifest entry: ${
            JSON.stringify(manifest)
          }`,
        )

        // The published original must be the real, unmodified WAV — never AAC bytes wearing a
        // .wav name.
        const wavPath = join(result.outDir, manifest['tiny.wav'].replace(/^\//, ''))
        const { stdout } = await new Deno.Command('ffprobe', {
          args: ['-v', 'quiet', '-print_format', 'json', '-show_format', wavPath],
          stdout: 'piped',
        }).output()
        const probed = JSON.parse(new TextDecoder().decode(stdout))
        assertEquals(probed.format.format_name, 'wav')
      } finally {
        resetAssetsDirConfig()
        resetMediaConfig()
      }
    })
  },
})

Deno.test({
  name: "buildSpaceClient: mediaPlugin's own early filter (isVoiceSource) keeps a .mp3 from " +
    'ever being SCANNED for voice optimization, even with audio.voice configured — a real, ' +
    'worthwhile optimization, verified alongside the transformer-level guardrail (a different ' +
    'test proves that one), NEVER the only barrier',
  ignore,
  async fn() {
    await withTempDir(async (root) => {
      const assetsDir = join(root, 'assets-src')
      await Deno.mkdir(assetsDir, { recursive: true })
      await generateFixtureVoice(join(assetsDir, 'memo.wav'))
      await generateFixtureMp3(join(assetsDir, 'preexisting.mp3'))
      const mp3SourceBytes = await Deno.readFile(join(assetsDir, 'preexisting.mp3'))
      try {
        setAssetsDirConfig(assetsDir)
        setMediaConfig({ audio: { voice: { formats: ['aac'] } } })

        // The build must succeed — mediaPlugin's own scan never even attempts to transform the
        // .mp3 (it's filtered out by `isVoiceSource` before `transformAudio` is ever called for
        // it), so there is nothing here for the transformer-level guardrail to reject.
        const result = await buildSpaceClient({ root, css: { tailwind: false } })
        const manifest: Record<string, string> = JSON.parse(
          await Deno.readTextFile(join(result.outDir, 'assets-manifest.json')),
        )

        // The .wav DID get its voice variant — audio.voice is genuinely active.
        assert(
          /memo\.voice-[\w-]+\.m4a$/.test(manifest['memo.voice.m4a'] ?? ''),
          JSON.stringify(manifest),
        )

        // The .mp3 was never even considered: no `.voice.` variant, hashed/copied untouched.
        const mp3Keys = Object.keys(manifest).filter((key) => key.startsWith('preexisting'))
        assertEquals(
          mp3Keys,
          ['preexisting.mp3'],
          "mediaPlugin's own scan must never even attempt to transform an already-lossy .mp3",
        )
        const mp3Path = join(result.outDir, manifest['preexisting.mp3'].replace(/^\//, ''))
        assertEquals(
          new Uint8Array(await Deno.readFile(mp3Path)),
          new Uint8Array(mp3SourceBytes),
          'must be the exact original .mp3 bytes — untouched',
        )
      } finally {
        resetAssetsDirConfig()
        resetMediaConfig()
      }
    })
  },
})
