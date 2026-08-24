/**
 * Named breakpoint presets for `assetsPlugin`'s `optimize.images`. `dlg`'s `quality: 100` is a
 * deliberate default, not an oversight — it produces a near-lossless re-encode, which is why it
 * still only gets emitted when it's strictly smaller than the source (see `image-optimize.ts`'s
 * own byte-comparison rule) rather than unconditionally.
 *
 * @module
 */

/** A recognized breakpoint preset name. */
export type ImageBreakpointName = 'thum' | 'msm' | 'mlg' | 'dmd' | 'dlg'

/** Either a named preset (`'msm'`) or a raw pixel width (`720`) — a consumer that wants a
 * specific width never needs to know the preset names to ask for it. */
export type ImageBreakpoint = ImageBreakpointName | number

interface BreakpointPreset {
  /** Max width this breakpoint represents — the real, clamped output width is
   * `Math.min(width, source's real width)` via `withoutEnlargement: true`, never larger. */
  width: number
  quality: number
}

/** `thum`: list/avatar-scale thumbnails. `msm`/`mlg`/`dmd`/`dlg`: mobile → mobile@2x/tablet →
 * desktop → desktop@2x/large-monitor, a progressive breakpoint ladder. */
export const IMAGE_BREAKPOINT_PRESETS: Record<ImageBreakpointName, BreakpointPreset> = {
  thum: { width: 40, quality: 50 },
  msm: { width: 360, quality: 85 },
  mlg: { width: 720, quality: 90 },
  dmd: { width: 1440, quality: 95 },
  dlg: { width: 1920, quality: 100 },
}

/** Applied to a raw numeric breakpoint (no matching named preset to source a quality from) —
 * documented, not configurable per-breakpoint in this first version (use a named preset + the
 * `quality` override map for per-breakpoint control). */
export const DEFAULT_NUMERIC_BREAKPOINT_QUALITY = 85

/** Overrides for named breakpoints' own preset `width`/`quality` — never applies to raw numeric
 * breakpoints, which already ARE an explicit width. */
export interface ImageBreakpointOverrides {
  /** Per-preset quality override, keyed by breakpoint name. */
  quality?: Partial<Record<ImageBreakpointName, number>>
  /** Per-preset width override, keyed by breakpoint name. */
  width?: Partial<Record<ImageBreakpointName, number>>
}

/** A breakpoint resolved to its real, unambiguous identity for this build. */
export interface ResolvedImageBreakpoint {
  /** Manifest-key-safe identity — the preset name (`'msm'`) or `w<width>` (`'w720'`) for a raw
   * numeric breakpoint, so a number can never be mistaken for (or collide with) a preset name. */
  key: string
  /** Resolved output width. */
  width: number
  /** Resolved output quality. */
  quality: number
}

function isImageBreakpointName(value: unknown): value is ImageBreakpointName {
  return typeof value === 'string' && value in IMAGE_BREAKPOINT_PRESETS
}

/** Resolves a single {@linkcode ImageBreakpoint} to its real width/quality/manifest-key. Throws
 * on an unknown preset name or a non-finite/non-positive numeric width. */
export function resolveImageBreakpoint(
  breakpoint: ImageBreakpoint,
  overrides?: ImageBreakpointOverrides,
): ResolvedImageBreakpoint {
  if (typeof breakpoint === 'number') {
    if (!Number.isFinite(breakpoint) || breakpoint <= 0) {
      throw new TypeError(
        `Invalid image breakpoint width: ${breakpoint} — must be a positive, finite number.`,
      )
    }
    return { key: `w${breakpoint}`, width: breakpoint, quality: DEFAULT_NUMERIC_BREAKPOINT_QUALITY }
  }
  if (!isImageBreakpointName(breakpoint)) {
    throw new TypeError(
      `Unknown image breakpoint preset: "${breakpoint}". Valid presets: ` +
        `${Object.keys(IMAGE_BREAKPOINT_PRESETS).join(', ')} — or pass a raw pixel width instead.`,
    )
  }
  const preset = IMAGE_BREAKPOINT_PRESETS[breakpoint]
  return {
    key: breakpoint,
    width: overrides?.width?.[breakpoint] ?? preset.width,
    quality: overrides?.quality?.[breakpoint] ?? preset.quality,
  }
}

/** Resolves a whole `breakpoints` list, validating that no two entries collide — either the same
 * literal entry twice, or two different entries (a preset and a raw width, or two presets after
 * an override) that resolve to the identical pixel width, which would only ever produce two
 * byte-identical variants under two different keys. This is a config-authoring check, not the
 * (unrelated, legitimate) runtime coincidence where a SMALL source image clamps two DIFFERENT
 * breakpoints to the same real output width via `withoutEnlargement` — that case is deduplicated
 * internally by `image-optimize.ts` without being treated as a config error. */
export function resolveImageBreakpoints(
  breakpoints: ImageBreakpoint[],
  overrides?: ImageBreakpointOverrides,
): ResolvedImageBreakpoint[] {
  const resolved = breakpoints.map((breakpoint) => resolveImageBreakpoint(breakpoint, overrides))

  const seenKeys = new Map<string, ResolvedImageBreakpoint>()
  const seenWidths = new Map<number, ResolvedImageBreakpoint>()
  for (const current of resolved) {
    const duplicateKey = seenKeys.get(current.key)
    if (duplicateKey) {
      throw new TypeError(
        `Duplicate image breakpoint: "${current.key}" is specified more than once.`,
      )
    }
    seenKeys.set(current.key, current)

    const duplicateWidth = seenWidths.get(current.width)
    if (duplicateWidth) {
      throw new TypeError(
        `Image breakpoints "${duplicateWidth.key}" and "${current.key}" both resolve to the same ` +
          `width (${current.width}px) — they would produce equivalent variants. Remove one.`,
      )
    }
    seenWidths.set(current.width, current)
  }

  return resolved
}
