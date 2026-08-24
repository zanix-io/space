/**
 * Probes a SPECIFIC source video file's own real properties via `ffprobe` — deliberately separate
 * from `ffmpeg-availability.ts`'s own `probeFfmpegAvailability`. "Is the ffmpeg/ffprobe runtime
 * usable at all" and "what does THIS file actually contain" are two different questions with two
 * different failure modes (a missing binary vs. a corrupt/non-video input); this module answers
 * only the second one, and assumes the first is already known to be true — call
 * `probeFfmpegAvailability` first.
 *
 * Reads width/height/bitrate off the video stream and bitrate off the audio stream, via a direct
 * `Deno.Command('ffprobe', …)` JSON call rather than a wrapper library like `fluent-ffmpeg`.
 *
 * @module
 */

import { InternalError } from '@zanix/errors'

/** A source video's own real properties, as read by `ffprobe` — everything
 * `SystemFfmpegTranscoder` needs to cap a breakpoint's own width/bitrate at "never exceed the
 * source" (the capping rule `system-ffmpeg-transcoder.ts` enforces). */
export interface SourceVideoInfo {
  /** Real pixel width of the video stream. */
  widthPx: number
  /** Real pixel height of the video stream. */
  heightPx: number
  /** Real video bitrate, in kbps, from the stream or (fallback) the container. */
  videoBitrateKbps: number
  /** `undefined` when the source has no audio stream at all — see `hasAudio`. */
  audioBitrateKbps?: number
  /** Duration, in seconds, from the container format; `undefined` if ffprobe reports none. */
  durationSeconds?: number
  /** Whether the source has an audio stream at all. */
  hasAudio: boolean
}

// Quoted keys — these name ffprobe's own real JSON field names verbatim, not identifiers this
// module gets to choose the casing of.
interface FfprobeStream {
  'codec_type'?: string
  width?: number
  height?: number
  'bit_rate'?: string
}

interface FfprobeFormat {
  'bit_rate'?: string
  duration?: string
}

interface FfprobeOutput {
  streams?: FfprobeStream[]
  format?: FfprobeFormat
}

/**
 * Parses `ffprobe -show_format -show_streams -print_format json`'s own raw output into
 * {@linkcode SourceVideoInfo}. Kept as its own pure function, independent of actually spawning
 * ffprobe, so the PARSING itself is unit-testable against a captured/fabricated JSON fixture
 * without a real ffprobe binary — only {@linkcode probeSourceVideo} needs one.
 *
 * A stream's own `bit_rate` field is sometimes absent (some containers don't store a per-stream
 * bitrate) — the video bitrate falls back to the container's own `format.bit_rate` in that case.
 * No such fallback exists for audio: an absent audio `bit_rate` with a real audio stream present
 * is left `undefined` rather than guessed from the container total (which would double-count the
 * video stream's own share).
 *
 * @throws {InternalError} If `raw` isn't valid JSON, no video stream is reported, or no bitrate
 * can be determined for it from either the stream or the container.
 */
export function parseFfprobeOutput(raw: string, sourcePath: string): SourceVideoInfo {
  let parsed: FfprobeOutput
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new InternalError(
      `ffprobe's own output for "${sourcePath}" was not valid JSON.`,
      { code: 'SPACE_MEDIA_FFPROBE_INVALID_OUTPUT' },
    )
  }

  const videoStream = parsed.streams?.find((stream) => stream.codec_type === 'video')
  if (!videoStream || videoStream.width === undefined || videoStream.height === undefined) {
    throw new InternalError(
      `"${sourcePath}" has no video stream ffprobe could report width/height for — is this ` +
        `actually a video file?`,
      { code: 'SPACE_MEDIA_FFPROBE_NO_VIDEO_STREAM' },
    )
  }
  const audioStream = parsed.streams?.find((stream) => stream.codec_type === 'audio')

  const formatBitRateKbps = parsed.format?.bit_rate
    ? Number(parsed.format.bit_rate) / 1000
    : undefined
  const videoBitrateKbps = videoStream.bit_rate
    ? Number(videoStream.bit_rate) / 1000
    : formatBitRateKbps
  if (videoBitrateKbps === undefined || !Number.isFinite(videoBitrateKbps)) {
    throw new InternalError(
      `Could not determine a video bitrate for "${sourcePath}" from ffprobe's own output ` +
        `(neither the video stream nor the container reported one).`,
      { code: 'SPACE_MEDIA_FFPROBE_BITRATE_UNAVAILABLE' },
    )
  }

  return {
    widthPx: videoStream.width,
    heightPx: videoStream.height,
    videoBitrateKbps,
    audioBitrateKbps: audioStream?.bit_rate ? Number(audioStream.bit_rate) / 1000 : undefined,
    durationSeconds: parsed.format?.duration ? Number(parsed.format.duration) : undefined,
    hasAudio: Boolean(audioStream),
  }
}

/**
 * Runs real `ffprobe` on `sourcePath` and parses its own output into {@linkcode SourceVideoInfo}.
 * Assumes `ffprobe` IS available — call `probeFfmpegAvailability` (`ffmpeg-availability.ts`)
 * first; this never checks that itself, to keep the two concerns (runtime vs. input) apart.
 *
 * @throws {InternalError} If ffprobe itself fails to run, exits with an error, or its output
 * doesn't describe a readable video stream — see {@linkcode parseFfprobeOutput}.
 */
export async function probeSourceVideo(sourcePath: string): Promise<SourceVideoInfo> {
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
  return parseFfprobeOutput(new TextDecoder().decode(stdout), sourcePath)
}
