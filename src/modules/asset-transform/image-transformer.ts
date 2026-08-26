/**
 * Image-only transformation facade — sharp-backed, via `optimizeImageAsset`
 * (`modules/assets/image-optimize.ts`). Split out of `asset-transformer.ts` as its own file so a
 * caller that only ever transforms video/audio (`mediaPlugin`, entirely FFMPEG-backed, npm-free —
 * see `media-transformer.ts`) never has `sharp` reachable in its module graph merely by needing
 * `createAssetTransformer`'s shared cache-wiring shape. `createAssetTransformer`
 * (`asset-transformer.ts`) composes this file's own `createImageTransformer` together with
 * `media-transformer.ts`'s `createMediaTransformer` into the full four-method `AssetTransformer`
 * facade `assets-api`/tests see — this file's own shape stays a strict subset of that one.
 *
 * @module
 */

import { optimizeImageAsset } from '../assets/image-optimize.ts'
import type { ImagesOptimizeOptions, OptimizedAssetEntry } from '../assets/image-optimize.ts'
import {
  createCachedImageOptimizer,
  type OptimizeImageAssetFn,
} from '../assets/cached-image-optimizer.ts'
import type { TransformCacheStore } from '../assets/transform-cache.ts'
import { createFileTransformCacheStore } from '../assets/transform-cache-store.ts'

/** Options for {@linkcode createImageTransformer}. */
export interface ImageTransformerOptions {
  /** Persists results across calls/processes — a real directory path this store creates if
   * missing. Omitted (and no `cacheStore` either): every call runs for real, no caching at all —
   * `transformImage` is then literally `imageOptimizer`/`optimizeImageAsset` itself (no wrapper). */
  cacheDir?: string
  /** An explicit `TransformCacheStore` — takes precedence over `cacheDir` when both are given (a
   * caller that already has one, e.g. `createAssetTransformer`'s own shared instance, never needs
   * a second real directory created on disk on its behalf). */
  cacheStore?: TransformCacheStore
  /** Overrides the real image optimizer this transformer wraps. Default: `optimizeImageAsset`
   * itself. Exists so a caller with its own execution strategy (`assetsPlugin`'s own worker-pool-
   * backed `OptimizeRunner.optimizeImage`) can still get this facade's cache wiring without this
   * module needing to know worker pools exist at all — any function matching
   * {@linkcode OptimizeImageAssetFn} composes here identically. */
  imageOptimizer?: OptimizeImageAssetFn
}

/** The facade {@linkcode createImageTransformer} returns. */
export interface ImageTransformer {
  /** Drop-in replacement for `optimizeImageAsset`, cache-wired. */
  transformImage(
    relativePath: string,
    source: Uint8Array,
    options: true | ImagesOptimizeOptions,
  ): Promise<OptimizedAssetEntry[]>
}

/**
 * Composes one {@linkcode ImageTransformer} — the same cache-wiring shape `assetsPlugin` already
 * builds for its own worker-pool-aware optimizer. See `asset-transformer.ts`'s own doc for how this
 * composes with `media-transformer.ts`'s `createMediaTransformer` into the full `AssetTransformer`
 * a generic caller (`assets-api`) needs.
 */
export function createImageTransformer(
  options: ImageTransformerOptions = {},
): ImageTransformer {
  const store = options.cacheStore ??
    (options.cacheDir ? createFileTransformCacheStore(options.cacheDir) : undefined)

  const baseImageOptimizer = options.imageOptimizer ?? optimizeImageAsset
  const transformImage = store
    ? createCachedImageOptimizer(baseImageOptimizer, store)
    : baseImageOptimizer

  return { transformImage }
}
