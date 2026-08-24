/**
 * The one adapter in `modules/media/` that knows a real `ffmpeg`/`ffprobe` binary exists —
 * everything else here is either the port (`video-transcoder.ts`) or pure logic (breakpoints,
 * encoder-detection text parsing) that doesn't know or care HOW a `VideoTranscoder` is actually
 * implemented. `Deno.Command` only, no `fluent-ffmpeg`.
 *
 * This package never installs an `ffmpeg`/`ffprobe` binary itself, only detects and uses one
 * that's already present. Auto-provisioning via a postinstall-download mechanism (the approach
 * npm packages like `ffmpeg-static`/`ffprobe-static` use) doesn't work under Deno — postinstall
 * scripts are sandboxed — so no equivalent is implemented here: Docker or a bare host is expected
 * to provide the binary directly; Deno Deploy's standard runtime cannot run one at all — see
 * `ffmpeg-availability.ts`'s own `'unsupported-runtime'`.
 *
 * This adapter builds on the breakpoint presets in `video-breakpoints.ts`, the codec-by-container
 * mapping below, source-aware "never exceed the source" width/bitrate capping via `ffprobe`, and a
 * "never worsen" rule with a 1.5% margin (see `NEVER_WORSEN_MARGIN` below).
 *
 * Key design decisions, each with its own real argument:
 * - **Temp file handling.** This adapter writes to a real OS temp file via `Deno.makeTempFile` and
 *   removes it in a `finally` block on every path — success and failure alike — so a partial or
 *   discarded encode never lingers on disk.
 * - **`scale=width:-2`, not a hand-computed height.** Deriving height by hand
 *   (`Math.round(width * sourceHeight / sourceWidth)`) gives no guarantee of an even result, and
 *   many encoders (h264 among them) reject an odd dimension. `-2` (not ffmpeg's own `-1`) forces an
 *   even result while still preserving aspect ratio.
 * - **Capped-CRF/CQ, calibrated per breakpoint.** A reproducible benchmark (per-breakpoint
 *   VMAF/SSIM, Y4M-normalized, with a quality floor anchored to this codebase's own
 *   `product-marketing`-fixture measurements, never an arbitrary external VMAF number) found a
 *   quality-targeted mode that saves real bytes at every breakpoint without dropping below that
 *   floor, compared to plain bitrate-targeted ABR (`-b:v` alone). The two codecs do NOT share one
 *   mechanism:
 *   - **x264 (`mp4`): capped-CRF** — `-crf <video-breakpoints.ts x264Crf> -maxrate
 *     <videoBitrateKbps>k -bufsize <2×videoBitrateKbps>k`. `-maxrate`/`-bufsize` is a REAL, passive
 *     ceiling here: a control encode with a deliberately generous cap produces byte-identical
 *     output to the same `-crf` with no cap at all. Safe to treat `videoBitrateKbps` as an actual
 *     ceiling for this codec.
 *   - **VP9 (`webm`): CQ (constrained quality)** — `-crf <vp9Crf> -b:v <vp9TargetBitrateKbps>k`.
 *     `-b:v` here is NOT a ceiling, despite the superficially identical flag name. On this build
 *     (ffmpeg 9.0.1/libvpx 1.16.0), `-minrate`/`-maxrate`/`-bufsize` alongside `-crf` either error
 *     outright (libvpx refuses rate-control params with no bitrate at all) or, once `-b:v` is also
 *     present, change not one byte of output — libvpx's CQ mode ignores them entirely. `-b:v`
 *     instead acts as an ACTIVE bias that dominates the real output — content demanding far more
 *     than its nominal value can still land well below it (a 2000kbps-demand encode lands at
 *     794kbps with `-crf 15 -b:v 1000k`), and once it's set low enough to matter, `-crf` stops
 *     changing the output at all (byte-identical files across `-crf 26/32/38` at the calibrated
 *     `dmd`/`dlg` bitrates). This is why `video-breakpoints.ts` gives VP9 its own, separate
 *     `vp9TargetBitrateKbps` field instead of reusing `videoBitrateKbps` with a different meaning
 *     attached.
 *   `-preset` is kept for `libx264` (compatible with either mode, only affects encode
 *   speed/efficiency); `libvpx-vp9` has no `-preset` of its own, using `-deadline`/`-cpu-used`
 *   instead — never assumed identical to x264's own flag.
 * - **No `-t 180` duration cap.** No duration limiting of any kind happens here — a fixed cap
 *   would silently truncate any source longer than it, which is never a valid general policy for a
 *   library transcoding arbitrary caller-supplied video.
 * - **Errors `throw`, never `process.exit`.** Calling `process.exit` on failure is appropriate for
 *   a one-shot build CLI, never for a library a long-running server might call mid-request —
 *   killing the whole process over one failed transcode is not this package's call to make; every
 *   failure throws an `InternalError` instead.
 * - **No hashing, manifest registration, or `mode==='production'` path-string surgery.** None of
 *   that is this port's job — see `video-transcoder.ts`'s own doc for why (a bundler-layer
 *   concern, symmetric to how `image-optimize.ts` doesn't do its own manifest writing either).
 * - **No `.m3u8`/HLS support.** Segmentation/manifest generation for adaptive streaming is out of
 *   scope entirely — only direct `mp4`/`webm` output is supported.
 *
 * @module
 */

import { InternalError } from '@zanix/errors'
import { contentTypeFor } from '../assets/content-type.ts'
import { probeFfmpegAvailability } from './ffmpeg-availability.ts'
import { probeSourceVideo } from './ffprobe-media.ts'
import { MAX_AUDIO_BITRATE_KBPS, resolveVideoBreakpoint } from './video-breakpoints.ts'
import type {
  ThumbnailOptions,
  ThumbnailResult,
  TranscodeInput,
  TranscodeOptions,
  TranscodeResult,
  VideoTranscoder,
} from './video-transcoder.ts'

/**
 * The "never worsen" margin for VIDEO output (`outputSize >= originalSize - originalSize * 0.015`)
 * — NOT the same rule as `modules/assets/image-optimize.ts`'s own `pickSmaller`, despite both
 * being called "never worsen": `pickSmaller` requires a candidate to be STRICTLY smaller (`<`, a
 * 0% margin — any improvement at all wins), while this video rule requires at least 1.5% smaller
 * before discarding the transcode. Two genuinely different thresholds for two genuinely different
 * kinds of output — kept distinct on purpose, not unified into one shared constant/rule that would
 * silently change either one's real, verified behavior.
 */
const NEVER_WORSEN_MARGIN = 0.015

/** The codec-by-container mapping this transcoder implements. Exported — pure, no subprocess
 * involved — so this exact mapping is directly unit-testable without a real ffmpeg binary. */
export function codecsForFormat(
  format: 'mp4' | 'webm',
): { videoCodec: string; audioCodec: string } {
  return format === 'webm'
    ? { videoCodec: 'libvpx-vp9', audioCodec: 'libopus' }
    : { videoCodec: 'libx264', audioCodec: 'aac' }
}

/** `libvpx-vp9` has no `-preset` of its own (unlike `libx264`) — its own speed/quality knob is
 * `-deadline`/`-cpu-used`. `'good'`/`2` is a conservative, documented middle ground (ffmpeg's own
 * docs recommend `-cpu-used` 0-5 for VOD, lower = slower/better). Not exposed as an option: not
 * asked for, and picking a per-codec knob correctly needs real codec-specific knowledge a generic
 * option wouldn't safely generalize. */
export function speedFlagsFor(format: 'mp4' | 'webm'): string[] {
  return format === 'webm' ? ['-deadline', 'good', '-cpu-used', '2'] : ['-preset', 'slow']
}

export function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot + 1).toLowerCase()
}

/** Matches the SOURCE's own container when it's already `.webm`; `'mp4'` otherwise — a real
 * conversion (e.g. `.mov` → `mp4`) is the default for anything that isn't already one of the two
 * containers this transcoder supports. */
export function defaultFormatFor(sourcePath: string): 'mp4' | 'webm' {
  return extensionOf(sourcePath) === 'webm' ? 'webm' : 'mp4'
}

export interface TranscodeArgsParams {
  sourcePath: string
  outputPath: string
  format: 'mp4' | 'webm'
  /** Already capped against the source's own real width/bitrate — this function only builds
   * arguments, it never re-derives or re-clamps anything itself. */
  width: number
  /** Already resolved for THIS format's own codec by the caller: x264's real `-maxrate` ceiling
   * for `mp4`, VP9's own independent CQ bitrate for `webm` — never the same field reused with two
   * meanings (see `video-breakpoints.ts`'s own doc on `vp9TargetBitrateKbps`). */
  videoBitrateKbps: number
  /** `undefined` means no audio stream on the source — `-an`, not an audio codec/bitrate pair. */
  audioBitrateKbps?: number
  /** The calibrated CRF/CQ value for this format's codec, already resolved by the caller
   * (`breakpoint.x264Crf` for `mp4`, `breakpoint.vp9Crf` for `webm`). `undefined` falls back to
   * plain bitrate-targeted ABR (`-b:v` alone, no `-crf`) — the pre-calibration behavior, currently
   * unused by any breakpoint in `video-breakpoints.ts` but kept as the honest fallback for any
   * future preset/override that doesn't carry one. */
  crf?: number
}

/**
 * Builds the real `ffmpeg` argv for one `transcode()` call — pure, no subprocess involved, so the
 * exact flags this adapter sends (codec selection, `-map_metadata -1`, `scale=width:-2`, bitrate
 * targeting, audio presence) are all directly unit-testable without a real ffmpeg binary. Only
 * `transcode()` itself needs one, to actually RUN these args.
 */
export function buildTranscodeArgs(params: TranscodeArgsParams): string[] {
  const { videoCodec, audioCodec } = codecsForFormat(params.format)
  const args = [
    '-y',
    '-i',
    params.sourcePath,
    '-map_metadata',
    '-1',
    // -2 (not ffmpeg's own -1): guarantees an EVEN height, a real requirement several encoders
    // (h264 among them) impose — see this module's own doc for why a hand-computed height isn't
    // used instead.
    '-vf',
    `scale=${params.width}:-2`,
    '-c:v',
    videoCodec,
  ]

  if (params.crf === undefined) {
    // Plain bitrate-targeted ABR — no calibrated crf for this breakpoint/codec. Not currently hit
    // by any `video-breakpoints.ts` preset (the calibration found a real crf/CQ config for every
    // one), kept as the honest fallback for a future preset/override that doesn't carry one.
    args.push('-b:v', `${params.videoBitrateKbps}k`)
  } else if (params.format === 'mp4') {
    // x264 capped-CRF: `-maxrate`/`-bufsize` is a REAL, passive ceiling here (see this module's
    // own doc), built from the same `videoBitrateKbps` value the plain-ABR branch above targets
    // directly.
    const bufsizeKbps = params.videoBitrateKbps * 2
    args.push(
      '-crf',
      String(params.crf),
      '-maxrate',
      `${params.videoBitrateKbps}k`,
      '-bufsize',
      `${bufsizeKbps}k`,
    )
  } else {
    // VP9 CQ (constrained quality): `-b:v` here is NOT a ceiling — it's an active bias libvpx
    // applies regardless of whether a passive cap could ever be reached (see this module's own
    // doc). Never treat this value as interchangeable with x264's `-maxrate` above, even though
    // the flag itself is the same `-b:v`.
    args.push('-crf', String(params.crf), '-b:v', `${params.videoBitrateKbps}k`)
  }

  args.push(...speedFlagsFor(params.format))

  if (params.audioBitrateKbps !== undefined) {
    args.push('-c:a', audioCodec, '-b:a', `${params.audioBitrateKbps}k`)
  } else {
    args.push('-an')
  }
  args.push('-f', params.format, params.outputPath)
  return args
}

export interface ThumbnailArgsParams {
  sourcePath: string
  outputPath: string
  atSeconds: number
  width?: number
  format?: 'jpeg' | 'png' | 'webp'
}

/** Builds the real `ffmpeg` argv for one `extractThumbnail()` call — same pure/testable reasoning
 * as {@linkcode buildTranscodeArgs}.
 *
 * `format: 'webp'` explicitly forces `-c:v libwebp` — ffmpeg's own automatic encoder selection for
 * a bare `.webp` output picks `libwebp_anim` (the ANIMATED encoder) instead, which fails outright
 * on this single-frame case ("Cannot allocate memory", reproduced against the exact ffmpeg build
 * this framework's own Docker image provisions). `jpeg`/`png` never had this ambiguity (only one
 * sensible encoder exists for either extension) so they're left to ffmpeg's own default selection,
 * unchanged. */
export function buildThumbnailArgs(params: ThumbnailArgsParams): string[] {
  const args = [
    '-y',
    '-ss',
    String(params.atSeconds),
    '-i',
    params.sourcePath,
    '-frames:v',
    '1',
  ]
  if (params.format === 'webp') {
    args.push('-c:v', 'libwebp')
  }
  if (params.width !== undefined) {
    args.push('-vf', `scale=${params.width}:-2`)
  }
  args.push(params.outputPath)
  return args
}

/** Moves `from` to `to`, tolerating a cross-device rename failure (the OS temp directory and a
 * caller-chosen `outputPath` are not guaranteed to share one filesystem/mount — a real,
 * platform-independent gap `Deno.rename` alone doesn't cover) by falling back to copy+remove. */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await Deno.rename(from, to)
  } catch {
    await Deno.copyFile(from, to)
    await Deno.remove(from)
  }
}

function unavailableError(reason: string | undefined, detail: string | undefined): InternalError {
  return new InternalError(`System ffmpeg is not available (${reason}): ${detail}`, {
    code: 'SPACE_MEDIA_FFMPEG_UNAVAILABLE',
  })
}

/**
 * The one real adapter this package ships. See this module's own doc for the codec/quality
 * calibration and design decisions behind it, and `video-transcoder.ts`'s own doc for the port
 * this implements.
 */
export function createSystemFfmpegTranscoder(): VideoTranscoder {
  return {
    probe: probeFfmpegAvailability,

    async transcode(input: TranscodeInput, options: TranscodeOptions): Promise<TranscodeResult> {
      const format = options.format ?? defaultFormatFor(input.sourcePath)
      const mimeType = contentTypeFor(`x.${format}`)

      const availability = await probeFfmpegAvailability()
      if (!availability.available) {
        if (options.onUnavailable !== 'passthrough') {
          throw unavailableError(availability.reason, availability.detail)
        }
        await Deno.copyFile(input.sourcePath, options.outputPath)
        const { size } = await Deno.stat(options.outputPath)
        return {
          outputPath: options.outputPath,
          bytesWritten: size,
          mimeType: contentTypeFor(input.sourcePath),
          passthrough: true,
          neverWorsened: false,
        }
      }

      const sourceInfo = await probeSourceVideo(input.sourcePath)
      const breakpoint = resolveVideoBreakpoint(options.breakpoint, {
        width: options.width,
        videoBitrateKbps: options.videoBitrateKbps,
      })

      // Never exceed the source's own real quality — a breakpoint's width/bitrate is only ever a
      // ceiling, capped against what the source actually has.
      const width = Math.min(breakpoint.width, sourceInfo.widthPx)
      const audioBitrateKbps = sourceInfo.hasAudio
        ? Math.min(MAX_AUDIO_BITRATE_KBPS, sourceInfo.audioBitrateKbps ?? MAX_AUDIO_BITRATE_KBPS)
        : undefined

      // x264's real `-maxrate` ceiling and VP9's own, independent CQ bitrate are two different
      // numbers with two different meanings (see video-breakpoints.ts's own doc on
      // `vp9TargetBitrateKbps`) — resolved here, per format, never conflated into one shared
      // value. Both still capped against the source's own real bitrate, same rule as before.
      const videoBitrateKbps = format === 'webm'
        ? Math.min(breakpoint.vp9TargetBitrateKbps, sourceInfo.videoBitrateKbps)
        : Math.min(breakpoint.videoBitrateKbps, sourceInfo.videoBitrateKbps)
      const crf = format === 'webm' ? breakpoint.vp9Crf : breakpoint.x264Crf

      const tempOutput = await Deno.makeTempFile({ suffix: `.${format}` })

      try {
        const args = buildTranscodeArgs({
          sourcePath: input.sourcePath,
          outputPath: tempOutput,
          format,
          width,
          videoBitrateKbps,
          audioBitrateKbps,
          crf,
        })

        const { success, stderr } = await new Deno.Command('ffmpeg', {
          args,
          stdout: 'null',
          stderr: 'piped',
        }).output()

        if (!success) {
          throw new InternalError(
            `ffmpeg failed to transcode "${input.sourcePath}": ${
              new TextDecoder().decode(stderr).trim()
            }`,
            { code: 'SPACE_MEDIA_FFMPEG_TRANSCODE_FAILED' },
          )
        }

        const sourceStat = await Deno.stat(input.sourcePath)
        const tempStat = await Deno.stat(tempOutput)

        // "Never worsen" only ever applies to a same-CONTAINER re-encode — a real format
        // CONVERSION (e.g. source .mov, requested webm) has no valid "original" to substitute at
        // a differently-formatted outputPath; discarding the conversion and copying raw .mov
        // bytes to a `.webm`-named destination would produce a mislabeled, broken file, not a
        // safe fallback. Scoped explicitly to where the comparison is meaningful.
        const sameContainer = extensionOf(input.sourcePath) === format
        const neverWorsened = sameContainer &&
          tempStat.size >= sourceStat.size * (1 - NEVER_WORSEN_MARGIN)

        if (neverWorsened) {
          await Deno.copyFile(input.sourcePath, options.outputPath)
        } else {
          await moveFile(tempOutput, options.outputPath)
        }

        const finalStat = await Deno.stat(options.outputPath)
        return {
          outputPath: options.outputPath,
          bytesWritten: finalStat.size,
          mimeType,
          passthrough: false,
          neverWorsened,
        }
      } finally {
        // Cleanup guaranteed on EVERY path — success (already moved away, so this is a safe,
        // silent miss) and failure alike: a partial/discarded encode never lingers on disk.
        await Deno.remove(tempOutput).catch(() => {})
      }
    },

    async extractThumbnail(
      input: TranscodeInput,
      options: ThumbnailOptions,
    ): Promise<ThumbnailResult> {
      const availability = await probeFfmpegAvailability()
      if (!availability.available) {
        // No passthrough here, and no `onUnavailable` option to request one — see
        // video-transcoder.ts's own doc: there is no "original" to fall back to for a thumbnail,
        // a derived asset that never existed until this call.
        throw unavailableError(availability.reason, availability.detail)
      }

      const format = options.format ?? 'jpeg'
      // WebP is a GUARANTEED, officially supported thumbnail format — never a silent best-effort
      // that happens to work on some ffmpeg builds. Checked explicitly, before ever invoking
      // ffmpeg, against the SAME capability probe already run above (no extra subprocess spawn).
      // A build missing `libwebp` throws a specific, actionable error here — it never silently
      // falls back to jpeg/png, and this transcoder never installs the missing encoder itself
      // (that's Docker/CLI provisioning's own job, see `ffmpeg-availability.ts`'s own doc).
      if (format === 'webp' && !availability.capabilities?.webpEncoder) {
        throw new InternalError(
          `System ffmpeg is missing WebP encoder support (libwebp) — required for ` +
            `extractThumbnail with format: 'webp'. Install/use an ffmpeg build with libwebp ` +
            `enabled (the Docker image this framework provisions already includes it).`,
          { code: 'SPACE_MEDIA_FFMPEG_WEBP_UNSUPPORTED' },
        )
      }
      const extension = format === 'jpeg' ? 'jpg' : format
      const mimeType = contentTypeFor(`x.${extension}`)
      const tempOutput = await Deno.makeTempFile({ suffix: `.${extension}` })

      try {
        const args = buildThumbnailArgs({
          sourcePath: input.sourcePath,
          outputPath: tempOutput,
          atSeconds: options.atSeconds ?? 1,
          width: options.width,
          format,
        })

        const { success, stderr } = await new Deno.Command('ffmpeg', {
          args,
          stdout: 'null',
          stderr: 'piped',
        }).output()

        if (!success) {
          throw new InternalError(
            `ffmpeg failed to extract a thumbnail from "${input.sourcePath}": ${
              new TextDecoder().decode(stderr).trim()
            }`,
            { code: 'SPACE_MEDIA_FFMPEG_THUMBNAIL_FAILED' },
          )
        }

        await moveFile(tempOutput, options.outputPath)
        const finalStat = await Deno.stat(options.outputPath)
        return { outputPath: options.outputPath, bytesWritten: finalStat.size, mimeType }
      } finally {
        await Deno.remove(tempOutput).catch(() => {})
      }
    },
  }
}
