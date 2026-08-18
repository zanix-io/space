/**
 * The module a `useWorker`-enabled optimize run dynamically imports inside each worker thread
 * (`WorkerManager`'s own `metaUrl` contract — the task function must be a real `export` from the
 * module at that URL). Never imported directly by `assets-plugin.ts` for the inline (no-worker)
 * path — that path calls `optimizeImageAsset`/`optimizeSvgAsset` straight from
 * `image-optimize.ts`/`svg-optimize.ts` instead, so both paths run the IDENTICAL underlying
 * optimization logic; only the execution strategy differs.
 *
 * @module
 */

// Side-effect import, required — NOT decorative. Confirmed empirically: `WorkerManager`'s own
// error-reporting path (`Znx.logger.error`, its "worker errors are logged automatically" behavior)
// stalls instead of ever resolving `onFinish` when nothing in the process has initialized
// `@zanix/utils`'s logger singleton yet — `@zanix/space`'s own bundler chain never imports it on
// its own. Without this import, a worker task that throws hangs the build instead of failing it.
import '@zanix/logger'

import sharp from 'sharp'
import {
  type ImagesOptimizeOptions,
  type OptimizedAssetEntry,
  optimizeImageAsset,
} from './image-optimize.ts'
import { optimizeSvgAsset } from './svg-optimize.ts'

/**
 * Worker-side wrapper around `optimizeImageAsset` — identical output, but first pins sharp's own
 * internal (libvips) thread pool down to a single thread. sharp/libvips already parallelizes
 * internally (confirmed: `sharp.concurrency()` defaults to the detected CPU count) — left at its
 * default inside a worker, N concurrent workers would each ALSO spin up their own multi-threaded
 * libvips pool, oversubscribing the real CPU cores several times over. Pinning it to 1 here hands
 * all parallelism to the outer `WorkerManager` pool instead, where it belongs.
 */
export async function optimizeImageAssetTask(
  relativePath: string,
  source: Uint8Array,
  options: true | ImagesOptimizeOptions,
): Promise<OptimizedAssetEntry[]> {
  sharp.concurrency(1)
  return await optimizeImageAsset(relativePath, source, options)
}

/** Worker-side wrapper around `optimizeSvgAsset` — svgo is plain single-threaded JS, no equivalent
 * concurrency knob needed. */
export async function optimizeSvgAssetTask(
  relativePath: string,
  source: Uint8Array,
): Promise<{ relativePath: string; bytes: Uint8Array }> {
  return await optimizeSvgAsset(relativePath, source)
}
