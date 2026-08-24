/**
 * Probes a SPECIFIC audio file's own real properties via `ffprobe` — the audio-only sibling of
 * `../ffprobe-media.ts`'s own `probeSourceVideo`, same separation of concerns (runtime availability
 * vs. this specific file's own content) and same reasoning for why `parseFfprobeOutput`-equivalent
 * parsing is kept pure and independently testable from the real subprocess call.
 *
 * Deliberately NOT a generalization of `ffprobe-media.ts`'s own `SourceVideoInfo`/
 * `parseFfprobeOutput` into one shared "media info" shape: video's own fields (`widthPx`/`heightPx`/
 * `hasAudio`) have no audio-file equivalent, and forcing one shared interface would mean either
 * video growing meaningless audio-only fields or audio growing meaningless video-only ones. Real,
 * separate ffprobe JSON field names — `sample_rate`, `channels` — as reported by a real
 * `ffprobe -show_streams` run.
 *
 * @module
 */

import { InternalError } from '@zanix/errors'

/** A source (or transcoded output) audio file's own real properties, as read by `ffprobe`. */
export interface SourceAudioInfo {
  /** Real sample rate, in Hz, as reported by ffprobe's audio stream. */
  sampleRateHz: number
  /** Real channel count as reported by ffprobe's audio stream. */
  channels: number
  /** `undefined` when neither the audio stream nor the container reports a bitrate — rare for a
   * real file, but not treated as an error: `system-ffmpeg-audio-transcoder.ts` never needs this
   * value to cap anything (see this profile's own doc: audio bitrate is a single fixed target, not
   * a source-capped ceiling the way video's own width/bitrate are). */
  bitRateKbps?: number
  /** Duration, in seconds, from the container format; `undefined` if ffprobe reports none. */
  durationSeconds?: number
  /** Real codec name reported for the audio stream (e.g. `'aac'`, `'opus'`, `'pcm_s16le'`). */
  codecName?: string
}

// Quoted keys — ffprobe's own real JSON field names, not identifiers this module chose the casing
// of. Mirrors `ffprobe-media.ts`'s own `FfprobeStream`/`FfprobeFormat` shape.
interface FfprobeAudioStream {
  'codec_type'?: string
  'codec_name'?: string
  'sample_rate'?: string
  channels?: number
  'bit_rate'?: string
}

interface FfprobeAudioFormat {
  'bit_rate'?: string
  duration?: string
}

interface FfprobeAudioOutput {
  streams?: FfprobeAudioStream[]
  format?: FfprobeAudioFormat
}

/**
 * Parses `ffprobe -show_format -show_streams -print_format json`'s own raw output into
 * {@linkcode SourceAudioInfo}. Pure — see {@linkcode probeSourceAudio}'s own doc for why parsing is
 * kept separate from the real subprocess call.
 *
 * @throws {InternalError} If `raw` isn't valid JSON, or no audio stream is reported with a real
 * sample rate/channel count.
 */
export function parseFfprobeAudioOutput(raw: string, sourcePath: string): SourceAudioInfo {
  let parsed: FfprobeAudioOutput
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new InternalError(
      `ffprobe's own output for "${sourcePath}" was not valid JSON.`,
      { code: 'SPACE_MEDIA_FFPROBE_INVALID_OUTPUT' },
    )
  }

  const audioStream = parsed.streams?.find((stream) => stream.codec_type === 'audio')
  if (
    !audioStream || audioStream.sample_rate === undefined || audioStream.channels === undefined
  ) {
    throw new InternalError(
      `"${sourcePath}" has no audio stream ffprobe could report sample_rate/channels for — is ` +
        `this actually an audio file?`,
      { code: 'SPACE_MEDIA_FFPROBE_NO_AUDIO_STREAM' },
    )
  }

  const formatBitRateKbps = parsed.format?.bit_rate
    ? Number(parsed.format.bit_rate) / 1000
    : undefined
  const bitRateKbps = audioStream.bit_rate ? Number(audioStream.bit_rate) / 1000 : formatBitRateKbps

  return {
    sampleRateHz: Number(audioStream.sample_rate),
    channels: audioStream.channels,
    bitRateKbps: bitRateKbps !== undefined && Number.isFinite(bitRateKbps)
      ? bitRateKbps
      : undefined,
    durationSeconds: parsed.format?.duration ? Number(parsed.format.duration) : undefined,
    codecName: audioStream.codec_name,
  }
}

/**
 * Runs real `ffprobe` on `sourcePath` and parses its own output into {@linkcode SourceAudioInfo}.
 * Assumes `ffprobe` IS available — call `probeFfmpegAvailability` (`../ffmpeg-availability.ts`)
 * first; this never checks that itself, same split `probeSourceVideo` already establishes.
 *
 * @throws {InternalError} If ffprobe itself fails to run, exits with an error, or its output
 * doesn't describe a readable audio stream — see {@linkcode parseFfprobeAudioOutput}.
 */
export async function probeSourceAudio(sourcePath: string): Promise<SourceAudioInfo> {
  let success: boolean
  let stdout: Uint8Array
  let stderr: Uint8Array
  try {
    ;({ success, stdout, stderr } = await new Deno.Command('ffprobe', {
      args: ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', sourcePath],
      stdout: 'piped',
      stderr: 'piped',
    }).output())
  } catch (error) {
    throw new InternalError(
      `Failed to run ffprobe on "${sourcePath}": ${
        error instanceof Error ? error.message : String(error)
      }`,
      { code: 'SPACE_MEDIA_FFPROBE_EXEC_FAILED' },
    )
  }
  if (!success) {
    throw new InternalError(
      `ffprobe exited with an error reading "${sourcePath}": ${
        new TextDecoder().decode(stderr).trim()
      }`,
      { code: 'SPACE_MEDIA_FFPROBE_EXIT_ERROR' },
    )
  }
  return parseFfprobeAudioOutput(new TextDecoder().decode(stdout), sourcePath)
}
