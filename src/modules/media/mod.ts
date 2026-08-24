/**
 * Video transcoding — a port (`VideoTranscoder`) and one real adapter
 * (`createSystemFfmpegTranscoder`, system `ffmpeg`/`ffprobe` via `Deno.Command`). See
 * `video-transcoder.ts`'s own doc for the port's full contract and `system-ffmpeg-transcoder.ts`'s
 * own doc for the codec/quality calibration and design decisions behind the adapter.
 *
 * @module
 */

export { createSystemFfmpegTranscoder } from './system-ffmpeg-transcoder.ts'
export type {
  ThumbnailOptions,
  ThumbnailResult,
  TranscodeInput,
  TranscodeOptions,
  TranscodeResult,
  VideoTranscoder,
} from './video-transcoder.ts'

export { hasRequiredEncoders, probeFfmpegAvailability } from './ffmpeg-availability.ts'
export type {
  BinaryCheckResult,
  TranscoderAvailability,
  UnavailableReason,
} from './ffmpeg-availability.ts'

export { parseFfprobeOutput, probeSourceVideo } from './ffprobe-media.ts'
export type { SourceVideoInfo } from './ffprobe-media.ts'

export {
  MAX_AUDIO_BITRATE_KBPS,
  resolveVideoBreakpoint,
  VIDEO_BREAKPOINT_PRESETS,
} from './video-breakpoints.ts'
export type {
  ResolvedVideoBreakpoint,
  /** A named video transcoding breakpoint: `'msm' | 'mlg' | 'dmd' | 'dlg'`. */
  VideoBreakpointName,
  VideoBreakpointOverrides,
  VideoBreakpointPreset,
} from './video-breakpoints.ts'

export {
  createCachedVideoTranscoder,
  THUMBNAIL_TRANSFORM_POLICY_VERSION,
  VIDEO_TRANSFORM_POLICY_VERSION,
} from './cached-video-transcoder.ts'
export type { CachedVideoTranscoderOptions } from './cached-video-transcoder.ts'

export { createSystemFfmpegAudioTranscoder } from './audio/system-ffmpeg-audio-transcoder.ts'
export type { AudioTranscodeArgsParams } from './audio/system-ffmpeg-audio-transcoder.ts'
export {
  type CachedAudioTranscoderOptions,
  createCachedAudioTranscoder,
} from './audio/cached-audio-transcoder.ts'
export type {
  AudioTranscodeInput,
  AudioTranscoder,
  AudioTranscodeResult,
  AudioTransformOptions,
} from './audio/audio-transcoder.ts'
export {
  codecForVoiceFormat,
  extensionForVoiceFormat,
  isVoiceSource,
  validateVoiceSource,
  VOICE_DEFAULT_BITRATE_KBPS,
  VOICE_TRANSFORM_POLICY_VERSION,
} from './audio/policies/voice.ts'
export type {
  /** Target voice audio codec/container: `'aac'` (`.m4a`) or `'opus'` (`.opus`). */
  VoiceAudioFormat,
  /** Options for a voice audio transcode — target `format`, and an optional `bitrateKbps`
   * override. */
  VoiceAudioTransformOptions,
} from './audio/policies/voice.ts'
export { probeSourceAudio } from './audio/ffprobe-audio.ts'
export type { SourceAudioInfo } from './audio/ffprobe-audio.ts'
