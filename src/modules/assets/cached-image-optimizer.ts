/**
 * Wraps `optimizeImageAsset` with the shared transform cache (`transform-cache.ts`) —
 * `image-optimize.ts` itself stays exactly as unaware of caching as `VideoTranscoder` does (see
 * `cached-video-transcoder.ts`'s own doc for the same architectural rule applied to video); this
 * decorator is the ORCHESTRATION-layer piece `assetsPlugin` (or a test) actually calls.
 *
 * One `optimizeImageAsset` call is cached as ONE transformation, never per-breakpoint/per-format:
 * it already runs as a single deterministic unit over one `(source, options)` pair, and its own
 * three-tier reference rule (see `image-optimize.ts`'s own doc) means individual entries aren't
 * independently meaningful outside that one call's context. Every entry the call returns is
 * stored under its own sub-key so a hit can reconstruct the exact same array of
 * `{relativePath, bytes}` a live call would have produced, without ever touching `sharp` again.
 *
 * @module
 */

import {
  buildTransformCacheKey,
  hashSourceBytes,
  type TransformCacheStore,
} from './transform-cache.ts'
import type {
  ImagesOptimizeOptions,
  OptimizedAssetEntry,
  OptimizeImageAssetFn,
} from './image-optimize-types.ts'
export type { OptimizeImageAssetFn } from './image-optimize-types.ts'

/** Bumped whenever `image-optimize.ts`'s own optimization policy changes in a way that would
 * produce different bytes for the same input — quality defaults, format-specific encode options,
 * the never-worsen comparison rule itself. A bump changes every cache key it touches, so every
 * previously cached optimization is transparently reprocessed under the new policy. */
export const IMAGE_TRANSFORM_POLICY_VERSION = 'v1'

/** A stable, deterministic serialization of the parts of `ImagesOptimizeOptions` that actually
 * affect the real output bytes — property insertion order in the source object must never matter,
 * so this is built field-by-field rather than a bare `JSON.stringify(options)`. */
function buildImageTransformId(options: true | ImagesOptimizeOptions): string {
  // `true` and `{}` are the SAME real transform — `optimizeImageAsset` itself normalizes them
  // identically (`options === true ? {} : options`) before doing anything else — so this must
  // produce the identical id, never two different cache keys for one real behavior.
  const opts = options === true ? {} : options
  const breakpoints = [...(opts.breakpoints ?? [])].sort().join(',')
  const formats = [...(opts.formats ?? [])].sort().join(',')
  let id = `image:bp[${breakpoints}]:fmt[${formats}]`
  if (opts.quality !== undefined) id += `:q${JSON.stringify(opts.quality)}`
  if (opts.width !== undefined) id += `:w${JSON.stringify(opts.width)}`
  return id
}

/**
 * Wraps `optimize` (normally `optimizeImageAsset` itself) with the shared transform cache. Same
 * shape/contract as the real function — a drop-in replacement for whatever calls
 * `optimizeImageAsset` today (`assetsPlugin`), minus the redundant `sharp` invocations on a hit.
 */
export function createCachedImageOptimizer(
  optimize: OptimizeImageAssetFn,
  store: TransformCacheStore,
  policyVersion: string = IMAGE_TRANSFORM_POLICY_VERSION,
): OptimizeImageAssetFn {
  return async function cachedOptimizeImageAsset(relativePath, source, options) {
    const transformId = buildImageTransformId(options)
    const sourceHash = await hashSourceBytes(source)
    const key = buildTransformCacheKey({ sourceHash, transformId, policyVersion })

    const cached = await store.getEntry(key)
    if (cached?.status === 'optimized' && cached.outputs) {
      const entries: OptimizedAssetEntry[] = []
      for (const outputRelativePath of cached.outputs) {
        // deno-lint-ignore no-await-in-loop
        const bytes = await store.getBytes(`${key}::${outputRelativePath}`)
        if (!bytes) {
          // One of this entry's own outputs is missing from the store — a corrupt/incompatible
          // cache (index and byte files disagree). Abandon the whole hit, fall through to a real,
          // safe recompute rather than returning a partial/wrong result set.
          entries.length = 0
          break
        }
        entries.push({ relativePath: outputRelativePath, bytes })
      }
      if (entries.length > 0) return entries
    }

    const entries = await optimize(relativePath, source, options)

    const outputs = entries.map((entry) => entry.relativePath)
    for (const entry of entries) {
      // deno-lint-ignore no-await-in-loop
      await store.setBytes(`${key}::${entry.relativePath}`, entry.bytes)
    }
    const totalBytesWritten = entries.reduce((sum, entry) => sum + entry.bytes.byteLength, 0)
    await store.setEntry(key, { status: 'optimized', bytesWritten: totalBytesWritten, outputs })

    return entries
  }
}
