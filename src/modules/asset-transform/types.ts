/**
 * Pure data-shape types for this domain — `AssetKind`, `ImplementedAssetKind`,
 * `isImplementedAssetKind`, `AssetTransformer`, `AssetTransformerOptions` — deliberately split from
 * `asset-transformer.ts` itself, which unconditionally value-imports `createImageTransformer`
 * (`sharp`-backed). None of these reference anything beyond `image-optimize-types.ts`
 * (`sharp`-free), `transform-cache.ts`, `video-transcoder.ts`, and `audio-transcoder.ts` (all three
 * npm-free), so a consumer that only needs to type an options object — e.g. `mod.ts`'s own
 * `SpaceAppConfig`/`AssetService`'s own `AssetServiceOptions.transformer` — never resolves `sharp`
 * merely by reading this file. Re-exported unchanged from `asset-transformer.ts`, so switching that
 * import site between "the real file" and "this types file" is never a breaking change in either
 * direction.
 *
 * @module
 */

import type {
  ImagesOptimizeOptions,
  OptimizedAssetEntry,
  OptimizeImageAssetFn,
} from '../assets/image-optimize-types.ts'
import type { TransformCacheStore } from '../assets/transform-cache.ts'
import type {
  ThumbnailOptions,
  ThumbnailResult,
  TranscodeInput,
  TranscodeOptions,
  TranscodeResult,
  VideoTranscoder,
} from '../media/video-transcoder.ts'
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

/** Options for `createAssetTransformer`. */
export interface AssetTransformerOptions {
  /** Persists results across calls/processes — the SAME `TransformCacheStore` shape
   * `assetsPlugin`/`mediaPlugin` already use inline. Omitted (and no `cacheStore` either): every
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
