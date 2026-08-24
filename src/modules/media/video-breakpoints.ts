/**
 * Named breakpoint presets for `VideoTranscoder.transcode` — `width`/`videoBitrateKbps` are
 * deliberately stable, established values, not re-derived per release: `msm`/`mlg` share the same
 * 720px width and differ only in bitrate — an unusual pairing, but a deliberate, real one, not
 * something this port invented or "fixed" without a product reason to.
 *
 * `x264Crf`/`vp9Crf`/`vp9TargetBitrateKbps` are this port's own calibration, derived from a real,
 * reproducible benchmark (per-fixture VMAF/SSIM, Y4M-normalized, against a quality floor anchored
 * to this codebase's own `product-marketing`-fixture measurements, never an arbitrary external
 * VMAF reference) run once real `ffmpeg`/`libvpx` were available. See
 * `system-ffmpeg-transcoder.ts`'s own doc for how these two encode differently despite sharing one
 * preset shape, and why VP9's own bitrate field is never called a "ceiling".
 *
 * @module
 */

/** A recognized video breakpoint preset name — unlike `ImageBreakpoint`, there is no raw
 * numeric-width form here: none was asked for. */
export type VideoBreakpointName = 'msm' | 'mlg' | 'dmd' | 'dlg'

/** The calibrated width/bitrate/quality values one named video breakpoint preset resolves to. */
export interface VideoBreakpointPreset {
  /** Max width this breakpoint represents — the real, clamped output width is
   * `Math.min(width, source's real width)`, never larger, capped via `ffprobe`-read source
   * width. */
  width: number
  /** Max video bitrate, in kbps — same capping rule applies against the source's own real
   * bitrate. Doubles as x264's own real `-maxrate`/`-bufsize` ceiling (a passive one: identical
   * output whether or not it could ever engage — see `system-ffmpeg-transcoder.ts`). Never used
   * as VP9's bitrate value — see `vp9TargetBitrateKbps`. */
  videoBitrateKbps: number
  /** x264 (`mp4`) capped-CRF quality target, calibrated per breakpoint (23/23/26/28 for
   * msm/mlg/dmd/dlg) against this breakpoint's own VMAF floor on the `product-marketing` fixture.
   * Combined with `videoBitrateKbps` as a real ceiling — see `system-ffmpeg-transcoder.ts`. */
  x264Crf: number
  /** VP9 (`webm`) CQ (constrained quality) target, alongside `vp9TargetBitrateKbps`. Calibrated
   * per breakpoint; once `vp9TargetBitrateKbps` is set low enough to matter, this value stops
   * changing the encoded output at all (`-crf` 26/32/38 produces byte-identical files at
   * dmd/dlg's own calibrated bitrate — `-b:v` alone drives the result). Kept at `30` uniformly for
   * consistency rather than treated as meaningfully tuned. */
  vp9Crf: number
  /** VP9's OWN, independent CQ bitrate — deliberately a separate field from `videoBitrateKbps`,
   * never the same number reused with a different meaning. `-b:v` in VP9's CQ mode is an ACTIVE
   * bias dominating the real output, not a passive ceiling like x264's `-maxrate` (see
   * `system-ffmpeg-transcoder.ts`) — reusing `videoBitrateKbps` here would silently misrepresent
   * what this number does. At `msm`/`mlg` a benchmark sweep found the
   * breakpoint's own `videoBitrateKbps` already a good CQ target (both fields coincide, same
   * number, different reason). At `dmd`/`dlg` the same sweep found `videoBitrateKbps` far too high
   * a CQ target to save anything over plain ABR (`-b:v` alone, no `-crf`) — an independent,
   * lower value (1000/1650 respectively — ~50%/55% of `videoBitrateKbps`) was needed before CQ
   * mode produced any real saving. Still capped against the source's own real bitrate, same rule
   * as `videoBitrateKbps`. */
  vp9TargetBitrateKbps: number
}

/** `msm`/`mlg`: mobile → mobile@2x, same 720px width as each other (bitrate is the only lever
 * between them — a deliberate pairing, not a bug this port smooths over). `dmd`/`dlg`:
 * tablet/desktop → desktop@2x/large-monitor.
 *
 * `x264Crf`/`vp9Crf`/`vp9TargetBitrateKbps`: calibrated once, from a real benchmark — see this
 * module's own doc. Every breakpoint has a real VP9 CQ config; the benchmark found a configuration
 * that beat plain `-b:v` ABR at every tier, so there is no "kept on ABR, pending calibration" case
 * left open here. */
export const VIDEO_BREAKPOINT_PRESETS: Record<VideoBreakpointName, VideoBreakpointPreset> = {
  msm: { width: 720, videoBitrateKbps: 1000, x264Crf: 23, vp9Crf: 30, vp9TargetBitrateKbps: 1000 },
  mlg: { width: 720, videoBitrateKbps: 1500, x264Crf: 23, vp9Crf: 30, vp9TargetBitrateKbps: 1500 },
  dmd: { width: 1440, videoBitrateKbps: 2000, x264Crf: 26, vp9Crf: 30, vp9TargetBitrateKbps: 1000 },
  dlg: { width: 1920, videoBitrateKbps: 3000, x264Crf: 28, vp9Crf: 30, vp9TargetBitrateKbps: 1650 },
}

/** Audio bitrate ceiling — applied regardless of which video breakpoint is chosen
 * (`Math.min(128, sourceAudioBitrate)`), deliberately the same `128` across every size tier rather
 * than varied per breakpoint. */
export const MAX_AUDIO_BITRATE_KBPS = 128

/** Per-call overrides for a single resolved breakpoint. Deliberately flat (not a
 * `Record<VideoBreakpointName, …>` map like `ImageBreakpointOverrides`) — `resolveVideoBreakpoint`
 * only ever resolves ONE named breakpoint per call (unlike `resolveImageBreakpoints`, which
 * resolves a whole array at once), so there is nothing for a name-keyed map to disambiguate. */
export interface VideoBreakpointOverrides {
  /** Overrides the resolved breakpoint's `width`. */
  width?: number
  /** Overrides the resolved breakpoint's `videoBitrateKbps`. */
  videoBitrateKbps?: number
  /** Overrides the resolved breakpoint's `x264Crf`. */
  x264Crf?: number
  /** Overrides the resolved breakpoint's `vp9Crf`. */
  vp9Crf?: number
  /** Overrides the resolved breakpoint's `vp9TargetBitrateKbps`. */
  vp9TargetBitrateKbps?: number
}

/** A breakpoint resolved to its real, unambiguous values for this call. */
export interface ResolvedVideoBreakpoint {
  /** The breakpoint name this was resolved from. */
  name: VideoBreakpointName
  /** Resolved width — `overrides.width` if given, else the preset's own value. */
  width: number
  /** Resolved video bitrate in kbps — `overrides.videoBitrateKbps` if given, else the preset's own
   * value. */
  videoBitrateKbps: number
  /** Resolved x264 CRF — `overrides.x264Crf` if given, else the preset's own value. */
  x264Crf: number
  /** Resolved VP9 CRF — `overrides.vp9Crf` if given, else the preset's own value. */
  vp9Crf: number
  /** Resolved VP9 target bitrate in kbps — `overrides.vp9TargetBitrateKbps` if given, else the
   * preset's own value. */
  vp9TargetBitrateKbps: number
}

/** Resolves `name` to its real width/bitrate/crf values, applying `overrides` when given. Throws
 * `TypeError` on an unrecognized preset name — a config-authoring mistake, same error type
 * `resolveImageBreakpoint` already uses for the equivalent case. */
export function resolveVideoBreakpoint(
  name: VideoBreakpointName,
  overrides?: VideoBreakpointOverrides,
): ResolvedVideoBreakpoint {
  const preset = VIDEO_BREAKPOINT_PRESETS[name]
  if (!preset) {
    throw new TypeError(
      `Unknown video breakpoint preset: "${name}". Valid presets: ` +
        `${Object.keys(VIDEO_BREAKPOINT_PRESETS).join(', ')}.`,
    )
  }
  return {
    name,
    width: overrides?.width ?? preset.width,
    videoBitrateKbps: overrides?.videoBitrateKbps ?? preset.videoBitrateKbps,
    x264Crf: overrides?.x264Crf ?? preset.x264Crf,
    vp9Crf: overrides?.vp9Crf ?? preset.vp9Crf,
    vp9TargetBitrateKbps: overrides?.vp9TargetBitrateKbps ?? preset.vp9TargetBitrateKbps,
  }
}
