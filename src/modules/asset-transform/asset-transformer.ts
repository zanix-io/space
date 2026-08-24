/**
 * A domain/runtime facade unifying image, video, thumbnail, and audio transformation on top of
 * primitives that already exist and are already correct: `optimizeImageAsset`/
 * `createCachedImageOptimizer` (`modules/assets/`), `VideoTranscoder`/
 * `createSystemFfmpegTranscoder`/`createCachedVideoTranscoder`, and `AudioTranscoder`/
 * `createSystemFfmpegAudioTranscoder`/`createCachedAudioTranscoder` (`modules/media/`). This
 * module introduces NO new cache/idempotency logic of its own — every cache decision here is a
 * direct, unmodified call into those three decorators, composed once instead of inlined
 * separately by every caller (`assetsPlugin`/`mediaPlugin` used to each wire their own
 * `cacheDir ? wrap(...) : raw` — see `modules/bundler/assets-plugin.ts`/`media-plugin.ts`'s own
 * history for that duplication).
 *
 * Deliberately agnostic of Vite/Rollup/CLI/HTTP/React/Preact — see
 * `src/@tests/unit/asset-transform/dependency-boundary.test.ts` for the enforced module-graph
 * check. Any real caller (a build plugin today, a background worker or a future HTTP Asset API
 * tomorrow) constructs one `AssetTransformer` and calls straight through to a real
 * `optimizeImageAsset`/`VideoTranscoder`/`AudioTranscoder`, cached or not.
 *
 * **Scope, deliberately**: this facade's responsibility ends at
 * `source -> transformed output/result + transformation metadata`. Two concerns that might look
 * related are explicitly NOT here:
 * - **Publication** (`AssetManifestRegistry`, `this.emitFile()`, a manifest, a public URL) stays
 *   entirely an adapter concern — `assetsPlugin`/`mediaPlugin` still own registering their own
 *   outputs into a shared registry directly, exactly as they did before this facade existed. A
 *   transformer that also knew how to publish would conflate "did the bytes get produced" with
 *   "how are they exposed", the same boundary `VideoTranscoder`'s own doc already draws (`the
 *   caller controls filesystem destinations end to end`).
 * - **Backend capability discovery** (`probeFfmpegAvailability`/`TranscoderAvailability`) is a
 *   different question from transformation ("can this environment transcode at all" vs. "produce
 *   this specific transcode") and has no current consumer reaching it through a transformer
 *   instance — neither `assetsPlugin` nor `mediaPlugin` ever calls `.probe()` today. It stays
 *   exclusively in `modules/media` (already public via the `./media` subpath); a real future
 *   consumer that needs it calls `probeFfmpegAvailability()` directly.
 *
 * `transformThumbnail` is deliberately just another method here, backed by the SAME cached
 * `VideoTranscoder` instance `transformVideo` uses — mirroring `VideoTranscoder` itself, where
 * `extractThumbnail` is a sibling method of `transcode` on one port, never a separate transcoder
 * type. Its own independent cache identity (`THUMBNAIL_TRANSFORM_POLICY_VERSION`, distinct from
 * `VIDEO_TRANSFORM_POLICY_VERSION`) is entirely `createCachedVideoTranscoder`'s concern, unchanged
 * by this facade.
 *
 * @module
 */

import { optimizeImageAsset } from '../assets/image-optimize.ts'
import type { ImagesOptimizeOptions, OptimizedAssetEntry } from '../assets/image-optimize.ts'
import {
  createCachedImageOptimizer,
  type OptimizeImageAssetFn,
} from '../assets/cached-image-optimizer.ts'
import type { TransformCacheStore } from '../assets/transform-cache.ts'
import { createFileTransformCacheStore } from '../assets/transform-cache-store.ts'
import { createSystemFfmpegTranscoder } from '../media/system-ffmpeg-transcoder.ts'
import { createCachedVideoTranscoder } from '../media/cached-video-transcoder.ts'
import type {
  ThumbnailOptions,
  ThumbnailResult,
  TranscodeInput,
  TranscodeOptions,
  TranscodeResult,
  VideoTranscoder,
} from '../media/video-transcoder.ts'
import { createSystemFfmpegAudioTranscoder } from '../media/audio/system-ffmpeg-audio-transcoder.ts'
import { createCachedAudioTranscoder } from '../media/audio/cached-audio-transcoder.ts'
import type {
  AudioTranscodeInput,
  AudioTranscoder,
  AudioTranscodeResult,
  AudioTransformOptions,
} from '../media/audio/audio-transcoder.ts'

/**
 * Every asset shape this domain is conceptually organized around — all four real, implemented
 * kinds (`transformAudio`, backed by `modules/media/audio/`, implements the last of them) — see
 * {@linkcode isImplementedAssetKind}. Note that `'audio'` itself is NOT one single policy the way
 * `'image'`/`'video'`/`'thumbnail'` each are: it is a family of PROFILES (`voice` today;
 * `music`/`podcast`/... are real, designed-for extension points, not yet implemented) — see
 * `modules/media/audio/audio-transcoder.ts`'s own doc for how a future profile plugs in without
 * this type or {@linkcode AssetTransformer} itself changing again.
 */
export type AssetKind = 'image' | 'video' | 'thumbnail' | 'audio'

/** Every {@linkcode AssetKind} this module actually implements — all four today. Kept as its own
 * type (rather than inlining `AssetKind` at every call site) so a FUTURE kind could still be added
 * as a reserved, not-yet-implemented extension point without every existing consumer needing to
 * change. */
export type ImplementedAssetKind = AssetKind

/** A trivial, exhaustive-by-construction narrowing guard — kept as a real function (not just a
 * type) even though every current {@linkcode AssetKind} is implemented today, so a caller
 * iterating over `AssetKind` values at runtime still has one canonical place to ask "is this one
 * real yet" — the same mechanism a future reserved-but-unimplemented kind would reuse. */
export function isImplementedAssetKind(_kind: AssetKind): _kind is ImplementedAssetKind {
  return true
}

/** Options for {@linkcode createAssetTransformer}. */
export interface AssetTransformerOptions {
  /** Persists results across calls/processes — the SAME `TransformCacheStore` shape
   * `assetsPlugin`/`mediaPlugin` already used inline. Omitted (and no `cacheStore` either): every
   * call runs for real, no caching at all — `transformImage` is then literally
   * `imageOptimizer`/`optimizeImageAsset` itself (no wrapper), and `transformVideo`/
   * `transformThumbnail` call straight into the raw `videoTranscoder`. */
  cacheDir?: string
  /** An explicit `TransformCacheStore` — takes precedence over `cacheDir` when both are given (a
   * caller that already has one, e.g. `createInMemoryTransformCacheStore()` in a test, never
   * needs a real directory created on disk on its behalf). */
  cacheStore?: TransformCacheStore
  /** Overrides the real image optimizer this transformer wraps. Default: `optimizeImageAsset`
   * itself. Exists so a caller with its own execution strategy (`assetsPlugin`'s own worker-pool-
   * backed `OptimizeRunner.optimizeImage`) can still get this facade's cache wiring without this
   * module needing to know worker pools exist at all — any function matching
   * {@linkcode OptimizeImageAssetFn} composes here identically. */
  imageOptimizer?: OptimizeImageAssetFn
  /** Overrides the real video transcoder this transformer wraps. Default:
   * `createSystemFfmpegTranscoder()`. Exists for the same reason `imageOptimizer` does — and for
   * tests, so a fake `VideoTranscoder` never has to touch real `ffmpeg`. */
  videoTranscoder?: VideoTranscoder
  /** Overrides the real audio transcoder this transformer wraps. Default:
   * `createSystemFfmpegAudioTranscoder()`. Exists for the same reason `videoTranscoder` does. */
  audioTranscoder?: AudioTranscoder
}

/** The facade `createAssetTransformer` returns. Every method's own signature is identical to the
 * primitive it wraps — a drop-in replacement for whatever called `optimizeImageAsset`/
 * `VideoTranscoder.transcode`/`VideoTranscoder.extractThumbnail`/`AudioTranscoder.transcode`
 * directly before, minus the caller having to wire caching itself. `transformAudio` is deliberately
 * just another method here, at the SAME level as `transformImage`/`transformVideo`/
 * `transformThumbnail` — never a nested `transformAudio.voice(...)` or a nested profile-dispatching
 * facade of its own. The profile lives entirely inside `AudioTransformOptions` (a discriminated
 * union — see `modules/media/audio/audio-transcoder.ts`'s own doc), so this interface never needed
 * to change shape to accommodate it, and won't need to again for a future audio profile either. */
export interface AssetTransformer {
  /** Drop-in replacement for `optimizeImageAsset`, cache-wired. */
  transformImage(
    relativePath: string,
    source: Uint8Array,
    options: true | ImagesOptimizeOptions,
  ): Promise<OptimizedAssetEntry[]>
  /** Drop-in replacement for `VideoTranscoder.transcode`, cache-wired. */
  transformVideo(input: TranscodeInput, options: TranscodeOptions): Promise<TranscodeResult>
  /** Drop-in replacement for `VideoTranscoder.extractThumbnail`, cache-wired. */
  transformThumbnail(input: TranscodeInput, options: ThumbnailOptions): Promise<ThumbnailResult>
  /** Drop-in replacement for `AudioTranscoder.transcode`, cache-wired. */
  transformAudio(
    input: AudioTranscodeInput,
    options: AudioTransformOptions,
  ): Promise<AudioTranscodeResult>
}

/**
 * Composes one `AssetTransformer` — the same cache-wiring shape `assetsPlugin`/`mediaPlugin` each
 * used to build for themselves, now built once. See this module's own doc for what this
 * deliberately does NOT do (publication, capability probing).
 */
export function createAssetTransformer(options: AssetTransformerOptions = {}): AssetTransformer {
  const store = options.cacheStore ??
    (options.cacheDir ? createFileTransformCacheStore(options.cacheDir) : undefined)

  const baseImageOptimizer = options.imageOptimizer ?? optimizeImageAsset
  const transformImage = store
    ? createCachedImageOptimizer(baseImageOptimizer, store)
    : baseImageOptimizer

  const baseTranscoder = options.videoTranscoder ?? createSystemFfmpegTranscoder()
  const transcoder = store ? createCachedVideoTranscoder(baseTranscoder, store) : baseTranscoder

  const baseAudioTranscoder = options.audioTranscoder ?? createSystemFfmpegAudioTranscoder()
  const audioTranscoder = store
    ? createCachedAudioTranscoder(baseAudioTranscoder, store)
    : baseAudioTranscoder

  return {
    transformImage,
    transformVideo: (input, transcodeOptions) => transcoder.transcode(input, transcodeOptions),
    transformThumbnail: (input, thumbnailOptions) =>
      transcoder.extractThumbnail(input, thumbnailOptions),
    transformAudio: (input, audioOptions) => audioTranscoder.transcode(input, audioOptions),
  }
}
