/**
 * The FIRST, and currently only, audio profile — see `../audio-transcoder.ts`'s own doc for why
 * "profile" exists as a concept at all: `AudioTransformOptions` is a discriminated union so a
 * future profile (music, podcast, ...) can add its own options/policy without touching this one or
 * the common `AudioTranscoder` port. This module owns EVERY voice-specific decision; nothing here
 * leaks into `audio-transcoder.ts`, `cached-audio-transcoder.ts`, or `system-ffmpeg-audio-
 * transcoder.ts` as a hardcoded assumption — see those modules' own doc for how they stay
 * profile-agnostic and dispatch into this file instead.
 *
 * **Deliberately NOT derived from `video-breakpoints.ts`** — no `videoBitrate`, no breakpoints, no
 * CRF/CQ, no `maxrate`/`bufsize`. The one number this module DOES share with video
 * (`VOICE_DEFAULT_BITRATE_KBPS = 128`) is not a reuse of `MAX_AUDIO_BITRATE_KBPS` — it is this
 * codebase's own real, independent audio-quality precedent (`video-breakpoints.ts`'s own ceiling
 * for an embedded video audio track), re-approved here as this profile's own starting policy for a
 * STANDALONE voice file, per an explicit product decision — not re-derived from or imported out of
 * `video-breakpoints.ts`. See `VOICE_DEFAULT_BITRATE_KBPS`'s own doc.
 *
 * **Scope, deliberately**: this policy is for SPEECH/VOICE only — a person talking, not music, not
 * podcasts (which routinely mix speech with music beds/SFX), not hi-fi/mastering/lossless archival,
 * not multichannel. A future `policies/music.ts` (or similar) would define its OWN
 * `MusicAudioTransformOptions`/policy version/bitrate here — never by widening this file.
 *
 * @module
 */

import { InternalError } from '@zanix/errors'

/** The two output formats this profile supports — both already-guaranteed baseline encoders (see
 * `system-ffmpeg-audio-transcoder.ts`'s own doc for why no new capability check was needed).
 * Deliberately excludes MP3 (no measured advantage over AAC — see this framework's own audio
 * benchmark), Vorbis (commonly absent from macOS/Homebrew ffmpeg builds — an unacceptable
 * dev/runtime inconsistency this codebase already solved once for WebP and isn't repeating here),
 * and FLAC (lossless — the wrong tool for a byte-reduction "optimize" use case). */
export type VoiceAudioFormat = 'aac' | 'opus'

/** `aac` → `.m4a` (the universal-compatibility fallback — AAC/M4A has near-universal native
 * `<audio>` support, including old Safari/iOS builds that historically lacked native Opus). `opus`
 * → `.opus` (the efficient, modern choice — outperforms AAC/MP3 at an equal nominal bitrate on
 * demanding content, consistent with established web-audio consensus).
 * Mirrors video's own mp4/webm duality conceptually (universal fallback + efficient alternative),
 * without reusing any of its code. */
export interface VoiceAudioTransformOptions {
  /** Discriminant selecting this profile from `AudioTransformOptions`. */
  profile: 'voice'
  /** Real destination — this port never invents one, same contract every other transform/thumbnail
   * option in this codebase already establishes. */
  outputPath: string
  /** Target output codec/container — `'aac'` (`.m4a`) or `'opus'` (`.opus`). */
  format: VoiceAudioFormat
  /** Overrides {@linkcode VOICE_DEFAULT_BITRATE_KBPS}. Still capped against the source's own real
   * bitrate by `system-ffmpeg-audio-transcoder.ts` — never exceeds the source. */
  bitrateKbps?: number
  /** What to do when ffmpeg/ffprobe aren't available. Default `'throw'` — same contract as
   * `VideoTranscoder.transcode`'s own `onUnavailable` (a real, actionable error naming the reason).
   * `'passthrough'` copies `sourcePath` to `outputPath` completely untouched. */
  onUnavailable?: 'throw' | 'passthrough'
}

/** `video-breakpoints.ts`'s own `MAX_AUDIO_BITRATE_KBPS` — the real audio bitrate ceiling for an
 * embedded video audio track — is `128`; this constant is the SAME real number, re-approved as an
 * explicit, independent product decision for STANDALONE voice audio (not imported from
 * `video-breakpoints.ts`, not re-derived from it): the value already has real, audited precedent in
 * this codebase for "how much bitrate does a spoken/embedded audio track need", and 128kbps
 * AAC/Opus produces a reasonably small, clearly-audible-quality result for both a simple and a
 * demanding synthetic test signal. A future `policies/music.ts` is NOT bound to this number — it would define
 * its own, from its own product/benchmark justification. */
export const VOICE_DEFAULT_BITRATE_KBPS = 128

/** Bumped whenever this profile's own defaults (default bitrate, format-to-codec/container mapping,
 * the rate-control mechanism itself) change — independent of `VIDEO_TRANSFORM_POLICY_VERSION`/
 * `THUMBNAIL_TRANSFORM_POLICY_VERSION`/`IMAGE_TRANSFORM_POLICY_VERSION`, and independent of any
 * future audio profile's own version (e.g. a hypothetical `MUSIC_TRANSFORM_POLICY_VERSION`) — a
 * bump here invalidates ONLY cached voice transforms, never another profile's or another asset
 * kind's own cache entries. */
export const VOICE_TRANSFORM_POLICY_VERSION = 'v1'

/** The real ffmpeg audio encoder for this format — `libopus` (not the native, experimental
 * `opus`), `aac` (ffmpeg's own native encoder — no `libfdk_aac` dependency, same encoder video's
 * own audio track already uses). */
export function codecForVoiceFormat(format: VoiceAudioFormat): string {
  return format === 'opus' ? 'libopus' : 'aac'
}

/** `aac` → `m4a` (ffmpeg auto-selects the right MP4-family muxer from this extension — confirmed
 * empirically, no explicit `-f ipod`/`-f mp4` needed). `opus` → `opus` (Ogg Opus muxer, likewise
 * auto-selected from the extension). */
export function extensionForVoiceFormat(format: VoiceAudioFormat): string {
  return format === 'opus' ? 'opus' : 'm4a'
}

/** The full transform identity for one voice transcode call — `voice:<format>:b<bitrateKbps>`.
 * The LITERAL `voice:` prefix (never a generic `audio:` one) is what keeps this profile's cache
 * entries from EVER colliding with a future profile's own (e.g. a hypothetical `music:aac:b128` —
 * same format, same bitrate number, still a completely different transform identity because the
 * profile name itself is the distinguishing prefix) — mirrors exactly how `video:`/`thumbnail:`
 * already coexist as sibling prefixes under the same shared `TransformCacheStore`, never a nested
 * `audio:voice:...` scheme requiring the common cache layer to know a profile hierarchy exists. */
export function buildVoiceTransformId(options: VoiceAudioTransformOptions): string {
  const bitrateKbps = options.bitrateKbps ?? VOICE_DEFAULT_BITRATE_KBPS
  return `voice:${options.format}:b${bitrateKbps}`
}

/** Source extensions this profile will actually TRANSCODE — deliberately just `.wav`. Explicit,
 * conservative exclusions (each a real decision, not an oversight):
 * - `.mp3`/`.m4a`/`.opus`/`.aac`/`.ogg`/`.flac` (already-lossy or already-optimized) are left as
 *   plain static assets (today's existing, unchanged behavior) — re-encoding an already-compressed
 *   lossy file risks real quality loss (generation loss) for uncertain byte savings, and this
 *   framework has no product reason yet to force that trade-off automatically.
 * - `.pcm` (headerless raw PCM) is deliberately NOT accepted: it carries no self-describing sample
 *   rate/channel/bit-depth — `ffprobe` cannot safely auto-detect these from the file alone, and
 *   `AudioTranscodeInput` has no field to carry an out-of-band hint. Accepting it would mean either
 *   guessing (silently wrong, sometimes) or widening the input contract with new fields no current
 *   caller needs — the exact kind of premature scope-widening this profile's own doc warns against.
 *   Left out; revisit if a real `.pcm` use case with a real sample-rate/channel source ever shows
 *   up. */
export function isVoiceSource(relativePath: string): boolean {
  const dot = relativePath.lastIndexOf('.')
  const extension = dot === -1 ? '' : relativePath.slice(dot).toLowerCase()
  return extension === '.wav'
}

/**
 * The REAL guardrail — throws when `sourcePath` isn't a `.wav`, using {@linkcode isVoiceSource} as
 * its own single source of truth (never a second, independently-maintained check).
 *
 * **Why this exists as its own exported function, not just `mediaPlugin`'s own scan filter**:
 * `mediaPlugin`'s `isVoiceSource(relativePath)` check (`modules/bundler/media-plugin.ts`) is a real,
 * worthwhile EARLY filter — it keeps a non-`.wav` file from ever being scanned/considered at build
 * time at all — but it is only ONE caller of `transformAudio()`. A future direct caller (an
 * `AssetService`, a background worker, an HTTP Asset API endpoint) that calls
 * `AssetTransformer.transformAudio({sourcePath: 'upload.mp3'}, {profile: 'voice', ...})` directly,
 * bypassing `mediaPlugin` entirely, would get NO protection at all if this rule lived only in the
 * plugin's own scan — silently re-encoding an already-lossy file, exactly the outcome this policy
 * exists to prevent. `AudioTranscoder`/`AssetTransformer` themselves stay profile-agnostic (see
 * `../audio-transcoder.ts`'s own doc) — they must never hardcode a `.wav`-only rule, which is a
 * VOICE-specific product decision, not a general audio-transcoding one. So the guardrail lives
 * HERE, in the profile's own policy, and `system-ffmpeg-audio-transcoder.ts` calls it as the very
 * FIRST thing `transcode()` does for the `'voice'` case — before `probeFfmpegAvailability()`, before
 * any real `ffmpeg` subprocess is ever considered — so every consumer of `transformAudio()` (
 * `mediaPlugin`, a direct `AssetTransformer` caller, a future runtime API) gets the EXACT same
 * guardrail, regardless of whether it also happens to filter early itself.
 *
 * A future `policies/music.ts` would define its OWN input-eligibility rule (accepting whatever
 * source formats make sense for music) — never by widening this function, never by making this
 * profile's own `.wav`-only rule apply to a different profile.
 *
 * @throws {InternalError} With a specific, actionable message — never a raw ffmpeg failure, never a
 * silent pass-through of an unsupported source.
 */
export function validateVoiceSource(sourcePath: string): void {
  if (isVoiceSource(sourcePath)) return
  throw new InternalError(
    `Voice audio transcoding only accepts .wav sources — "${sourcePath}" is not a recognized ` +
      `.wav file. Already-compressed lossy audio (.mp3/.m4a/.opus/.aac/.ogg/.flac/...) is never ` +
      `re-encoded automatically under the voice profile — re-encoding an already-lossy file risks ` +
      `real quality loss for uncertain savings. Pass it through untouched instead.`,
    { code: 'SPACE_MEDIA_VOICE_UNSUPPORTED_SOURCE' },
  )
}
