/**
 * Pure data-shape types for `optimizeImageAsset`/`createCachedImageOptimizer` — `ImageFormat`,
 * `ImagesOptimizeOptions`, `OptimizedAssetEntry`, `OptimizeImageAssetFn` — deliberately split from
 * `image-optimize.ts`/`cached-image-optimizer.ts` themselves, which both unconditionally
 * value-import `sharp`. None of these four reference anything beyond `image-breakpoints.ts` (itself
 * `sharp`-free), so a consumer that only needs to type an options object — e.g. `mod.ts`'s own
 * `SpaceAppConfig.optimize` — never resolves `sharp` merely by reading this file. Re-exported
 * unchanged from both `image-optimize.ts` and `cached-image-optimizer.ts`, so switching either
 * import site between "the real file" and "this types file" is never a breaking change in either
 * direction.
 *
 * @module
 */

import type { ImageBreakpoint, ImageBreakpointOverrides } from './image-breakpoints.ts'

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

/** One manifest-ready output of `optimizeImageAsset` — always includes an entry for the original
 * `relativePath` (its bytes may or may not have changed), plus zero or more additive, derived-key
 * variants. */
export interface OptimizedAssetEntry {
  /** The manifest key this entry's bytes are stored under — the original path for the source
   * entry, a derived variant key for every other one. */
  relativePath: string
  /** The real, encoded output bytes for this entry. */
  bytes: Uint8Array
}

/** The real shape of `optimizeImageAsset` — matched by any caller-supplied override
 * (`createCachedImageOptimizer`'s own `imageOptimizer` option). */
export type OptimizeImageAssetFn = (
  relativePath: string,
  source: Uint8Array,
  options: true | ImagesOptimizeOptions,
) => Promise<OptimizedAssetEntry[]>
