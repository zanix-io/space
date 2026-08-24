/**
 * `assetsPlugin`'s opt-in, build-time-only image optimization (`optimize.images`) — sharp-based,
 * never runs in the deployed server (same build-tool-only boundary `pwaPlugin`'s own `sharp` usage
 * already establishes).
 *
 * The one invariant every code path here obeys: **an optimized output only replaces or gets added
 * next to its reference if it is strictly smaller, in bytes, than that reference** — never assumed,
 * always measured. "Reference" is deliberately tiered, not always the original asset — see
 * {@linkcode optimizeImageAsset}'s own doc for the exact three-tier rule.
 *
 * @module
 */

import sharp from 'sharp'
import {
  type ImageBreakpoint,
  type ImageBreakpointOverrides,
  resolveImageBreakpoints,
} from './image-breakpoints.ts'

// Neither `sharp(source)` call below overrides `limitInputPixels` — sharp's own default (roughly
// 268 megapixels) already rejects a decoded image past that size before it's ever fully decoded
// into memory, which is the real guard against a decompression-bomb source (a small compressed
// file that decodes to an enormous pixel buffer). Deliberately not reconfigured here: raising it
// would weaken the guard, and this module has no reason to lower it below sharp's own default.

/** A raster format this pipeline knows how to re-encode. Any other detected source format (gif,
 * tiff, bmp, ...) is passed through completely untouched — no attempt is made to process it. */
export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'avif'

/** Options for `optimize.images` — see `assets-plugin.ts`'s own doc for the full walkthrough of
 * which files get generated/discarded for each shape of this options object. */
export interface ImagesOptimizeOptions {
  /** Which responsive variants to generate, if any. Omitted/empty (the default): no variants —
   * `images: true` alone only optimizes the source asset itself, in place. */
  breakpoints?: ImageBreakpoint[]
  /** Additional formats to also generate, if any. Omitted/empty (the default): no format
   * conversion — every variant keeps the source's own format. */
  formats?: ImageFormat[]
  /** Per-preset quality override — see {@linkcode ImageBreakpointOverrides.quality}. */
  quality?: ImageBreakpointOverrides['quality']
  /** Per-preset width override — see {@linkcode ImageBreakpointOverrides.width}. */
  width?: ImageBreakpointOverrides['width']
}

/** One manifest-ready output of {@linkcode optimizeImageAsset} — always includes an entry for the
 * original `relativePath` (its bytes may or may not have changed, see the doc below), plus zero or
 * more additive, derived-key variants. */
export interface OptimizedAssetEntry {
  /** The manifest key this entry's bytes are stored under — the original path for the source
   * entry, a derived variant key for every other one. */
  relativePath: string
  /** The real, encoded output bytes for this entry. */
  bytes: Uint8Array
}

/** Applied when re-encoding at a size/format that has no more specific quality of its own — a
 * breakpoint-less format conversion (`formats` without `breakpoints`), and the bare `images: true`
 * in-place recompression. Deliberately not configurable in this first version: a consumer who
 * wants finer control already has it via named breakpoints + the `quality` override map. */
const DEFAULT_OPTIMIZE_QUALITY = 90

/** The one comparison every "never worsen" decision in this module (and `svg-optimize.ts`'s own)
 * goes through — `candidate` wins ONLY when it is strictly smaller than `reference`; equal or
 * larger always keeps `reference`. Deliberately its own tiny, pure, synchronous function: the
 * "never worsen" contract needs to be verified with exact, deterministic byte-length fixtures, not
 * inferred indirectly from whether a particular real photo happened to compress well. */
export function pickSmaller(candidate: Uint8Array, reference: Uint8Array): Uint8Array {
  return candidate.byteLength < reference.byteLength ? candidate : reference
}

function detectImageFormat(sharpFormat: string | undefined): ImageFormat | undefined {
  return sharpFormat === 'jpeg' || sharpFormat === 'png' || sharpFormat === 'webp' ||
      sharpFormat === 'avif'
    ? sharpFormat
    : undefined
}

/** Splits `'img/hero.jpg'` into `{ base: 'img/hero', ext: 'jpg' }` — `ext` is the SOURCE file's own
 * literal extension text, reused verbatim for same-format derived variants (never canonicalized —
 * a source named `.jpeg` stays `.jpeg` in its own breakpoint variants, it's never rewritten to
 * `.jpg`). A path with no extension at all (`ext === ''`) is treated as unsupported upstream (no
 * detectable image format either), so this only ever runs on paths that do have one. */
function splitRelativePath(relativePath: string): { base: string; ext: string } {
  const dot = relativePath.lastIndexOf('.')
  return { base: relativePath.slice(0, dot), ext: relativePath.slice(dot + 1) }
}

async function encodeAt(
  source: Uint8Array,
  width: number | undefined,
  format: ImageFormat,
  quality: number,
): Promise<Uint8Array> {
  let pipeline = sharp(source)
  // `withoutEnlargement: true` — a breakpoint wider than the real source never upscales it; the
  // real output width silently clamps to the source's own, exactly like `undefined` (no resize).
  if (width !== undefined) pipeline = pipeline.resize({ width, withoutEnlargement: true })
  // No `.withMetadata()` call anywhere in this module — sharp's own DEFAULT output already strips
  // EXIF/ICC metadata (confirmed empirically; calling `.withMetadata({})` does the OPPOSITE in
  // current sharp versions — it PRESERVES metadata, the inverse of the legacy pipeline's own,
  // now-stale, `// delete metadata` comment on that same call).
  switch (format) {
    case 'jpeg':
      pipeline = pipeline.jpeg({ quality, mozjpeg: true })
      break
    case 'webp':
      // Deliberately NOT `nearLossless: true` (unlike the legacy pipeline) — near-lossless webp
      // targets visual losslessness, which typically produces LARGER output than plain lossy webp
      // at the same quality — counter to this module's own "never worsen" mandate.
      pipeline = pipeline.webp({ quality })
      break
    case 'avif':
      // Deliberately NOT `lossless: true` (unlike the legacy pipeline, where it looks like an
      // oversight) — lossless avif routinely exceeds the original's own byte size, which the
      // byte-comparison rule below would then correctly discard anyway, but there's no reason to
      // pay the (much higher, see the design spike) avif encode cost for an output that's
      // essentially guaranteed to lose its own comparison.
      //
      // Deliberately DOES pass `tune: 'auto'` — sharp 0.35.3's own `AvifOptions.tune` already
      // defaults to `'auto'`, so this changes nothing about today's output; it exists only to turn
      // an implicit default into an explicit, diff-visible decision. `tune` is the one AVIF encoder
      // option this switch left unset before this change; every other option here (`quality`
      // itself, and the `lossless`/`nearLossless` calls this case and `webp`'s deliberately omit)
      // is already a conscious choice. Pinning it explicitly means a future sharp bump can't
      // silently retune the AVIF encoder out from under this module without it showing up right
      // here.
      pipeline = pipeline.avif({ quality, tune: 'auto' })
      break
    case 'png':
      pipeline = pipeline.png({ quality, compressionLevel: 9 })
      break
  }
  return await pipeline.toBuffer()
}

/**
 * Optimizes one image asset per `optimize.images`'s exact contract. Always returns an entry for
 * the original `relativePath` — its bytes are replaced ONLY in the bare `images: true` case (no
 * `breakpoints`, no `formats`) and ONLY when the recompressed result is strictly smaller; every
 * other shape of `options` leaves the original entry's bytes byte-for-byte untouched and adds new,
 * derived-key entries next to it.
 *
 * **The three-tier reference rule** (`breakpoints` + `formats` together): for each breakpoint, a
 * same-format resize is always computed in memory as that breakpoint's own reference — regardless
 * of whether it individually beats the GLOBAL original (that comparison alone decides whether it
 * becomes its own manifest entry). Every additional FORMAT requested for that breakpoint is then
 * compared ONLY against that breakpoint's own in-memory reference — never the global original,
 * never another breakpoint, never another format. Two formats are never compared against each
 * other. See `assets-plugin.ts`'s own doc for a concrete file-by-file walkthrough of all four
 * option shapes.
 *
 * An unrecognized/unsupported source format (anything that isn't jpeg/png/webp/avif — gif, tiff,
 * bmp, ...) is passed through with zero changes and zero variants, regardless of `options`.
 */
export async function optimizeImageAsset(
  relativePath: string,
  source: Uint8Array,
  options: true | ImagesOptimizeOptions,
): Promise<OptimizedAssetEntry[]> {
  const opts: ImagesOptimizeOptions = options === true ? {} : options
  const breakpoints = opts.breakpoints ?? []
  const formats = opts.formats ?? []

  const meta = await sharp(source).metadata()
  const originalFormat = detectImageFormat(meta.format)
  const originalWidth = meta.width

  if (!originalFormat || !originalWidth) {
    return [{ relativePath, bytes: source }]
  }

  if (breakpoints.length === 0 && formats.length === 0) {
    const optimized = await encodeAt(source, undefined, originalFormat, DEFAULT_OPTIMIZE_QUALITY)
    return [{ relativePath, bytes: pickSmaller(optimized, source) }]
  }

  const { base, ext } = splitRelativePath(relativePath)
  const entries: OptimizedAssetEntry[] = [{ relativePath, bytes: source }]

  // Unify "explicit breakpoints" and "formats without breakpoints" into the same loop: the latter
  // is exactly one implicit group operating at the original size, whose tier-1 reference IS the
  // global original (so it's never separately emitted — it would be byte-identical to it).
  const groups = breakpoints.length > 0
    ? resolveImageBreakpoints(breakpoints, { quality: opts.quality, width: opts.width })
    : [null]

  // Two different breakpoint names can clamp to the identical real width for a small source
  // (`withoutEnlargement`) — the actual sharp work is only ever done once per DISTINCT
  // (width, quality) pair, regardless of how many breakpoint names land on it. Keyed by width
  // ALONE this would be a real bug: two presets that clamp to the same width but declare
  // different qualities (e.g. `msm`'s 85 vs `mlg`'s 90) would silently reuse the FIRST one's
  // bytes for the second, ignoring its own quality setting — caught by this module's own tests
  // before it shipped.
  const tier1Cache = new Map<string, Uint8Array>()

  // The outer loop stays sequential (not `Promise.all`-batched) on purpose: each group's own
  // format sub-loop depends on that SAME group's `tier1Bytes` reference, and `tier1Cache` is a
  // cross-group memo that only holds its "compute once" guarantee under sequential iteration —
  // running groups concurrently would risk two same-width groups both missing the cache and
  // redoing the same resize, a performance-only risk, never a correctness one.
  for (const group of groups) {
    const quality = group?.quality ?? DEFAULT_OPTIMIZE_QUALITY
    let width: number | undefined
    let tier1Bytes: Uint8Array

    if (!group) {
      tier1Bytes = source
    } else {
      width = Math.min(group.width, originalWidth)
      const cacheKey = `${width}:${quality}`
      const cached = tier1Cache.get(cacheKey)
      if (cached) {
        tier1Bytes = cached
      } else {
        // deno-lint-ignore no-await-in-loop
        tier1Bytes = await encodeAt(source, width, originalFormat, quality)
        tier1Cache.set(cacheKey, tier1Bytes)
      }
      if (pickSmaller(tier1Bytes, source) === tier1Bytes) {
        entries.push({ relativePath: `${base}.${group.key}.${ext}`, bytes: tier1Bytes })
      }
    }

    for (const format of formats) {
      // The plain, original-format output at this same width is already covered by `tier1Bytes`
      // above (compared against the global original) — requesting it again as an "extra format"
      // would derive the exact same manifest key a second time.
      if (format === originalFormat) continue

      // deno-lint-ignore no-await-in-loop
      const candidate = await encodeAt(source, width, format, quality)
      if (pickSmaller(candidate, tier1Bytes) === candidate) {
        const key = group ? `${base}.${group.key}.${format}` : `${base}.${format}`
        entries.push({ relativePath: key, bytes: candidate })
      }
    }
  }

  return entries
}
