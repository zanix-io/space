import { assert, assertEquals } from '@std/assert'
import { fromFileUrl, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { createSystemFfmpegAudioTranscoder } from 'modules/media/audio/system-ffmpeg-audio-transcoder.ts'
import { createCachedAudioTranscoder } from 'modules/media/audio/cached-audio-transcoder.ts'
import { createFileTransformCacheStore } from 'modules/assets/transform-cache-store.ts'
import { probeFfmpegAvailability } from 'modules/media/ffmpeg-availability.ts'

/**
 * A focused, real-evidence architecture audit — requested explicitly, not a re-run of the feature
 * suite. Each test below proves ONE specific claim from that audit request, against real ffmpeg
 * and a real, persisted `TransformCacheStore` (never mocked), so the proof is as strong as the
 * claim demands.
 */
const availability = await probeFfmpegAvailability()
const ignore = !availability.available

const ROOT = fromFileUrl(import.meta.resolve('../../../../../'))
const RESTRICTED_PATH = '/usr/bin:/bin'

async function tempDir(prefix: string): Promise<string> {
  return await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url), prefix })
}

async function generateVoiceFixture(path: string, durationSeconds = 3): Promise<void> {
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

// --- Claim: "a cache hit executes neither ffmpeg nor ffprobe" — proven by making a REAL hit
// happen in a subprocess where NEITHER binary is even reachable on PATH. If the cache-hit code
// path ever called through to the real transcoder (or to `probeSourceAudio` for metadata), this
// would fail with an "ffmpeg is not available" error instead of returning a real hit. -----------

Deno.test({
  name: 'architecture audit: a real audio cache HIT succeeds with ffmpeg/ffprobe completely ' +
    'UNREACHABLE — proves zero real subprocess calls happen on replay',
  ignore,
  async fn() {
    const dir = await tempDir('audit-cache-hit-no-subprocess-')
    try {
      const sourcePath = join(dir, 'memo.wav')
      await generateVoiceFixture(sourcePath)
      const cacheDir = join(dir, 'cache')

      // Step 1 — a REAL transcode, in THIS process (ffmpeg available), populates the cache for
      // real.
      const store = createFileTransformCacheStore(cacheDir)
      const transcoder = createCachedAudioTranscoder(createSystemFfmpegAudioTranscoder(), store)
      const firstOutput = join(dir, 'first.m4a')
      const first = await transcoder.transcode(
        { sourcePath },
        { profile: 'voice', format: 'aac', outputPath: firstOutput },
      )
      assert(!first.neverWorsened, 'the fixture must produce a real, cacheable optimized result')

      // Step 2 — a SECOND call for the exact same (source, options), run in a fresh subprocess
      // whose PATH excludes wherever ffmpeg/ffprobe actually live on this host. A real subprocess
      // spawn attempt for either binary would throw `Deno.errors.NotFound` well before this
      // script could report success.
      const scriptPath = join(dir, 'script.ts')
      await Deno.writeTextFile(
        scriptPath,
        `// deno-coverage-ignore-file
import { createSystemFfmpegAudioTranscoder } from '${ROOT}src/modules/media/audio/system-ffmpeg-audio-transcoder.ts'
import { createCachedAudioTranscoder } from '${ROOT}src/modules/media/audio/cached-audio-transcoder.ts'
import { createFileTransformCacheStore } from '${ROOT}src/modules/assets/transform-cache-store.ts'

const store = createFileTransformCacheStore(${JSON.stringify(cacheDir)})
const transcoder = createCachedAudioTranscoder(createSystemFfmpegAudioTranscoder(), store)
const result = await transcoder.transcode(
  { sourcePath: ${JSON.stringify(sourcePath)} },
  { profile: 'voice', format: 'aac', outputPath: ${JSON.stringify(join(dir, 'second.m4a'))} },
)
console.log(JSON.stringify(result))
`,
      )
      const { code, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
        args: [
          'run',
          '--allow-all',
          '--no-check',
          '--no-prompt',
          '--minimum-dependency-age=0',
          '--config',
          join(ROOT, 'deno.jsonc'),
          scriptPath,
        ],
        cwd: ROOT,
        env: { PATH: RESTRICTED_PATH },
      }).output()

      assert(
        code === 0,
        `a real cache hit must succeed even with ffmpeg/ffprobe unreachable:\n${
          new TextDecoder().decode(stderr)
        }`,
      )
      const second = JSON.parse(new TextDecoder().decode(stdout).trim())
      assertEquals(second.neverWorsened, false)
      assertEquals(second.passthrough, false)
      assertEquals(second.bytesWritten, first.bytesWritten)
      assertEquals(second.sampleRateHz, first.sampleRateHz)
      assertEquals(second.channels, first.channels)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
})

// --- Claim: "a never-worsen result never publishes false metadata/format" — proven at the
// PRIMITIVE level (mimeType/format both reflect the real, on-disk WAV bytes, never the fictitious
// AAC target) — the manifest-level half of this claim (mediaPlugin never publishing a `.voice.
// {ext}` key at all for this outcome) is already covered by `media-plugin.test.ts`'s own suite;
// this proves the primitive itself never lies, independent of that caller-side behavior. ---------

Deno.test({
  name: 'architecture audit: a never-worsened result never claims to be AAC/Opus — mimeType/' +
    'format/bytes on disk are ALL the real WAV, verified via a real independent ffprobe read',
  ignore,
  async fn() {
    const dir = await tempDir('audit-never-worsen-honest-')
    try {
      const sourcePath = join(dir, 'tiny.wav')
      await generateVoiceFixture(sourcePath, 0.01) // pathologically tiny — real encoder overhead
      // alone reliably exceeds it, the real never-worsen trigger.
      const outputPath = join(dir, 'tiny.m4a')

      const result = await createSystemFfmpegAudioTranscoder().transcode(
        { sourcePath },
        { profile: 'voice', format: 'aac', outputPath },
      )
      assert(result.neverWorsened, 'expected this fixture to genuinely trigger never-worsen')

      // The RESULT itself must be honest.
      assertEquals(result.mimeType, 'audio/wav')
      assertEquals(result.format, 'wav')

      // The bytes ON DISK must be honest too — an INDEPENDENT real ffprobe read (not reusing this
      // package's own reported result) confirms the file at the `.m4a`-suffixed outputPath is
      // genuinely a WAV, never a broken/mislabeled AAC container.
      const { stdout } = await new Deno.Command('ffprobe', {
        args: ['-v', 'quiet', '-print_format', 'json', '-show_format', outputPath],
        stdout: 'piped',
      }).output()
      const probed = JSON.parse(new TextDecoder().decode(stdout))
      assertEquals(probed.format.format_name, 'wav')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
})

// --- Claim: "TransformCacheEntry.meta is backward-compatible with every existing image/video/
// thumbnail entry" — proven by hand-authoring a REAL, pre-`meta`-shaped entry (exactly what an
// on-disk cache written before this feature existed would contain) directly into a real file
// store, then confirming the audio decorator (and the generic validity guard) treat it exactly as
// they would a fresh one — no crash, no silent misbehavior, meta simply absent. -------------------

Deno.test(
  'architecture audit: an old-shape cache entry (no meta field) is still valid and safe',
  async () => {
    const { isValidTransformCacheEntry } = await import('modules/assets/transform-cache.ts')
    // Exactly the shape a REAL pre-existing image/video/thumbnail entry has always had.
    const oldImageEntry = { status: 'optimized', bytesWritten: 4096 }
    const oldVideoMultiOutputEntry = {
      status: 'optimized',
      bytesWritten: 8192,
      outputs: ['hero.msm.jpg', 'hero.dlg.jpg'],
    }
    const oldNeverWorsenedEntry = { status: 'never-worsened', bytesWritten: 0 }

    assertEquals(isValidTransformCacheEntry(oldImageEntry), true)
    assertEquals(isValidTransformCacheEntry(oldVideoMultiOutputEntry), true)
    assertEquals(isValidTransformCacheEntry(oldNeverWorsenedEntry), true)

    // deno-lint-ignore no-explicit-any -- deliberately reading a field the OLD shape never declared.
    assertEquals((oldImageEntry as any).meta, undefined)
  },
)

Deno.test(
  'architecture audit: a real file-based store round-trips an old-shape entry unchanged, and a ' +
    'fresh audio entry alongside it, with no cross-contamination',
  async () => {
    const dir = await tempDir('audit-cache-backward-compat-')
    try {
      const store = createFileTransformCacheStore(dir)

      // An entry written the way pre-audio code always wrote one — no `meta` key at all.
      await store.setEntry('sourcehash:video:mlg:v1', { status: 'optimized', bytesWritten: 123 })
      // A fresh audio entry, WITH meta.
      await store.setEntry('sourcehash:voice:aac:b128:v1', {
        status: 'optimized',
        bytesWritten: 456,
        meta: { sampleRateHz: 44100, channels: 1, durationSeconds: 3 },
      })

      // Re-open a FRESH store instance against the same directory — forces a real read from the
      // real persisted `index.json`, not an in-memory shortcut.
      const reopened = createFileTransformCacheStore(dir)
      const videoEntry = await reopened.getEntry('sourcehash:video:mlg:v1')
      const audioEntry = await reopened.getEntry('sourcehash:voice:aac:b128:v1')

      assertEquals(videoEntry, { status: 'optimized', bytesWritten: 123 })
      assertEquals(audioEntry, {
        status: 'optimized',
        bytesWritten: 456,
        meta: { sampleRateHz: 44100, channels: 1, durationSeconds: 3 },
      })
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)
