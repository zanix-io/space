/**
 * Whether system `ffmpeg`/`ffprobe` are usable AT ALL — deliberately separate from
 * `ffprobe-media.ts`'s own `probeSourceVideo`, which probes a SPECIFIC file's own content. Those
 * are two different questions with two different failure modes: a missing/unusable RUNTIME versus
 * a corrupt/non-video INPUT file. `SystemFfmpegTranscoder` (`system-ffmpeg-transcoder.ts`) checks
 * this one FIRST, before ever touching a specific file, so a caller can tell "ffmpeg isn't set up
 * here" apart from "this particular file is bad."
 *
 * No provisioning of any kind lives here, or anywhere in this module — see
 * `system-ffmpeg-transcoder.ts`'s own doc for why binary installation is deliberately out of scope
 * for this package. This only ever detects and validates whatever is already on the host —
 * Docker/a bare host is expected to have installed it; Deno Deploy's standard runtime cannot run
 * it at all, `'unsupported-runtime'` below.
 *
 * @module
 */

/**
 * Four distinguishable reasons `ffmpeg`/`ffprobe` might not be usable, each pointing at a
 * different fix:
 * - `'unsupported-runtime'` — `Deno.Command` itself doesn't exist in this runtime (e.g. Deno
 *   Deploy's standard request runtime has subprocess spawning disabled entirely). No flag or
 *   install fixes this — a different deploy target does (Docker, a bare Deno host/VM).
 * - `'missing-permission'` — the binary may well be installed; this PROCESS wasn't granted
 *   `--allow-run`. A deploy/config fix, not an installation problem.
 * - `'binary-not-found'` — `ffmpeg` or `ffprobe` isn't on `PATH` at all. An installation/
 *   provisioning gap (add it to the Docker image / host) — never auto-remediated by this package.
 * - `'incompatible-binary'` — a binary WAS found and runs, but its own build is missing a
 *   required encoder (most commonly `libx264`, GPL-licensed, omitted from some minimal/LGPL-only
 *   distributions). A wrong-build problem, not a missing-binary one.
 */
export type UnavailableReason =
  | 'unsupported-runtime'
  | 'missing-permission'
  | 'binary-not-found'
  | 'incompatible-binary'

/** The result of `probeFfmpegAvailability()` — whether transcoding is usable at all, and why not
 * when it isn't. */
export interface TranscoderAvailability {
  /** Whether ffmpeg/ffprobe are usable for transcoding in this environment. */
  available: boolean
  /** Set when `available` is `false` — which of the four `UnavailableReason` cases applies. */
  reason?: UnavailableReason
  /** A human-readable, actionable detail — names the specific binary/encoder/permission
   * involved, never just "ffmpeg unavailable." */
  detail?: string
  /**
   * Feature-level capabilities BEYOND the baseline required encoders — checked once, alongside
   * everything else, only when `available` is `true`. Never gates `available` itself: a build
   * missing one of these is still fully usable for `transcode()`/`extractThumbnail()` at its
   * default (`jpeg`) format — only the ONE specific feature named here is affected.
   *
   * `webpEncoder`: whether `libwebp` is present — required for `extractThumbnail({ format:
   * 'webp' })`. Availability varies by distribution: Debian trixie's own `apt-get install ffmpeg`
   * (this codebase's own Docker provisioning) includes it; a bare macOS Homebrew `ffmpeg` build
   * commonly does not. `system-ffmpeg-transcoder.ts` checks this explicitly before ever invoking
   * `ffmpeg` with `format: 'webp'` — see its own doc for why this is a real, guaranteed contract
   * capability, never a silent best-effort/fallback.
   */
  capabilities?: { webpEncoder: boolean }
}

/** Encoders `system-ffmpeg-transcoder.ts` actually invokes for its BASELINE contract —
 * `libx264`/`aac` for `mp4`, `libvpx-vp9`/`libopus` for `webm` (the codec-by-container mapping
 * `system-ffmpeg-transcoder.ts` implements) — missing any of these makes the WHOLE transcoder
 * unavailable. `WEBP_ENCODER` below is deliberately NOT in this list: it gates only one specific,
 * optional thumbnail format, never the transcoder's own core contract — see
 * `TranscoderAvailability.capabilities`'s own doc. */
const REQUIRED_ENCODERS = ['libx264', 'aac', 'libvpx-vp9', 'libopus']
const WEBP_ENCODER = 'libwebp'

/** The result of running one binary/encoder check — a single entry in the checks
 * {@linkcode probeFfmpegAvailability} composes into a full {@linkcode TranscoderAvailability}. */
export interface BinaryCheckResult {
  /** Whether the check succeeded. */
  ok: boolean
  /** Set when `ok` is `false` — which of {@linkcode UnavailableReason}'s cases applies. */
  reason?: UnavailableReason
  /** A human-readable, actionable detail — names the specific binary/encoder involved, never
   * just "ffmpeg unavailable." */
  detail?: string
}

async function checkBinaryRuns(bin: string): Promise<BinaryCheckResult> {
  try {
    const { success, stderr } = await new Deno.Command(bin, {
      args: ['-version'],
      stdout: 'null',
      stderr: 'piped',
    }).output()
    if (!success) {
      return {
        ok: false,
        reason: 'binary-not-found',
        detail: `"${bin} -version" exited with a non-zero status: ` +
          new TextDecoder().decode(stderr).trim(),
      }
    }
    return { ok: true }
  } catch (error) {
    // Deno.Command throws Deno.errors.NotCapable for a missing --allow-run permission, and
    // Deno.errors.NotFound when the binary itself doesn't exist on PATH — two distinct, real
    // error classes, not one generic failure.
    if (error instanceof Deno.errors.NotCapable) {
      return {
        ok: false,
        reason: 'missing-permission',
        detail: `Running "${bin}" requires the --allow-run permission (e.g. --allow-run=${bin}).`,
      }
    }
    if (error instanceof Deno.errors.NotFound) {
      return { ok: false, reason: 'binary-not-found', detail: `"${bin}" was not found on PATH.` }
    }
    return {
      ok: false,
      reason: 'binary-not-found',
      detail: `Unexpected error spawning "${bin}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    }
  }
}

/** Pure — checks a raw `ffmpeg -encoders` text dump for the encoders this transcoder needs.
 * Separated from the actual subprocess call so the DETECTION logic is unit-testable with a
 * captured/fabricated text fixture, without requiring a real ffmpeg binary in every test
 * environment; only {@linkcode probeFfmpegAvailability} itself needs one. */
export function hasRequiredEncoders(encodersOutput: string): BinaryCheckResult {
  const missing = REQUIRED_ENCODERS.filter((encoder) => !encodersOutput.includes(encoder))
  if (missing.length > 0) {
    return {
      ok: false,
      reason: 'incompatible-binary',
      detail: `The installed ffmpeg build is missing required encoder(s): ${missing.join(', ')}. ` +
        `A minimal/LGPL-only ffmpeg build commonly omits libx264 (GPL-licensed) — install a build ` +
        `with these encoders enabled.`,
    }
  }
  return { ok: true }
}

/** Pure — checks a raw `ffmpeg -encoders` text dump for `libwebp` specifically. Separated exactly
 * like {@linkcode hasRequiredEncoders} for the same unit-testability reason. Deliberately never
 * folded into that function's own check — see `TranscoderAvailability.capabilities`'s own doc for
 * why this one is optional, not baseline. */
export function hasWebpEncoder(encodersOutput: string): boolean {
  return encodersOutput.includes(WEBP_ENCODER)
}

async function fetchEncodersOutput(): Promise<string> {
  const { stdout } = await new Deno.Command('ffmpeg', {
    args: ['-hide_banner', '-encoders'],
    stdout: 'piped',
    stderr: 'null',
  }).output()
  return new TextDecoder().decode(stdout)
}

let cached: TranscoderAvailability | undefined

/**
 * Checks `ffmpeg`/`ffprobe` availability, memoized (subprocess spawns are not free — this is
 * meant to be called before every {@linkcode VideoTranscoder} operation without re-probing each
 * time). See this module's own doc for the four distinguishable {@linkcode UnavailableReason}s.
 */
export async function probeFfmpegAvailability(): Promise<TranscoderAvailability> {
  if (cached) return cached

  if (typeof Deno.Command !== 'function') {
    return cached = {
      available: false,
      reason: 'unsupported-runtime',
      detail: "Deno.Command is not available in this runtime (e.g. Deno Deploy's standard " +
        'request runtime disables subprocess spawning entirely) — invoking a system ffmpeg/' +
        'ffprobe binary is not possible here. This is a target-choice problem, not a ' +
        'configuration one: use Docker or a bare Deno host/VM for anything that needs to ' +
        'transcode video.',
    }
  }

  const ffmpegCheck = await checkBinaryRuns('ffmpeg')
  if (!ffmpegCheck.ok) {
    return cached = { available: false, reason: ffmpegCheck.reason, detail: ffmpegCheck.detail }
  }
  const ffprobeCheck = await checkBinaryRuns('ffprobe')
  if (!ffprobeCheck.ok) {
    return cached = { available: false, reason: ffprobeCheck.reason, detail: ffprobeCheck.detail }
  }
  const encodersOutput = await fetchEncodersOutput()
  const encoderCheck = hasRequiredEncoders(encodersOutput)
  if (!encoderCheck.ok) {
    return cached = {
      available: false,
      reason: encoderCheck.reason,
      detail: encoderCheck.detail,
    }
  }
  return cached = {
    available: true,
    capabilities: { webpEncoder: hasWebpEncoder(encodersOutput) },
  }
}

/** Test-only escape hatch — forces the next {@linkcode probeFfmpegAvailability} call to re-check
 * instead of returning a memoized result. Not exported from this package's public entry points. */
export function resetFfmpegAvailabilityCache(): void {
  cached = undefined
}
