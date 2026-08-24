/**
 * Picks the execution strategy for `optimize.useWorker` — inline (default) or offloaded to a real
 * `WorkerManager` pool (`@zanix/utils/workers`, already a pinned dependency of this package via its
 * `errors`/`logger`/`helpers` subpaths — no new dependency, just one more subpath). Both strategies
 * call the exact same `optimizeImageAsset`/`optimizeSvgAsset` functions — `useWorker` changes
 * nothing about WHAT gets computed or WHICH variants get emitted, only WHERE the CPU work runs.
 *
 * @module
 */

import '@zanix/logger'
import { WorkerManager } from '@zanix/workers'
import {
  type ImagesOptimizeOptions,
  type OptimizedAssetEntry,
  optimizeImageAsset,
} from './image-optimize.ts'
import { optimizeSvgAsset } from './svg-optimize.ts'
import { optimizeImageAssetTask, optimizeSvgAssetTask } from './optimize-worker-tasks.ts'

export interface OptimizeRunner {
  optimizeImage(
    relativePath: string,
    source: Uint8Array,
    options: true | ImagesOptimizeOptions,
  ): Promise<OptimizedAssetEntry[]>
  optimizeSvg(
    relativePath: string,
    source: Uint8Array,
    preserveIds?: boolean,
  ): Promise<OptimizedAssetEntry>
  /** Terminates every worker in the pool, if any were ever created. A no-op for the inline
   * (`useWorker` falsy) strategy. Always safe to call even if nothing was ever optimized. */
  close(): void
}

const WORKER_TASKS_META_URL = import.meta.resolve('./optimize-worker-tasks.ts')

function runOnWorker<Args extends unknown[], Result>(
  wm: WorkerManager,
  // deno-lint-ignore no-explicit-any
  fn: (...args: Args) => any,
  args: Args,
): Promise<Result> {
  return new Promise((resolve, reject) => {
    wm.task(fn, {
      metaUrl: WORKER_TASKS_META_URL,
      onFinish: ({ error, response }) => {
        if (error) {
          reject(
            error instanceof Error ? error : new Error(String((error as Error).message ?? error)),
          )
        } else {
          resolve(response as Result)
        }
      },
    }).invoke(...args)
  })
}

/**
 * @param useWorker - `false`/`undefined` (default): every file is optimized inline, on the same
 * thread `buildStart` already runs on — no worker is ever created. `true`: a pool sized to the
 * detected CPU count. A `number`: an explicit pool size (clamped to at least 1).
 */
export function createOptimizeRunner(useWorker: boolean | number | undefined): OptimizeRunner {
  if (!useWorker) {
    return {
      optimizeImage: optimizeImageAsset,
      optimizeSvg: optimizeSvgAsset,
      close() {},
    }
  }

  const pool = typeof useWorker === 'number'
    ? Math.max(1, Math.floor(useWorker))
    : (navigator.hardwareConcurrency || 4)
  const wm = new WorkerManager({ pool })

  return {
    optimizeImage: (relativePath, source, options) =>
      runOnWorker(wm, optimizeImageAssetTask, [relativePath, source, options]),
    optimizeSvg: (relativePath, source, preserveIds) =>
      runOnWorker(wm, optimizeSvgAssetTask, [relativePath, source, preserveIds]),
    close: () => wm.close(),
  }
}
