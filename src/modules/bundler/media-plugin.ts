import type { Plugin } from 'vite'
import { scanAssets } from 'modules/assets/scan-assets.ts'
import { matchesInclude } from 'modules/assets/optimize-include.ts'
import { isVideoAsset } from 'modules/assets/content-type.ts'
import {
  type AssetManifestRegistry,
  createAssetManifestRegistry,
} from 'modules/assets/asset-manifest-registry.ts'
import { defaultFormatFor } from 'modules/media/system-ffmpeg-transcoder.ts'
import type { VideoBreakpointName } from 'modules/media/video-breakpoints.ts'
import { isVoiceSource, type VoiceAudioFormat } from 'modules/media/audio/policies/voice.ts'
import {
  type AssetTransformer,
  createAssetTransformer,
} from 'modules/asset-transform/asset-transformer.ts'

// `Plugin` is not re-exported here — same accepted `deno doc --lint` finding `assets-plugin.ts`'s
// own doc comment already establishes.

/**
 * `mediaPlugin`'s opt-in, build-time-only FFMPEG-backed optimization — video (`VideoTranscoder`)
 * breakpoint/format variants, thumbnails, and voice audio (`AudioTranscoder`), on top of the exact
 * same reusable pieces `system-ffmpeg-transcoder.ts`'s own doc always described as usable
 * "identically by `zanix space build`'s own future media plugin AND by something that has nothing
 * to do with a build at all — e.g. a future Asset API/background worker": `createCachedVideoTranscoder`/
 * `createCachedAudioTranscoder`, `createSystemFfmpegTranscoder`/`createSystemFfmpegAudioTranscoder`,
 * the calibrated `VIDEO_BREAKPOINT_PRESETS`/`policies/voice.ts`, and the SAME `TransformCacheStore`
 * machinery `assetsPlugin`'s own image optimizer already uses. This plugin is genuinely NEW code,
 * not a copy of `assetsPlugin` — video/audio's own contract (a real file path in, a real file path
 * out; a separate thumbnail axis with its own format list) is different enough that forcing it
 * through `assetsPlugin`'s own byte-in/byte-out shape would be the wrong kind of reuse. Audio was
 * added here rather than as a third, separate plugin for the same reason: it is FFMPEG-backed
 * exactly like video/thumbnail (never sharp-backed like images), so it shares this plugin's own
 * scan/transform/emit shape and its one `AssetTransformer`/cache instance — see this module's own
 * "audio.voice" doc below for the full contract. What's reused: `scanAssets` (asset discovery),
 * `matchesInclude` (the `include` glob filter), and — the one genuinely shared, extracted
 * abstraction — {@linkcode AssetManifestRegistry}, so this plugin's own outputs land in the exact
 * same `assets-manifest.json` `assetsPlugin` writes, with neither plugin ever importing or knowing
 * about the other.
 *
 * Off by default: omitting `optimize` entirely still hashes/copies every video file untouched,
 * exactly like any other unoptimized asset (no video-specific behavior fires at all without an
 * explicit opt-in) — mirrors `assetsPlugin`'s own "no optimize means no optimization" contract.
 *
 * **What "optimize" means here, precisely:**
 * - `video.breakpoints` — which of `VIDEO_BREAKPOINT_PRESETS`' own named presets (`msm`/`mlg`/
 *   `dmd`/`dlg`) to generate, as ADDITIVE variants next to the untouched original (never replacing
 *   it) — `hero.mp4` stays `hero.mp4`; `hero.msm.mp4` is a new, additional manifest entry.
 * - `video.formats` — which container(s) to produce PER breakpoint. Omitted: exactly one, matching
 *   the source's own container (`defaultFormatFor`, the SAME default `VideoTranscoder.transcode()`
 *   itself already applies when `format` is omitted — never re-derived independently here). An
 *   explicit list (e.g. `['mp4', 'webm']`) produces one real, independent transcode per format —
 *   this is the plugin EXPLICITLY requesting each one, never `VideoTranscoder` auto-generating
 *   multiple formats on its own (that responsibility was deliberately never added to the port
 *   itself — see `video-transcoder.ts`'s own doc).
 * - `thumbnails` — omitted: no thumbnail extracted at all. Given: extracts exactly one frame
 *   (`atSeconds`/`width`, same meaning as `ThumbnailOptions`) per requested `formats` entry
 *   (`jpeg`/`png`/`webp` — `webp` going through the SAME guaranteed-capability contract
 *   `extractThumbnail`'s own doc already establishes, never a silent fallback). Manifest key:
 *   `{base}.thumb.{extension}` — e.g. `hero.thumb.jpg`, `hero.thumb.webp`. This is the ONLY place
 *   a thumbnail is ever produced — `space-ui`'s own `Video` component only ever CONSUMES an
 *   already-resolved `poster` path (confirmed by that component's own audit); it never calls
 *   `VideoTranscoder`, never touches `ffmpeg`, and this plugin never touches React/Preact either.
 * - `audio.voice` — voice/speech-only audio optimization, real product-scoped policy (NOT a
 *   generic audio system) — see `modules/media/audio/policies/voice.ts`'s own doc for the full
 *   rationale. Omitted entirely: no audio file is even scanned/touched by this plugin — a real
 *   `.wav` in `assetsDir` stays exactly what it already is today, hashed and copied untouched by
 *   `assetsPlugin`'s own fallback (this is the explicit opt-in this plugin's own doc — and the
 *   product mandate behind voice audio — both require: no existing `.mp3`/`.wav` is ever silently
 *   recoded just because this plugin exists). Given: produces one real, additive AAC/Opus output
 *   PER requested `formats` entry (default `['aac']` — the universal-compatibility fallback) at a
 *   fixed `bitrateKbps` (default `VOICE_DEFAULT_BITRATE_KBPS`, 128). Manifest key:
 *   `{base}.voice.{extension}` — e.g. `memo.voice.m4a`, `memo.voice.opus` — mirrors
 *   `{base}.thumb.{extension}`'s own fixed-descriptor convention (no breakpoint dimension exists
 *   for audio). Only `.wav` sources are ever considered eligible (`isVoiceSource`) — an
 *   already-lossy-compressed audio file (`.mp3`, `.m4a`, `.opus`, ...) is conservatively left
 *   completely untouched, even when `audio.voice` is configured; re-encoding an already-compressed
 *   file risks real quality loss for uncertain byte savings, a trade-off this framework does not
 *   make automatically. `audio.include` scopes which audio files are considered — independent of
 *   this option's own top-level `include` (which scopes video only).
 * - `include`/`cacheDir` — same meaning/contract as `AssetsOptimizeOptions`'s own fields, scoped to
 *   VIDEO only (see `audio.include` above for audio's own, separate scope): `include` scopes which
 *   relative paths are even considered (an asset outside it, or whose extension isn't a recognized
 *   video format at all, is always left completely untouched); `cacheDir` persists results across
 *   builds via the SAME `TransformCacheStore` shape `cachedImageOptimizer` already uses —
 *   `sha256(source) + transformId + policyVersion` identity, an unchanged source re-optimized with
 *   the exact same options never invokes real `ffmpeg` again. ONE shared directory backs
 *   `transcode()`'s, `extractThumbnail()`'s, AND voice `transformAudio()`'s own entries (each
 *   already keyed under its own independently-versioned policy — see `cached-video-transcoder.ts`'s
 *   and `cached-audio-transcoder.ts`'s own docs — so nothing here needs its own extra namespacing;
 *   no separate `AudioCache` was created).
 *
 * In dev, this plugin does nothing (`apply: 'build'`) — `assetsDir`'s own route already reads
 * straight from the live source directory with zero build step involved, same reasoning
 * `assetsPlugin`'s own doc gives for why it's inert in dev too.
 *
 * @param options - See {@linkcode MediaPluginOptions}.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from 'vite'
 * import { spacePlugin, assetsPlugin, mediaPlugin, createAssetManifestRegistry } from '@zanix/space/vite'
 *
 * const manifestRegistry = createAssetManifestRegistry()
 * export default defineConfig({
 *   plugins: [
 *     ...spacePlugin(),
 *     ...assetsPlugin({ assetsDir: './assets', optimize: { images: true }, manifestRegistry }),
 *     ...mediaPlugin({
 *       assetsDir: './assets',
 *       optimize: {
 *         video: { breakpoints: ['msm', 'dlg'], formats: ['mp4', 'webm'] },
 *         thumbnails: { formats: ['jpeg', 'webp'] },
 *         audio: { voice: { formats: ['aac', 'opus'] } },
 *       },
 *       manifestRegistry,
 *     }),
 *     manifestRegistry.createManifestPlugin(),
 *   ],
 * })
 * ```
 */
export interface MediaOptimizeOptions {
  /** Video breakpoint/format variants — see this module's own doc for the exact contract.
   * Omitted: no variants of any kind, only the untouched original is hashed. */
  video?: {
    /** Which named presets to generate. Omitted/empty: no video transcoding at all. */
    breakpoints?: VideoBreakpointName[]
    /** Which containers to produce PER breakpoint. Omitted: exactly one, matching the source's
     * own container (see this module's own doc on `defaultFormatFor`). */
    formats?: ('mp4' | 'webm')[]
  }
  /** Thumbnail extraction policy — see this module's own doc for the exact contract. Omitted: no
   * thumbnail is ever produced. */
  thumbnails?: {
    /** Same meaning as `ThumbnailOptions.atSeconds` — default `1`. */
    atSeconds?: number
    /** Same meaning as `ThumbnailOptions.width` — omitted keeps the source frame's own real
     * width. */
    width?: number
    /** Which image format(s) to extract. Omitted: `['jpeg']`. */
    formats?: ('jpeg' | 'png' | 'webp')[]
  }
  /** Voice/speech-only audio optimization — see this module's own doc for the exact contract and
   * `modules/media/audio/policies/voice.ts` for the full product rationale. Omitted entirely: no
   * audio file is even scanned by this plugin (existing `assetsPlugin` behavior for `.wav`/`.mp3`/
   * etc. stays completely unchanged). */
  audio?: {
    /** The ONLY implemented audio profile today — see `modules/media/audio/audio-transcoder.ts`'s
     * own doc for how a future profile (music, podcast, ...) would be added as a SIBLING key here,
     * never by widening this one. Omitted: no voice optimization, even when `audio` itself is
     * given (matches `video`/`thumbnails`'s own "the sub-key IS the opt-in" convention). */
    voice?: {
      /** Which output format(s) to produce, additively. Omitted: `['aac']` — the universal-
       * compatibility fallback (see `VoiceAudioFormat`'s own doc). An explicit `['aac', 'opus']`
       * produces both, independently. */
      formats?: VoiceAudioFormat[]
      /** Overrides `VOICE_DEFAULT_BITRATE_KBPS` (128) for every format this call produces. */
      bitrateKbps?: number
    }
    /** Glob patterns scoping WHICH audio assets `voice` applies to — independent of this option's
     * own top-level `include` (video-only). Omitted (the default): every recognized voice-source
     * file (`isVoiceSource` — `.wav` only, deliberately conservative). An asset outside this filter
     * — or one whose extension isn't `.wav` — is always left completely untouched, regardless of
     * `voice` being configured. */
    include?: string[]
  }
  /** Glob patterns (matched against the same `relativePath` the manifest keys on) scoping WHICH
   * video assets `video`/`thumbnails` apply to (audio has its own, separate `audio.include` — see
   * above). Omitted (the default): every recognized video file. An asset outside this filter — or
   * one whose extension isn't a recognized video format at all — is always left completely
   * untouched. */
  include?: string[]
  /** Persists `video`/`thumbnails`/`audio.voice` results ACROSS builds — see this module's own
   * doc. Omitted (the default): every build re-transcodes/re-extracts from scratch. */
  cacheDir?: string
}

/** Options for {@linkcode mediaPlugin}. */
export interface MediaPluginOptions {
  /** Same value passed to `defineSpaceApp({ assetsDir })` — resolved with `scanAssets`'s own
   * first-match-wins convention, identical to `assetsPlugin`'s own. */
  assetsDir: string | string[]
  /** See {@linkcode MediaOptimizeOptions}. Omitted: no optimization at all — every video file is
   * hashed and copied untouched, same as any other unoptimized asset. */
  optimize?: MediaOptimizeOptions
  /**
   * Shares ONE `assets-manifest.json` with `assetsPlugin` (or any other real producer) — see
   * {@linkcode AssetManifestRegistry}'s own doc for the full contract. **Omitted (the default):
   * this plugin creates its own internal registry and includes its own manifest-writing plugin
   * automatically** — a caller using `mediaPlugin` standalone (no `assetsPlugin` in the same
   * build) sees a complete, correct manifest on its own. Pass an EXPLICIT, shared instance when
   * composing alongside `assetsPlugin` (`buildSpaceClient` does this internally) — in that case,
   * whichever code created the shared registry owns including
   * `registry.createManifestPlugin()` in the build itself; this plugin never adds it a second
   * time for you.
   */
  manifestRegistry?: AssetManifestRegistry
}

/** Splits `'clip.mp4'` into `{ base: 'clip', ext: 'mp4' }` — same convention `image-optimize.ts`'s
 * own `splitRelativePath` already establishes (a source with no extension never reaches this
 * function: `isVideoAsset` already requires a recognized one). */
function splitRelativePath(relativePath: string): { base: string; ext: string } {
  const dot = relativePath.lastIndexOf('.')
  return { base: relativePath.slice(0, dot), ext: relativePath.slice(dot + 1) }
}

/** Runs one real transcode/thumbnail call through a real temp output file, reads its bytes back,
 * and always cleans the temp file up — the SAME "caller owns the destination" contract
 * `VideoTranscoder`'s own doc establishes (it never invents a destination), applied here since
 * this plugin's real destination is Rollup's in-memory `emitFile`, not a path on disk it keeps. */
async function withTempOutput<T>(
  extension: string,
  run: (outputPath: string) => Promise<T>,
): Promise<{ result: T; bytes: Uint8Array }> {
  const outputPath = await Deno.makeTempFile({ suffix: `.${extension}` })
  try {
    const result = await run(outputPath)
    const bytes = await Deno.readFile(outputPath)
    return { result, bytes }
  } finally {
    await Deno.remove(outputPath).catch(() => {})
  }
}

interface EmittableEntry {
  relativePath: string
  bytes: Uint8Array
}

async function resolveVideoOutputs(
  transformer: AssetTransformer,
  relativePath: string,
  absolutePath: string,
  optimize: MediaOptimizeOptions | undefined,
): Promise<EmittableEntry[]> {
  const { base } = splitRelativePath(relativePath)
  const entries: EmittableEntry[] = []

  const breakpoints = optimize?.video?.breakpoints ?? []
  const formats = optimize?.video?.formats ?? [defaultFormatFor(relativePath)]

  // Sequential per source file (never `Promise.all` here) — deliberately: each real transcode is
  // its own `ffmpeg` subprocess, and the OUTER loop over every scanned video (see `mediaPlugin`'s
  // own `buildStart`) is already where real concurrency across DIFFERENT files happens, the same
  // granularity `assetsPlugin`'s own "launched concurrently, never one await per asset" doc
  // describes — concurrently launching every VARIANT of the SAME video too would multiply how
  // many simultaneous `ffmpeg` processes one asset alone can spawn, with no real benefit.
  for (const breakpoint of breakpoints) {
    for (const format of formats) {
      // deno-lint-ignore no-await-in-loop
      const { bytes } = await withTempOutput(
        format,
        (outputPath) =>
          transformer.transformVideo(
            { sourcePath: absolutePath },
            { breakpoint, format, outputPath },
          ),
      )
      entries.push({ relativePath: `${base}.${breakpoint}.${format}`, bytes })
    }
  }

  if (optimize?.thumbnails) {
    const thumbnailFormats = optimize.thumbnails.formats ?? ['jpeg']
    for (const format of thumbnailFormats) {
      const extension = format === 'jpeg' ? 'jpg' : format
      // deno-lint-ignore no-await-in-loop
      const { bytes } = await withTempOutput(
        extension,
        (outputPath) =>
          transformer.transformThumbnail({ sourcePath: absolutePath }, {
            outputPath,
            atSeconds: optimize.thumbnails?.atSeconds,
            width: optimize.thumbnails?.width,
            format,
          }),
      )
      entries.push({ relativePath: `${base}.thumb.${extension}`, bytes })
    }
  }

  return entries
}

/**
 * Voice-only counterpart to {@linkcode resolveVideoOutputs} — no breakpoint dimension (audio has
 * none), manifest key `{base}.voice.{extension}` per requested format.
 *
 * **Never-worsened results are never published as a `.voice.{extension}` entry.** See
 * `system-ffmpeg-audio-transcoder.ts`'s own doc for the full reasoning (a real conflict with
 * video's own precedent, resolved by applying that same precedent's underlying principle): voice's
 * transform is ALWAYS a cross-format conversion (`.wav` → `.m4a`/`.opus`), so a never-worsened
 * result physically holds the SOURCE's own untouched bytes at a target-formatted path — publishing
 * that under a `.m4a`/`.opus`-named manifest key would be a mislabeled, broken file. The untouched
 * original (already published unconditionally, immediately below) is the correct, safe
 * representation whenever this happens — so this function simply omits the entry rather than
 * publishing a wrong one.
 */
async function resolveAudioOutputs(
  transformer: AssetTransformer,
  relativePath: string,
  absolutePath: string,
  optimize: MediaOptimizeOptions | undefined,
): Promise<EmittableEntry[]> {
  const { base } = splitRelativePath(relativePath)
  const entries: EmittableEntry[] = []

  const voice = optimize?.audio?.voice
  if (!voice) return entries

  const formats = voice.formats ?? ['aac']

  // Sequential per source file — same reasoning `resolveVideoOutputs` already documents (real
  // concurrency across DIFFERENT files happens one level up, in `buildStart`).
  for (const format of formats) {
    const extension = format === 'opus' ? 'opus' : 'm4a'
    // deno-lint-ignore no-await-in-loop
    const { result, bytes } = await withTempOutput(
      extension,
      (outputPath) =>
        transformer.transformAudio({ sourcePath: absolutePath }, {
          profile: 'voice',
          format,
          bitrateKbps: voice.bitrateKbps,
          outputPath,
        }),
    )
    if (result.neverWorsened) continue
    entries.push({ relativePath: `${base}.voice.${extension}`, bytes })
  }

  return entries
}

/** The `@zanix/space/vite` Vite plugin that discovers, transforms and emits video/audio assets. */
export function mediaPlugin(options: MediaPluginOptions): Plugin[] {
  // Same standalone-vs-composed fallback `assetsPlugin` already establishes — see
  // `MediaPluginOptions.manifestRegistry`'s own doc.
  const registry = options.manifestRegistry ?? createAssetManifestRegistry()
  const ownsRegistry = options.manifestRegistry === undefined

  const plugin: Plugin = {
    name: 'zanix-space-media',
    apply: 'build',
    async buildStart() {
      const resolved = await scanAssets(options.assetsDir)
      const videoEntries = [...resolved].filter(([relativePath]) =>
        matchesInclude(relativePath, options.optimize?.include) && isVideoAsset(relativePath)
      )
      // Audio is scanned ONLY when `optimize.audio` is present at all — the explicit opt-in this
      // plugin's own doc (and the voice product mandate) both require: a `.wav` never gets looked
      // at by this plugin, even to re-hash its own untouched original, unless `audio` is
      // configured. `assetsPlugin`'s own fallback already hashes/copies it either way — see
      // `MediaOptimizeOptions.audio`'s own doc.
      const audioEntries = options.optimize?.audio
        ? [...resolved].filter(([relativePath]) =>
          matchesInclude(relativePath, options.optimize?.audio?.include) &&
          isVoiceSource(relativePath)
        )
        : []
      if (videoEntries.length === 0 && audioEntries.length === 0) return

      // Cache wiring itself lives in `createAssetTransformer` (`modules/asset-transform/`) —
      // this plugin only supplies its own `cacheDir` option. ONE transformer/cache instance for
      // video, thumbnail, AND voice audio — no separate `AudioCache`.
      const transformer = createAssetTransformer({ cacheDir: options.optimize?.cacheDir })

      const emitEntry = (relativePath: string, bytes: Uint8Array) => {
        const refId = this.emitFile({ type: 'asset', name: relativePath, source: bytes })
        registry.register(relativePath, refId)
      }

      // Real concurrency across DIFFERENT source files — same granularity `assetsPlugin`'s own
      // `Promise.all(entries.map(...))` already uses for images, applied here at the file level
      // rather than the variant level (see `resolveVideoOutputs`'s own doc for why). Video and
      // audio entries are disjoint (an extension can never match both `isVideoAsset` and
      // `isVoiceSource`), so both lists are processed in the SAME `Promise.all`, not two
      // sequential passes.
      await Promise.all([
        ...videoEntries.map(async ([relativePath, absolutePath]) => {
          // The untouched original is ALWAYS emitted — video variants/thumbnails are purely
          // ADDITIVE, exactly like `assetsPlugin`'s own `breakpoints`/`formats` mode for images;
          // there is no "recompress the original in place" mode for video (never asked for, and
          // `VideoTranscoder`'s own "never worsen" rule already makes that a meaningfully
          // different, riskier default than images' own strictly-smaller-or-untouched one).
          const source = await Deno.readFile(absolutePath)
          emitEntry(relativePath, source)

          const outputs = await resolveVideoOutputs(
            transformer,
            relativePath,
            absolutePath,
            options.optimize,
          )
          for (const output of outputs) emitEntry(output.relativePath, output.bytes)
        }),
        ...audioEntries.map(async ([relativePath, absolutePath]) => {
          // Same "untouched original is ALWAYS emitted, variants are purely ADDITIVE" contract as
          // video — see `resolveAudioOutputs`'s own doc for why a never-worsened voice output is
          // never published as its own manifest entry.
          const source = await Deno.readFile(absolutePath)
          emitEntry(relativePath, source)

          const outputs = await resolveAudioOutputs(
            transformer,
            relativePath,
            absolutePath,
            options.optimize,
          )
          for (const output of outputs) emitEntry(output.relativePath, output.bytes)
        }),
      ])
    },
  }

  return ownsRegistry ? [plugin, registry.createManifestPlugin()] : [plugin]
}
