/**
 * Video/thumbnail/audio-only transformation facade — entirely FFMPEG-backed
 * (`createSystemFfmpegTranscoder`/`createSystemFfmpegAudioTranscoder`, `modules/media/`), zero npm
 * dependencies of its own (`Deno.Command` only). Split out of `asset-transformer.ts` as its own
 * file so a caller that only ever transforms video/audio (`mediaPlugin`) never has `sharp`
 * reachable in its module graph merely by needing this shared cache-wiring shape — see
 * `image-transformer.ts`'s own doc for the sharp-backed counterpart this file deliberately never
 * imports. `createAssetTransformer` (`asset-transformer.ts`) composes this file's own
 * `createMediaTransformer` together with `image-transformer.ts`'s `createImageTransformer` into
 * the full four-method `AssetTransformer` facade `assets-api`/tests see — this file's own shape
 * stays a strict subset of that one.
 *
 * @module
 */

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
import type { TransformCacheStore } from '../assets/transform-cache.ts'
import { createFileTransformCacheStore } from '../assets/transform-cache-store.ts'

/** Options for {@linkcode createMediaTransformer}. */
export interface MediaTransformerOptions {
  /** Persists results across calls/processes — a real directory path this store creates if
   * missing. Omitted (and no `cacheStore` either): every call runs for real, no caching at all —
   * `transformVideo`/`transformThumbnail` call straight into the raw `videoTranscoder`, and
   * `transformAudio` calls straight into the raw `audioTranscoder`. */
  cacheDir?: string
  /** An explicit `TransformCacheStore` — takes precedence over `cacheDir` when both are given (a
   * caller that already has one, e.g. `createAssetTransformer`'s own shared instance, never needs
   * a second real directory created on disk on its behalf). */
  cacheStore?: TransformCacheStore
  /** Overrides the real video transcoder this transformer wraps. Default:
   * `createSystemFfmpegTranscoder()`. Exists for tests, so a fake `VideoTranscoder` never has to
   * touch real `ffmpeg`. */
  videoTranscoder?: VideoTranscoder
  /** Overrides the real audio transcoder this transformer wraps. Default:
   * `createSystemFfmpegAudioTranscoder()`. Exists for the same reason `videoTranscoder` does. */
  audioTranscoder?: AudioTranscoder
}

/** The facade {@linkcode createMediaTransformer} returns. `transformThumbnail` is deliberately just
 * another method here, backed by the SAME cached `VideoTranscoder` instance `transformVideo` uses —
 * mirroring `VideoTranscoder` itself, where `extractThumbnail` is a sibling method of `transcode`
 * on one port, never a separate transcoder type. */
export interface MediaTransformer {
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
 * Composes one {@linkcode MediaTransformer} — the same cache-wiring shape `mediaPlugin` already
 * builds for video/thumbnail/voice audio. See `asset-transformer.ts`'s own doc for how this
 * composes with `image-transformer.ts`'s `createImageTransformer` into the full `AssetTransformer`
 * a generic caller (`assets-api`) needs.
 */
export function createMediaTransformer(
  options: MediaTransformerOptions = {},
): MediaTransformer {
  const store = options.cacheStore ??
    (options.cacheDir ? createFileTransformCacheStore(options.cacheDir) : undefined)

  const baseTranscoder = options.videoTranscoder ?? createSystemFfmpegTranscoder()
  const transcoder = store ? createCachedVideoTranscoder(baseTranscoder, store) : baseTranscoder

  const baseAudioTranscoder = options.audioTranscoder ?? createSystemFfmpegAudioTranscoder()
  const audioTranscoder = store
    ? createCachedAudioTranscoder(baseAudioTranscoder, store)
    : baseAudioTranscoder

  return {
    transformVideo: (input, transcodeOptions) => transcoder.transcode(input, transcodeOptions),
    transformThumbnail: (input, thumbnailOptions) =>
      transcoder.extractThumbnail(input, thumbnailOptions),
    transformAudio: (input, audioOptions) => audioTranscoder.transcode(input, audioOptions),
  }
}
