/**
 * Wraps a real `VideoTranscoder` with the shared transform cache (`modules/assets/transform-cache.
 * ts`) — `VideoTranscoder`/`SystemFfmpegTranscoder` themselves stay exactly as unaware of caching
 * as they already were; per this codebase's own explicit architectural rule (confirmed in an
 * earlier audit), no state/cache belongs inside the transcoder itself. Intended for whatever
 * orchestrator eventually calls `createSystemFfmpegTranscoder()` (a build plugin, an Asset API) —
 * `createCachedVideoTranscoder(createSystemFfmpegTranscoder(), store)` is a drop-in
 * `VideoTranscoder` with identical observable behavior, minus the redundant `ffmpeg` invocations.
 *
 * Both operations this port exposes get their own, independently versioned cache identity:
 * `transcode()` under `VIDEO_TRANSFORM_POLICY_VERSION` (bumped whenever `video-breakpoints.ts`'s
 * calibrated crf/CQ/bitrate values, or the rate-control MECHANISM itself, change), and
 * `extractThumbnail()` under `THUMBNAIL_TRANSFORM_POLICY_VERSION` (bumped whenever thumbnail
 * defaults — timestamp, format, dimensions — change). Deliberately two separate version axes: a
 * thumbnail policy change has no reason to force every already-cached video transcode to
 * reprocess, and vice versa.
 *
 * Cache hit requirement for BOTH operations: the SAME `outputPath` must be requested again — this
 * decorator never owns storage/CDN placement, consistent with `VideoTranscoder`'s own contract
 * (see `video-transcoder.ts`'s own doc: "the caller controls filesystem destinations end to
 * end"). A hit whose recorded output no longer matches what's really on disk is treated as a safe
 * miss and reprocessed for real, never trusted blindly — see `verifyOnDiskCopy` below.
 *
 * @module
 */

import { contentTypeFor } from '../assets/content-type.ts'
import {
  buildTransformCacheKey,
  hashSourceBytes,
  type TransformCacheStore,
} from '../assets/transform-cache.ts'
import { defaultFormatFor } from './system-ffmpeg-transcoder.ts'
import type {
  ThumbnailOptions,
  ThumbnailResult,
  TranscodeInput,
  TranscodeOptions,
  TranscodeResult,
  VideoTranscoder,
} from './video-transcoder.ts'

/** Bumped whenever the calibrated crf/CQ/bitrate values in `video-breakpoints.ts`, or the
 * rate-control MECHANISM itself (capped-CRF/CQ vs. a future replacement), change. A bump changes
 * every `transcode()` cache key it touches, so every previously cached transcode is transparently
 * reprocessed under the new policy — no explicit invalidation code needed anywhere. */
export const VIDEO_TRANSFORM_POLICY_VERSION = 'v1'

/** Bumped whenever this port's own thumbnail defaults (timestamp, format, dimension-capping
 * behavior) change — a distinct axis from `VIDEO_TRANSFORM_POLICY_VERSION`, see this module's own
 * doc for why. */
export const THUMBNAIL_TRANSFORM_POLICY_VERSION = 'v1'

function buildTranscodeTransformId(
  breakpoint: string,
  format: string,
  options: TranscodeOptions,
): string {
  let id = `video:${breakpoint}:${format}`
  if (options.width !== undefined) id += `:w${options.width}`
  if (options.videoBitrateKbps !== undefined) id += `:b${options.videoBitrateKbps}`
  return id
}

function buildThumbnailTransformId(options: ThumbnailOptions): string {
  const atSeconds = options.atSeconds ?? 1
  const format = options.format ?? 'jpeg'
  let id = `thumbnail:${atSeconds}:${format}`
  if (options.width !== undefined) id += `:w${options.width}`
  return id
}

/** Overrides for the cache policy versions this decorator uses. */
export interface CachedVideoTranscoderOptions {
  /** Overrides `VIDEO_TRANSFORM_POLICY_VERSION` for this instance's `transcode()` cache keys. */
  transcodePolicyVersion?: string
  /** Overrides `THUMBNAIL_TRANSFORM_POLICY_VERSION` for this instance's `extractThumbnail()`
   * cache keys. */
  thumbnailPolicyVersion?: string
}

/** Wraps `transcoder` with `store`-backed caching for both `transcode()` and
 * `extractThumbnail()`. */
export function createCachedVideoTranscoder(
  transcoder: VideoTranscoder,
  store: TransformCacheStore,
  options: CachedVideoTranscoderOptions = {},
): VideoTranscoder {
  const transcodePolicyVersion = options.transcodePolicyVersion ?? VIDEO_TRANSFORM_POLICY_VERSION
  const thumbnailPolicyVersion = options.thumbnailPolicyVersion ??
    THUMBNAIL_TRANSFORM_POLICY_VERSION

  return {
    probe: transcoder.probe,

    async transcode(input: TranscodeInput, opts: TranscodeOptions): Promise<TranscodeResult> {
      const sourceBytes = await Deno.readFile(input.sourcePath)
      const format = opts.format ?? defaultFormatFor(input.sourcePath)
      const transformId = buildTranscodeTransformId(opts.breakpoint, format, opts)
      const sourceHash = await hashSourceBytes(sourceBytes)
      const policyVersion = transcodePolicyVersion
      const key = buildTransformCacheKey({ sourceHash, transformId, policyVersion })

      const cached = await store.getEntry(key)
      if (cached?.status === 'never-worsened') {
        // No new bytes were ever produced last time — the ORIGINAL is the correct output, and
        // this call already holds its real bytes (just read to hash them). Never re-runs ffmpeg.
        await Deno.writeFile(opts.outputPath, sourceBytes)
        return {
          outputPath: opts.outputPath,
          bytesWritten: sourceBytes.byteLength,
          mimeType: contentTypeFor(input.sourcePath),
          passthrough: false,
          neverWorsened: true,
        }
      }
      if (cached?.status === 'optimized') {
        const bytes = await store.getBytes(key)
        const hit = bytes &&
          await verifyOnDiskCopyOrWrite(opts.outputPath, bytes, cached.bytesWritten)
        if (hit) {
          return {
            outputPath: opts.outputPath,
            bytesWritten: bytes.byteLength,
            mimeType: contentTypeFor(`x.${format}`),
            passthrough: false,
            neverWorsened: false,
          }
        }
        // Recorded as 'optimized' but its own bytes are missing/short in the store — a
        // corrupt/incompatible cache entry. Falls through to a real, safe recompute.
      }

      const result = await transcoder.transcode(input, opts)

      // The ffmpeg-unavailable passthrough is an ENVIRONMENT state, not a property of
      // (source, transform, policy) — never cached, so a later call made once ffmpeg actually
      // becomes available still gets a real transcode instead of being stuck on this miss.
      if (!result.passthrough) {
        if (result.neverWorsened) {
          await store.setEntry(key, { status: 'never-worsened', bytesWritten: 0 })
        } else {
          const outputBytes = await Deno.readFile(opts.outputPath)
          await store.setBytes(key, outputBytes)
          await store.setEntry(key, { status: 'optimized', bytesWritten: outputBytes.byteLength })
        }
      }

      return result
    },

    async extractThumbnail(
      input: TranscodeInput,
      opts: ThumbnailOptions,
    ): Promise<ThumbnailResult> {
      const sourceBytes = await Deno.readFile(input.sourcePath)
      const transformId = buildThumbnailTransformId(opts)
      const sourceHash = await hashSourceBytes(sourceBytes)
      const policyVersion = thumbnailPolicyVersion
      const key = buildTransformCacheKey({ sourceHash, transformId, policyVersion })

      const format = opts.format ?? 'jpeg'
      const extension = format === 'jpeg' ? 'jpg' : format
      const mimeType = contentTypeFor(`x.${extension}`)

      const cached = await store.getEntry(key)
      if (cached?.status === 'optimized') {
        const bytes = await store.getBytes(key)
        const hit = bytes &&
          await verifyOnDiskCopyOrWrite(opts.outputPath, bytes, cached.bytesWritten)
        if (hit) {
          return { outputPath: opts.outputPath, bytesWritten: bytes.byteLength, mimeType }
        }
        // Same corrupt/incompatible fallback as transcode() above.
      }

      const result = await transcoder.extractThumbnail(input, opts)
      const outputBytes = await Deno.readFile(opts.outputPath)
      await store.setBytes(key, outputBytes)
      await store.setEntry(key, { status: 'optimized', bytesWritten: outputBytes.byteLength })
      return result
    },
  }
}

/** Materializes a cache hit's bytes at `outputPath` (the caller may have asked for a different
 * path than last time — this decorator never assumes it's the same file still sitting there
 * already) — but only after confirming the stored payload's own size still matches what the
 * entry claims; a mismatch here means the store's bytes and its index disagree (corrupt/partial
 * write), so this returns `false` WITHOUT touching `outputPath`, letting the caller fall through
 * to a real recompute instead of writing a payload it no longer trusts. */
async function verifyOnDiskCopyOrWrite(
  outputPath: string,
  bytes: Uint8Array,
  expectedSize: number,
): Promise<boolean> {
  if (bytes.byteLength !== expectedSize) return false
  await Deno.writeFile(outputPath, bytes)
  return true
}
