/**
 * A domain/runtime facade unifying image, video, thumbnail, and audio transformation — composing
 * `image-transformer.ts`'s `createImageTransformer` (sharp-backed) and `media-transformer.ts`'s
 * `createMediaTransformer` (entirely FFMPEG-backed, npm-free) into one `AssetTransformer`. This
 * module introduces NO new cache/idempotency logic of its own — every cache decision is a direct,
 * unmodified call into those two composed factories, each wrapping the same real decorators
 * (`createCachedImageOptimizer`/`createCachedVideoTranscoder`/`createCachedAudioTranscoder`,
 * `modules/assets/`/`modules/media/`).
 *
 * **Split across two files, not one, on purpose**: `assetsPlugin` only ever needs
 * `transformImage` (never `transformVideo`/`transformThumbnail`/`transformAudio`), and `mediaPlugin`
 * only ever needs the reverse — a plugin that only transforms video/audio must never have `sharp`
 * reachable in its own module graph merely by needing this facade's cache-wiring shape. Both
 * plugins construct their own narrow transformer directly (`createImageTransformer`/
 * `createMediaTransformer`) rather than going through `createAssetTransformer` — this function
 * exists for a caller that genuinely needs all four kinds together in one instance (today:
 * `assets-api`'s `AssetService`, and this suite's own tests), sharing exactly ONE cache store
 * across every kind, matching the pre-split single-instance contract these callers already expect.
 *
 * Deliberately agnostic of Vite/Rollup/CLI/HTTP/React/Preact — see
 * `src/@tests/unit/asset-transform/dependency-boundary.test.ts` for the enforced module-graph
 * check. Any real caller (a build plugin, a background worker, or an HTTP Asset API) constructs one
 * transformer and calls straight through to a real `optimizeImageAsset`/`VideoTranscoder`/
 * `AudioTranscoder`, cached or not.
 *
 * **Scope, deliberately**: this facade's responsibility ends at
 * `source -> transformed output/result + transformation metadata`. Two concerns that might look
 * related are explicitly NOT here:
 * - **Publication** (`AssetManifestRegistry`, `this.emitFile()`, a manifest, a public URL) stays
 *   entirely an adapter concern — `assetsPlugin`/`mediaPlugin` still own registering their own
 *   outputs into a shared registry directly, exactly as they did before this facade existed. A
 *   transformer that also knew how to publish would conflate "did the bytes get produced" with
 *   "how are they exposed", the same boundary `VideoTranscoder`'s own doc already draws (`the
 *   caller controls filesystem destinations end to end`).
 * - **Backend capability discovery** (`probeFfmpegAvailability`/`TranscoderAvailability`) is a
 *   different question from transformation ("can this environment transcode at all" vs. "produce
 *   this specific transcode") and has no current consumer reaching it through a transformer
 *   instance — neither `assetsPlugin` nor `mediaPlugin` ever calls `.probe()` today. It stays
 *   exclusively in `modules/media` (already public via the `./media` subpath); a real future
 *   consumer that needs it calls `probeFfmpegAvailability()` directly.
 *
 * @module
 */

import { createImageTransformer } from './image-transformer.ts'
import { createFileTransformCacheStore } from '../assets/transform-cache-store.ts'
import { createMediaTransformer } from './media-transformer.ts'
import type {
  AssetKind,
  AssetTransformer,
  AssetTransformerOptions,
  ImplementedAssetKind,
} from './types.ts'
import { isImplementedAssetKind } from './types.ts'

export type { AssetKind, AssetTransformer, AssetTransformerOptions, ImplementedAssetKind }
export { isImplementedAssetKind }

/**
 * Composes one `AssetTransformer` from `createImageTransformer` (`image-transformer.ts`) and
 * `createMediaTransformer` (`media-transformer.ts`) — the same cache-wiring shape `assetsPlugin`/
 * `mediaPlugin` each build for themselves when used standalone, combined here into all four kinds
 * at once, sharing exactly ONE resolved cache store (never two independent stores racing on the
 * same `cacheDir`). See this module's own doc for what this deliberately does NOT do (publication,
 * capability probing).
 */
export function createAssetTransformer(options: AssetTransformerOptions = {}): AssetTransformer {
  const store = options.cacheStore ??
    (options.cacheDir ? createFileTransformCacheStore(options.cacheDir) : undefined)

  const { transformImage } = createImageTransformer({
    cacheStore: store,
    imageOptimizer: options.imageOptimizer,
  })
  const { transformVideo, transformThumbnail, transformAudio } = createMediaTransformer({
    cacheStore: store,
    videoTranscoder: options.videoTranscoder,
    audioTranscoder: options.audioTranscoder,
  })

  return { transformImage, transformVideo, transformThumbnail, transformAudio }
}
