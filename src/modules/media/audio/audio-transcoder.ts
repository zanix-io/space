/**
 * The `AudioTranscoder` PORT — a contract, not an implementation, conceptually equivalent to
 * `../video-transcoder.ts`'s own `VideoTranscoder` but genuinely audio-specific: no breakpoints, no
 * thumbnail method, no CRF/CQ concept. Same reusability requirement as `VideoTranscoder` — meant to
 * be consumable identically by a build plugin (`modules/bundler/media-plugin.ts`) and by something
 * that has nothing to do with a build at all (a future Asset API/background worker). This module
 * (and everything it imports) never reaches `modules/bundler/`, Vite, React, or Preact — enforced
 * the same way `src/@tests/unit/asset-transform/dependency-boundary.test.ts` already enforces it
 * for `modules/asset-transform/mod.ts`.
 *
 * **`AudioTransformOptions` is a discriminated union, not a flat options bag** — this is the one
 * piece of real, deliberate architecture in this file: `profile` is the discriminant, and each
 * profile (today only `'voice'`, from `./policies/voice.ts`) owns its OWN options shape, policy
 * version, and transform-identity rule, entirely in its own policy module. This port, the cached
 * decorator (`cached-audio-transcoder.ts`), and the real adapter
 * (`system-ffmpeg-audio-transcoder.ts`) know only the COMMON shape (`AudioTranscodeInput`,
 * `AudioTranscodeResult`, `AudioTranscoder`) plus how to DISPATCH on `options.profile` — none of
 * them hardcode a voice-specific field, bitrate, or codec anywhere. Adding a future profile (music,
 * podcast, ...) means adding its own `policies/*.ts` module and one new union member/dispatch
 * branch here and in the two files above — never a change to `AssetTransformer`,
 * `TransformCacheStore`, or `AssetManifestRegistry` (see this package's own audio architecture
 * audit for the explicit demonstration of this claim).
 *
 * @module
 */

import type { TranscoderAvailability } from '../ffmpeg-availability.ts'
import type { VoiceAudioTransformOptions } from './policies/voice.ts'

export type { TranscoderAvailability, UnavailableReason } from '../ffmpeg-availability.ts'
export type { VoiceAudioFormat, VoiceAudioTransformOptions } from './policies/voice.ts'

/** The source audio file a transcode operation reads from. Always a real path on disk — same
 * file-path-based shape `TranscodeInput` already establishes for video, for the same reason (a
 * real subprocess, not an in-process binding). */
export interface AudioTranscodeInput {
  /** Absolute or relative filesystem path to the source audio file. */
  sourcePath: string
}

/**
 * Every audio profile's own options, discriminated by `profile`. Exactly one member today
 * (`VoiceAudioTransformOptions`) — a future profile extends this union
 * (`| MusicAudioTransformOptions`), never widens `VoiceAudioTransformOptions` itself to carry a
 * second profile's concerns.
 */
export type AudioTransformOptions = VoiceAudioTransformOptions

/** What every profile's real transcode call returns — deliberately COMMON, non-profile-specific
 * fields only (no `voiceBitrate`/`speechCodec`-shaped field lives here — see this module's own doc
 * and `AssetManifestRegistry`'s own audit for why the shared layers stay profile-agnostic).
 * `sampleRateHz`/`channels`/`durationSeconds` are read back from the REAL output file via
 * `probeSourceAudio` (never assumed from the request) — this is what lets a codec-intrinsic
 * constraint (Opus always outputs 48kHz — see `system-ffmpeg-audio-transcoder.ts`'s own doc)
 * surface as an honest, real result instead of a
 * silently wrong echo of the source's own value. All three are OPTIONAL — `undefined` in the one
 * case where they genuinely cannot be obtained: `onUnavailable: 'passthrough'` when ffmpeg/ffprobe
 * themselves are not usable at all (the exact condition this branch exists to handle — calling
 * `probeSourceAudio` there would defeat the point by spawning the very binary that's unavailable).
 * Real transcodes and cache hits/replays always populate them for real. */
export interface AudioTranscodeResult {
  /** Always equal to the request's own `outputPath`. */
  outputPath: string
  /** Size, in bytes, of the file written at `outputPath`. */
  bytesWritten: number
  /** MIME type of the output file, derived from its actual format. */
  mimeType: string
  /** Output container/codec format identifier (e.g. `'opus'`). */
  format: string
  /** Sample rate, in Hz, read back from the real output file; `undefined` only when passthrough. */
  sampleRateHz?: number
  /** Channel count read back from the real output file; `undefined` only when passthrough. */
  channels?: number
  /** Duration, in seconds, read back from the real output file; `undefined` only when passthrough. */
  durationSeconds?: number
  /** `true` when ffmpeg/ffprobe were unavailable and `onUnavailable: 'passthrough'` was set. */
  passthrough: boolean
  /** `true` when ffmpeg WAS invoked, but its own output was not strictly smaller (in bytes) than
   * the source — the never-worsen rule this profile's own doc specifies. `outputPath` then holds an
   * untouched copy of the source. Mutually exclusive with `passthrough`. */
  neverWorsened: boolean
}

/**
 * The port. `probe()` is intentionally the SAME shared `probeFfmpegAvailability()` result
 * `VideoTranscoder.probe()` already returns — see `system-ffmpeg-audio-transcoder.ts`'s own doc for
 * why this is correct today (both `aac`/`libopus` are already unconditional entries in the SAME
 * `REQUIRED_ENCODERS` list that gates video), not an accidental coupling to video's own
 * capabilities.
 */
export interface AudioTranscoder {
  /** Checks whether the underlying ffmpeg/ffprobe binaries are available for transcoding. */
  probe(): Promise<TranscoderAvailability>
  /** Transcodes `input` according to `options` and returns the resulting output metadata. */
  transcode(
    input: AudioTranscodeInput,
    options: AudioTransformOptions,
  ): Promise<AudioTranscodeResult>
}
