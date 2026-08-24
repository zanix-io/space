/**
 * Asset transformation module — the `@zanix/space/assets` entry point: image/video/thumbnail/audio
 * transformation, plus the shared transform cache, unified behind one domain/runtime facade. See
 * `asset-transformer.ts`'s own doc for the full contract and its deliberate scope boundaries
 * (no publication, no capability probing).
 *
 * Sibling of `./media` for the same reason that subpath already exists as its own export: sharp
 * (transitively, via `image-optimize.ts`) is an opt-in, heavier-dependency capability most
 * `@zanix/space` apps never touch directly — never folded into the main `.` barrel.
 *
 * **Video/thumbnail/audio primitives (`VideoTranscoder`, `AudioTranscoder`,
 * `createSystemFfmpegTranscoder`, `createSystemFfmpegAudioTranscoder`, the voice policy, ...) are
 * deliberately NOT re-exported here** — they're already public via `./media`, one canonical
 * subpath per symbol, never two. A caller composing an explicit `videoTranscoder`/`audioTranscoder`
 * override for {@linkcode createAssetTransformer} imports it from there.
 *
 * @module
 */
export { createAssetTransformer, isImplementedAssetKind } from './asset-transformer.ts'
export type {
  /** Every asset shape this domain is conceptually organized around: `'image'`, `'video'`,
   * `'thumbnail'`, `'audio'`. See this type's own doc in `asset-transformer.ts` for the full
   * contract, including `'audio'`'s own profile family. */
  AssetKind,
  /** The runtime/domain facade `createAssetTransformer` builds — one entry point per
   * {@linkcode AssetKind}. */
  AssetTransformer,
  /** Options accepted by `createAssetTransformer`. */
  AssetTransformerOptions,
  /** Every {@linkcode AssetKind} actually implemented today — see this type's own doc in
   * `asset-transformer.ts`. */
  ImplementedAssetKind,
} from './asset-transformer.ts'

export { optimizeImageAsset, pickSmaller } from '../assets/image-optimize.ts'
export type {
  /** An output image format `optimizeImageAsset` can encode to: `'jpeg' | 'png' | 'webp' |
   * 'avif'`. */
  ImageFormat,
  /** Options accepted by `optimizeImageAsset` — target formats, quality, and metadata handling. */
  ImagesOptimizeOptions,
  /** One optimized output entry `optimizeImageAsset` produces. */
  OptimizedAssetEntry,
} from '../assets/image-optimize.ts'

export {
  createCachedImageOptimizer,
  IMAGE_TRANSFORM_POLICY_VERSION,
} from '../assets/cached-image-optimizer.ts'
export type { OptimizeImageAssetFn } from '../assets/cached-image-optimizer.ts'

export {
  buildTransformCacheKey,
  hashSourceBytes,
  isValidTransformCacheEntry,
} from '../assets/transform-cache.ts'
export type { TransformCacheEntry, TransformCacheStore } from '../assets/transform-cache.ts'

export {
  createFileTransformCacheStore,
  createInMemoryTransformCacheStore,
} from '../assets/transform-cache-store.ts'
