/**
 * The `VideoTranscoder` PORT — a contract, not an implementation. `system-ffmpeg-transcoder.ts`'s
 * `createSystemFfmpegTranscoder()` is the one adapter this package ships; nothing in this file
 * knows or cares that ffmpeg is involved at all, the same port/adapter split
 * `modules/assets/video-source.ts` already establishes for detection vs. `IFrame`'s own rendering.
 *
 * **Reusability is a real, load-bearing requirement here, not an incidental property.** This
 * module (and everything it imports — audited explicitly: only `@zanix/errors` and the standalone,
 * dependency-free `content-type.ts`, never `modules/bundler/`, `modules/runtime/`, or
 * `modules/router/`) is meant to be consumable identically by `zanix space build`'s own future
 * media plugin AND by something that has nothing to do with a build at all — e.g. a future Asset
 * API/background worker that receives an uploaded video over HTTP and transcodes it on write. Both
 * callers already need a real local file to hand ffmpeg (inherent to any subprocess-based ffmpeg
 * integration, not a build-specific requirement) and both decide for themselves when to
 * transcode, where the original/output actually lives, and how the result gets published
 * (a manifest entry, an S3/CDN upload, an HTTP response) — this port supplies none of that:
 * - **The caller controls filesystem destinations end to end.** `TranscodeOptions.outputPath`/
 *   `ThumbnailOptions.outputPath` are both required, opaque strings — never resolved against
 *   `assetsDir`, a build output directory, or any other project convention. This module never
 *   creates a directory, decides a naming convention, or registers anything in a manifest: those
 *   are a BUNDLER-layer concern (a hypothetical future `modules/bundler/media-plugin.ts`, the same
 *   relationship `bundler/assets-plugin.ts` already has to `modules/assets/image-optimize.ts`),
 *   never this port's own job — see `system-ffmpeg-transcoder.ts`'s own doc for why hashing and
 *   manifest registration are deliberately not this port's responsibility.
 * - **No HTTP, CLI, Docker, storage, or CDN concept anywhere in this contract.** `@zanix/cli`'s
 *   own future responsibility is the RUNTIME/DEPLOYMENT experience around this (detecting
 *   ffmpeg, documenting it as a prerequisite, bundling it into a Docker image) — never a
 *   precondition this port's own TYPES encode or assume.
 * - **This package never installs or downloads ffmpeg** — see `system-ffmpeg-transcoder.ts`'s own
 *   doc for why that's a deliberate scope boundary, not a gap.
 * - What DOES belong here, because it's real processing policy any caller needs identically
 *   regardless of who's asking: never-worsen, source-aware probing/capping, the named breakpoint
 *   presets, codec-by-container selection, and thumbnail extraction.
 *
 * @module
 */

import type { TranscoderAvailability } from './ffmpeg-availability.ts'
import type { VideoBreakpointName } from './video-breakpoints.ts'

export type { TranscoderAvailability, UnavailableReason } from './ffmpeg-availability.ts'
export type { SourceVideoInfo } from './ffprobe-media.ts'
export type {
  ResolvedVideoBreakpoint,
  VideoBreakpointName,
  VideoBreakpointOverrides,
} from './video-breakpoints.ts'

/** The source video a transcode/thumbnail operation reads from. Always a real path on disk —
 * unlike `modules/assets/image-optimize.ts`'s own `Uint8Array`-in/-out shape, this port is
 * file-path-based: a video file is routinely orders of magnitude larger than an image, and ffmpeg
 * is a real subprocess (not an in-process binding like `sharp`) that naturally reads/writes real
 * files rather than buffering a whole video through a pipe. */
export interface TranscodeInput {
  /** Path to the source video file on disk. */
  sourcePath: string
}

/** Options for a single `transcode()` call — breakpoint, output container, and destination. */
export interface TranscodeOptions {
  /** Named preset (`'msm' | 'mlg' | 'dmd' | 'dlg'`) — see `video-breakpoints.ts`'s own doc. No
   * raw-numeric-width form (unlike `ImageBreakpoint`): not asked for. */
  breakpoint: VideoBreakpointName
  /** Output container — determines codec pairing (`'webm'` → vp9/opus, `'mp4'` → h264/aac).
   * Defaults to `'webm'` when the SOURCE file's own extension is already `.webm`, `'mp4'`
   * otherwise — matching the source's own container unless a real conversion is explicitly
   * requested. */
  format?: 'mp4' | 'webm'
  /** Where the final result is written. Required — this port never invents a destination or a
   * naming convention; the caller's own directory must already exist (this never creates one). */
  outputPath: string
  /** Overrides this call's own resolved breakpoint width. */
  width?: number
  /** Overrides this call's own resolved breakpoint bitrate. */
  videoBitrateKbps?: number
  /**
   * What to do when `ffmpeg`/`ffprobe` aren't available. Default `'throw'` — a real,
   * actionable error naming exactly which of the four `UnavailableReason`s applies (see
   * `ffmpeg-availability.ts`'s own doc), never a silent degrade. `'passthrough'` copies
   * `sourcePath` to `outputPath` completely untouched ONLY when explicitly requested — this port
   * never assumes that's safe on the caller's behalf (a `.mov` copied to a `.webm`-named
   * destination would be a mislabeled file, not a real fallback, if the caller actually needed a
   * real conversion).
   */
  onUnavailable?: 'throw' | 'passthrough'
}

/** What a `transcode()` call actually produced — where it was written and whether ffmpeg ran. */
export interface TranscodeResult {
  /** Always equal to `TranscodeOptions.outputPath` — included for a caller that finds it
   * convenient to destructure the result without holding onto its own options object. */
  outputPath: string
  /** Size, in bytes, of the file written to `outputPath`. */
  bytesWritten: number
  /** MIME type of the file written to `outputPath`, derived from its extension. */
  mimeType: string
  /** `true` when ffmpeg/ffprobe were unavailable and `onUnavailable: 'passthrough'` was set — the
   * source was copied completely untouched, ffmpeg was never invoked at all. */
  passthrough: boolean
  /**
   * `true` when ffmpeg WAS invoked, but its own output was discarded because it wasn't at least
   * 1.5% smaller than the source (this port's "never worsen" rule and margin for video — a
   * distinct, larger margin than `modules/assets/image-optimize.ts`'s own `pickSmaller`, which
   * requires only a strict `<`, no percentage threshold; the two are deliberately not unified, see
   * `system-ffmpeg-transcoder.ts`'s own doc) — `outputPath` then holds a copy of the untouched
   * source instead. Mutually exclusive with `passthrough` (this only ever applies when ffmpeg DID
   * run) and only ever evaluated for a same-CONTAINER re-encode — see
   * `system-ffmpeg-transcoder.ts`'s own doc for why a real format conversion never triggers this.
   */
  neverWorsened: boolean
}

/** Options for a single `extractThumbnail()` call — timestamp, format, and destination. */
export interface ThumbnailOptions {
  /** Where the extracted frame is written — required, same caller-controlled-destination contract
   * as `TranscodeOptions.outputPath`. */
  outputPath: string
  /** Timestamp to extract the frame from. Default `1` (one second in) — arbitrary but
   * deliberately not `0`, which frequently lands on a black/blank first frame for many encoders. */
  atSeconds?: number
  /** Resizes the extracted frame's own width, preserving aspect ratio. Omitted: the source
   * frame's own real size. */
  width?: number
  /** Extracted frame's image format. Default `'jpeg'`. */
  format?: 'jpeg' | 'png' | 'webp'
}

/** What an `extractThumbnail()` call actually produced. */
export interface ThumbnailResult {
  /** Always equal to `ThumbnailOptions.outputPath`. */
  outputPath: string
  /** Size, in bytes, of the extracted frame written to `outputPath`. */
  bytesWritten: number
  /** MIME type of the extracted frame, derived from `format`. */
  mimeType: string
}

/**
 * The port. `probe()` and a specific-file probe (`ffprobe-media.ts`'s own `probeSourceVideo`,
 * used internally by `transcode`/`extractThumbnail`, not exposed as a method here) are
 * deliberately two different concerns — see `ffprobe-media.ts`'s own doc for why they never share
 * one function.
 */
export interface VideoTranscoder {
  /** Runtime-level availability only — see `ffmpeg-availability.ts`'s own doc for the four
   * distinguishable {@linkcode TranscoderAvailability.reason}s. Never inspects a specific file. */
  probe(): Promise<TranscoderAvailability>
  /** Transcodes `input` per `options`, writing the result to `options.outputPath`. */
  transcode(input: TranscodeInput, options: TranscodeOptions): Promise<TranscodeResult>
  /** No `onUnavailable` option — unlike `transcode`, there is no sensible passthrough for a
   * thumbnail: it's a derived asset with no "original" to substitute. Always throws when
   * unavailable. */
  extractThumbnail(input: TranscodeInput, options: ThumbnailOptions): Promise<ThumbnailResult>
}
