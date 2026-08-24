/**
 * The one adapter in `modules/media/audio/` that knows a real `ffmpeg`/`ffprobe` binary exists —
 * `Deno.Command` only, same convention `../system-ffmpeg-transcoder.ts` already establishes for
 * video. This file stays PROFILE-AGNOSTIC at its own top level (`transcode()`'s own control flow
 * never mentions "voice") and dispatches into `./policies/voice.ts` for every profile-specific
 * decision (codec, container extension, transform id) — see `audio-transcoder.ts`'s own doc for the
 * full reasoning.
 *
 * **Capability check: deliberately reuses `probeFfmpegAvailability()` as-is, unmodified.** `aac`
 * and `libopus` are ALREADY unconditional members of `../ffmpeg-availability.ts`'s own
 * `REQUIRED_ENCODERS` list (baseline for VIDEO's own embedded audio track, confirmed reading that
 * file directly) — meaning whenever `probeFfmpegAvailability().available` is `true`, both audio
 * encoders this profile needs are ALREADY guaranteed present, with zero new subprocess call, zero
 * new memoized cache, and zero new Docker/provisioning change. A fully independent audio-only probe
 * was considered and deliberately NOT built: the only scenario it would meaningfully change is a
 * hypothetical LGPL-minimal ffmpeg build with `aac`/`libopus` but no `libx264` — a build this
 * framework's own Docker provisioning (`apt-get install ffmpeg`) always ships all four together on
 * the base image this framework targets, so that build never occurs. Revisit if that assumption
 * ever stops holding.
 *
 * **Never-worsen, this profile's own definition (from `policies/voice.ts`'s own product mandate)**:
 * pure byte-size comparison, strictly `<` (an equal-or-larger result is always discarded) — never
 * video's own 1.5% margin (audio has no comparable precedent this codebase would port that number
 * from).
 *
 * **A real conflict, surfaced rather than silently resolved**: video's own never-worsen is
 * deliberately scoped to SAME-CONTAINER re-encodes only, for a documented reason (`../system-
 * ffmpeg-transcoder.ts`'s own doc): "a real format CONVERSION has no valid 'original' to substitute
 * at a differently-formatted outputPath; discarding the conversion and copying raw source bytes to
 * a target-named destination would produce a mislabeled, broken file." Voice's own transform is
 * ALWAYS a cross-format conversion (source `.wav`, target `.m4a`/`.opus` — never the same
 * container), so that exact scenario is the ONLY one this profile ever faces — applying video's own
 * documented principle (not inventing a new one): when the encode is not strictly smaller, this
 * adapter still writes the source's own untouched bytes to `outputPath` (so a direct caller of this
 * port always gets SOME real, valid file back, mirroring video's own return contract) but reports
 * `mimeType`/`format` for what is ACTUALLY there — the SOURCE's real type, never the fictitious
 * target one (matching `cached-video-transcoder.ts`'s own neverWorsened-replay convention, which
 * already does exactly this for video). The one additional rule this creates for any CALLER
 * publishing a manifest entry from this result (see `modules/bundler/media-plugin.ts`'s own doc):
 * a `neverWorsened` result must never be published under the target's own `.m4a`/`.opus`-named
 * manifest key — doing so would be exactly the "mislabeled, broken file" video's own doc warns
 * against. The untouched original (already published separately, unconditionally) is the correct,
 * safe representation in that case.
 *
 * **Sample rate/channels: never touched** — no `-ar`/`-ac` flag is ever added; ffmpeg's own default
 * re-encode behavior preserves both. AAC preserves the source's real sample rate exactly (44100
 * stays 44100); Opus ALWAYS outputs 48000Hz regardless of the source's own rate — a hard, intrinsic
 * property of the Opus bitstream itself (every real Opus encoder does this; there is no flag to
 * avoid it), not a resampling policy this adapter chose. `AudioTranscodeResult.sampleRateHz` reports
 * the REAL output value (via `probeSourceAudio` on the finished file), never the source's own
 * echoed-back value, so this constraint is always honestly surfaced rather than silently
 * misreported. Channels are preserved by both codecs: mono stays mono, stereo stays stereo.
 *
 * **Input eligibility (`.wav`-only for voice) is enforced HERE, at the adapter's own dispatch
 * point — not just in `mediaPlugin`'s own scan filter.** `transcode()` calls
 * `validateAudioInput(input, options)` (this file's own second profile-dispatch function, alongside
 * `resolveVoiceEncoding`) as the very first thing it does, before `probeFfmpegAvailability()`,
 * before any `ffmpeg` subprocess is even considered. The actual `.wav`-only RULE lives in
 * `policies/voice.ts`'s own `validateVoiceSource` — this file only routes to it, staying
 * profile-agnostic at its own top level. This is what guarantees every caller of `transformAudio()`
 * (`mediaPlugin`, a direct `AssetTransformer` caller, a future runtime/HTTP Asset API) gets the
 * EXACT same guardrail — `mediaPlugin`'s own early filter is a real, worthwhile optimization (skips
 * even scanning an ineligible file at build time) but was never meant to be the ONLY barrier.
 *
 * @module
 */

import { InternalError } from '@zanix/errors'
import { contentTypeFor } from '../../assets/content-type.ts'
import { probeFfmpegAvailability } from '../ffmpeg-availability.ts'
import { probeSourceAudio } from './ffprobe-audio.ts'
import {
  codecForVoiceFormat,
  extensionForVoiceFormat,
  validateVoiceSource,
  VOICE_DEFAULT_BITRATE_KBPS,
} from './policies/voice.ts'
import type {
  AudioTranscodeInput,
  AudioTranscoder,
  AudioTranscodeResult,
  AudioTransformOptions,
} from './audio-transcoder.ts'

/** Same margin semantics as `pickSmaller` (`modules/assets/image-optimize.ts`) — strictly smaller
 * wins, any improvement at all counts — never video's own 1.5% margin. See this module's own doc
 * for why: audio has no comparable precedent for a percentage margin to port. */
function isStrictlySmaller(candidateSize: number, sourceSize: number): boolean {
  return candidateSize < sourceSize
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot + 1).toLowerCase()
}

/**
 * Enforces ONE profile's own input-eligibility rule — a SECOND, distinct dispatch point from
 * {@linkcode resolveVoiceEncoding} below (that one resolves ENCODING parameters; this one decides
 * whether `input.sourcePath` is even a legal source for `options.profile` at all). Deliberately
 * kept as its own function rather than folded into `resolveVoiceEncoding` — "is this input
 * acceptable" and "what encoding parameters apply" are different questions, and a future profile
 * with input rules but no encoding-parameter resolution (or vice versa) shouldn't be forced through
 * one combined function.
 *
 * Called as the very FIRST thing `transcode()` does — before `probeFfmpegAvailability()`, before
 * any real `ffmpeg` subprocess is even considered — so an invalid input is rejected identically
 * regardless of ffmpeg's own availability, and regardless of whether the caller is `mediaPlugin`
 * (which also filters early, as a real but NON-exclusive optimization — see its own doc), a direct
 * `AssetTransformer.transformAudio()` caller, or a future runtime/HTTP Asset API. The actual RULE
 * (`.wav`-only) lives entirely in `policies/voice.ts`'s own `validateVoiceSource` — this function
 * only routes to it; see that function's own doc for the full rationale. A future profile adds its
 * own `case` here and its own `policies/*.ts` validation rule — never by widening `voice`'s own. */
function validateAudioInput(input: AudioTranscodeInput, options: AudioTransformOptions): void {
  switch (options.profile) {
    case 'voice':
      validateVoiceSource(input.sourcePath)
      return
    default: {
      const exhaustive: never = options.profile
      throw new InternalError(`Unknown audio transform profile: "${exhaustive}".`, {
        code: 'SPACE_MEDIA_AUDIO_UNKNOWN_PROFILE',
      })
    }
  }
}

/** Resolves ONE profile's own real codec/container/bitrate/transform-id — the ONLY place this
 * adapter dispatches on `options.profile` for ENCODING parameters (see
 * {@linkcode validateAudioInput} above for the separate input-eligibility dispatch). A future
 * profile adds its own `case` here (and its own `policies/*.ts` module) — never a change to
 * `transcode()`'s own control flow below. */
function resolveVoiceEncoding(
  options: AudioTransformOptions,
): { codec: string; extension: string; bitrateKbps: number } {
  switch (options.profile) {
    case 'voice':
      return {
        codec: codecForVoiceFormat(options.format),
        extension: extensionForVoiceFormat(options.format),
        bitrateKbps: options.bitrateKbps ?? VOICE_DEFAULT_BITRATE_KBPS,
      }
    default: {
      // Exhaustiveness guard — TypeScript itself rejects an unhandled future union member at
      // compile time; this is the runtime mirror of that same guarantee.
      const exhaustive: never = options.profile
      throw new InternalError(`Unknown audio transform profile: "${exhaustive}".`, {
        code: 'SPACE_MEDIA_AUDIO_UNKNOWN_PROFILE',
      })
    }
  }
}

/** Inputs to {@linkcode buildAudioTranscodeArgs}. */
export interface AudioTranscodeArgsParams {
  /** Filesystem path to the source audio file. */
  sourcePath: string
  /** Filesystem path ffmpeg writes the encoded output to. */
  outputPath: string
  /** ffmpeg audio codec name to encode with (e.g. `'aac'`, `'libopus'`). */
  codec: string
  /** Target audio bitrate, in kbps, passed to ffmpeg's `-b:a`. */
  bitrateKbps: number
}

/** Builds the real `ffmpeg` argv for one `transcode()` call — pure, no subprocess involved, same
 * testability reasoning as `../system-ffmpeg-transcoder.ts`'s own `buildTranscodeArgs`.
 *
 * `-vn`: defensively drops any video/attached-pic stream (some audio containers carry embedded
 * cover art as one) — the source this profile accepts (`.wav`) never has one, but this keeps the
 * argument builder correct regardless. `-map_metadata -1`: strips arbitrary source
 * tags/artwork, same privacy/determinism reasoning `buildTranscodeArgs` already documents for
 * video. No `-ar`/`-ac` — see this module's own doc for why sample rate/channels are never
 * touched. */
export function buildAudioTranscodeArgs(params: AudioTranscodeArgsParams): string[] {
  return [
    '-y',
    '-i',
    params.sourcePath,
    '-map_metadata',
    '-1',
    '-vn',
    '-c:a',
    params.codec,
    '-b:a',
    `${params.bitrateKbps}k`,
    params.outputPath,
  ]
}

function unavailableError(reason: string | undefined, detail: string | undefined): InternalError {
  return new InternalError(
    `System ffmpeg is not available for voice audio transcoding (${reason}): ${detail}`,
    { code: 'SPACE_MEDIA_FFMPEG_UNAVAILABLE' },
  )
}

/** Moves `from` to `to`, tolerating a cross-device rename failure — same reasoning
 * `../system-ffmpeg-transcoder.ts`'s own `moveFile` already documents. */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await Deno.rename(from, to)
  } catch {
    await Deno.copyFile(from, to)
    await Deno.remove(from)
  }
}

/**
 * The one real adapter this package ships for audio. See this module's own doc for the full
 * capability/never-worsen/sample-rate reasoning.
 */
export function createSystemFfmpegAudioTranscoder(): AudioTranscoder {
  return {
    probe: probeFfmpegAvailability,

    async transcode(
      input: AudioTranscodeInput,
      options: AudioTransformOptions,
    ): Promise<AudioTranscodeResult> {
      // Input eligibility is checked FIRST, before ffmpeg availability is even probed — an
      // invalid source is rejected identically for every caller of `transformAudio()`, not just
      // `mediaPlugin`'s own early scan filter. See `validateAudioInput`'s own doc.
      validateAudioInput(input, options)

      const { codec, extension, bitrateKbps } = resolveVoiceEncoding(options)
      const mimeType = contentTypeFor(`x.${extension}`)

      const availability = await probeFfmpegAvailability()
      if (!availability.available) {
        if (options.onUnavailable !== 'passthrough') {
          throw unavailableError(availability.reason, availability.detail)
        }
        await Deno.copyFile(input.sourcePath, options.outputPath)
        // Deliberately NO `probeSourceAudio` call here — ffprobe itself may not be usable in this
        // exact branch (that's the whole reason `onUnavailable: 'passthrough'` exists). See
        // `AudioTranscodeResult`'s own doc for why sampleRateHz/channels/durationSeconds are
        // optional specifically to cover this case honestly, rather than crashing or guessing.
        const { size } = await Deno.stat(options.outputPath)
        return {
          outputPath: options.outputPath,
          bytesWritten: size,
          mimeType: contentTypeFor(input.sourcePath),
          format: extensionOf(input.sourcePath),
          passthrough: true,
          neverWorsened: false,
        }
      }

      const tempOutput = await Deno.makeTempFile({ suffix: `.${extension}` })

      try {
        const args = buildAudioTranscodeArgs({
          sourcePath: input.sourcePath,
          outputPath: tempOutput,
          codec,
          bitrateKbps,
        })

        const { success, stderr } = await new Deno.Command('ffmpeg', {
          args,
          stdout: 'null',
          stderr: 'piped',
        }).output()

        if (!success) {
          // No partial output is ever published — the temp file (if any bytes were written before
          // the failure) is cleaned up in the `finally` block below, never moved to `outputPath`.
          throw new InternalError(
            `ffmpeg failed to transcode "${input.sourcePath}": ${
              new TextDecoder().decode(stderr).trim()
            }`,
            { code: 'SPACE_MEDIA_FFMPEG_TRANSCODE_FAILED' },
          )
        }

        const sourceStat = await Deno.stat(input.sourcePath)
        const tempStat = await Deno.stat(tempOutput)

        // Never-worsen — see this module's own doc: unconditional, strict `<`, never video's own
        // "same container" carve-out or 1.5% margin.
        const neverWorsened = !isStrictlySmaller(tempStat.size, sourceStat.size)

        if (neverWorsened) {
          await Deno.copyFile(input.sourcePath, options.outputPath)
        } else {
          await moveFile(tempOutput, options.outputPath)
        }

        const sourceInfo = await probeSourceAudio(options.outputPath)
        const finalStat = await Deno.stat(options.outputPath)
        return {
          outputPath: options.outputPath,
          bytesWritten: finalStat.size,
          // Never-worsened: `outputPath` actually holds the SOURCE's own untouched bytes (see this
          // module's own doc) — reported honestly as the source's real type, never the target's.
          mimeType: neverWorsened ? contentTypeFor(input.sourcePath) : mimeType,
          format: neverWorsened ? extensionOf(input.sourcePath) : extension,
          sampleRateHz: sourceInfo.sampleRateHz,
          channels: sourceInfo.channels,
          durationSeconds: sourceInfo.durationSeconds,
          passthrough: false,
          neverWorsened,
        }
      } finally {
        // Cleanup guaranteed on EVERY path — a failed/discarded encode never lingers on disk.
        await Deno.remove(tempOutput).catch(() => {})
      }
    },
  }
}
