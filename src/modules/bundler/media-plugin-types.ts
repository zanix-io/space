/**
 * Pure data-shape type for `mediaPlugin`'s `optimize` option — `MediaOptimizeOptions` —
 * deliberately split from `media-plugin.ts` itself, which unconditionally value-imports
 * `createMediaTransformer` (ffmpeg-backed) to build the real Vite plugin. References only
 * `VideoBreakpointName` (`../media/video-breakpoints.ts`) and `VoiceAudioFormat`
 * (`../media/audio/policies/voice.ts`), both themselves free of `sharp`/`vite`, so a consumer that
 * only needs to type an options object — e.g. `mod.ts`'s own `SpaceAppConfig.optimize` — never
 * resolves the bundler toolchain merely by reading this file. Re-exported unchanged from
 * `media-plugin.ts`, so switching that import site between "the real file" and "this types file" is
 * never a breaking change in either direction.
 *
 * @module
 */

import type { VideoBreakpointName } from '../media/video-breakpoints.ts'
import type { VoiceAudioFormat } from '../media/audio/policies/voice.ts'

/**
 * `mediaPlugin`'s opt-in, build-time-only FFMPEG-backed optimization — video breakpoint/format
 * variants, thumbnails, and voice audio. See `media-plugin.ts`'s own module doc for the full
 * contract behind each field below.
 */
export interface MediaOptimizeOptions {
  /** Video breakpoint/format variants — see `media-plugin.ts`'s own doc for the exact contract.
   * Omitted: no variants of any kind, only the untouched original is hashed. */
  video?: {
    /** Which named presets to generate. Omitted/empty: no video transcoding at all. */
    breakpoints?: VideoBreakpointName[]
    /** Which containers to produce PER breakpoint. Omitted: exactly one, matching the source's
     * own container (see `media-plugin.ts`'s own doc on `defaultFormatFor`). */
    formats?: ('mp4' | 'webm')[]
  }
  /** Thumbnail extraction policy — see `media-plugin.ts`'s own doc for the exact contract. Omitted:
   * no thumbnail is ever produced. */
  thumbnails?: {
    /** Same meaning as `ThumbnailOptions.atSeconds` — default `1`. */
    atSeconds?: number
    /** Same meaning as `ThumbnailOptions.width` — omitted keeps the source frame's own real
     * width. */
    width?: number
    /** Which image format(s) to extract. Omitted: `['jpeg']`. */
    formats?: ('jpeg' | 'png' | 'webp')[]
  }
  /** Voice/speech-only audio optimization — see `media-plugin.ts`'s own doc for the exact contract
   * and `modules/media/audio/policies/voice.ts` for the full product rationale. Omitted entirely:
   * no audio file is even scanned by this plugin (existing `assetsPlugin` behavior for `.wav`/
   * `.mp3`/etc. stays completely unchanged). */
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
  /** Persists `video`/`thumbnails`/`audio.voice` results ACROSS builds — see `media-plugin.ts`'s
   * own doc. Omitted (the default): every build re-transcodes/re-extracts from scratch. */
  cacheDir?: string
}
