/**
 * The deterministic subset of `CollectedMetrics` this benchmark's own `run.ts` report already
 * calls out as "worth comparing across runs" — unlike FCP/LCP/`domContentLoadedMs`/interaction
 * latency, none of these four move with shared-runner machine load: the same build, served the
 * same way, produces the same bytes and the same counts every time. A change here is a real change
 * to what ships to the browser (a dependency creeping into the wrong renderer's bundle, an extra
 * request, an extra/missing hydrated boundary), not measurement noise — the property
 * `record-baseline.ts`/`check-baseline.ts` exist to protect.
 *
 * @module
 */
import type { VariantResult } from './measure-all.ts'

export interface DeterministicMetrics {
  htmlTransferredBytes: number
  jsTransferredBytes: number
  jsRequestCount: number
  hydratedBoundaryCount: number
}

export interface Baseline {
  recordedAt: string
  /** Keyed by `VariantResult.name` — the exact variant label `run.ts`'s own report uses too, so a
   * renamed/added/removed variant surfaces as a plain missing/extra key rather than a silent
   * index-based mismatch. */
  variants: Record<string, DeterministicMetrics>
}

export function extractDeterministicMetrics(results: VariantResult[]): Baseline {
  const variants: Record<string, DeterministicMetrics> = {}
  for (const r of results) {
    variants[r.name] = {
      htmlTransferredBytes: r.metrics.htmlTransferredBytes,
      jsTransferredBytes: r.metrics.jsTransferredBytes,
      jsRequestCount: r.metrics.jsRequestCount,
      hydratedBoundaryCount: r.metrics.hydratedBoundaryCount,
    }
  }
  return { recordedAt: new Date().toISOString(), variants }
}
