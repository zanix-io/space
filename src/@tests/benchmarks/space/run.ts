// deno-lint-ignore-file deno-zanix-plugin/no-znx-console
// `console` on purpose, and the exemption is stated here rather than left as dozens of silenced
// findings. These are hand-run CLI scripts whose entire output IS a report a human reads and
// copies — `@zanix/logger` decorates every line with a timestamp, level and package prefix, which
// is right for a running server and wrong for a metrics table. Library code in this package uses
// the logger; these scripts are tools, not library code, and none of them ships anywhere.
/**
 * Orchestrates the whole Space/Comets architecture benchmark — the priority deliverable of this
 * benchmarking phase. Builds all 4 variants, renders each one's SSR HTML (sequentially, before any
 * server starts — see `variants/render.ts`'s own doc for why), serves each on its own local port,
 * then drives a real headless Chromium (via Playwright) to measure each one — all of it via
 * `variants/measure-all.ts`'s own `measureAllVariants()`, the same pipeline `record-baseline.ts`/
 * `check-baseline.ts` reuse for the deterministic byte/count subset.
 *
 * NOT wired into `deno test`/`deno bench` at all (real browser + real HTTP servers) — run
 * explicitly via `deno task bench:space`. Not a pass/fail suite: prints a results table and exits;
 * see this package's own performance report for interpretation. `deno task bench:baseline`/
 * `bench:baseline:check` are the pass/fail-capable siblings, scoped to the deterministic subset
 * only — see `record-baseline.ts`'s own doc for why the split.
 *
 * @module
 */
import { measureAllVariants, type VariantResult } from './variants/measure-all.ts'

function fmtBytes(n: number): string {
  return `${(n / 1024).toFixed(1)}KB`
}

function report(results: VariantResult[]): void {
  console.log('\n=== Space/Comets architecture benchmark ===\n')
  for (const r of results) {
    console.log(`--- ${r.name} ---`)
    console.log(`  HTML transferred:        ${fmtBytes(r.metrics.htmlTransferredBytes)}`)
    console.log(
      `  JS transferred:          ${fmtBytes(r.metrics.jsTransferredBytes)} ` +
        `(${r.metrics.jsRequestCount} requests)`,
    )
    console.log(
      `  Hydrated boundaries:      ${
        r.name.startsWith('A:')
          ? 'N/A — not Comet-based (1 whole-page root)'
          : r.metrics.hydratedBoundaryCount
      }`,
    )
    console.log(
      `  First Contentful Paint:   ${r.metrics.firstContentfulPaintMs?.toFixed(1) ?? 'n/a'}ms`,
    )
    console.log(
      `  Largest Contentful Paint: ${r.metrics.largestContentfulPaintMs?.toFixed(1) ?? 'n/a'}ms`,
    )
    console.log(`  DOMContentLoaded:         ${r.metrics.domContentLoadedMs.toFixed(1)}ms`)
    console.log(`  load event:               ${r.metrics.loadEventMs.toFixed(1)}ms`)
    console.log(
      `  Long tasks:               ${r.metrics.longTaskCount} totaling ${
        r.metrics.longTaskTotalMs.toFixed(1)
      }ms`,
    )
    console.log(`  LikeButton click→update:  ${r.interactionLatencyMs}ms`)
    console.log(`  Cart add→update:          ${r.cartInteractionLatencyMs}ms`)
    console.log('')
  }
  console.log(JSON.stringify(results, null, 2))
}

async function main() {
  const { results, failures } = await measureAllVariants()
  report(results)
  if (failures.length > 0) {
    console.log('\n=== Variants that failed to measure (see stderr above for detail) ===')
    for (const f of failures) console.log(`  ${f.name}: ${f.error}`)
  }
}

await main()

// Explicit exit, deliberately. Playwright's own child process and Rolldown's worker pool can both
// keep the event loop alive after `browser.close()`/`server.shutdown()` have already resolved, so
// without this the script prints its full report and then appears to hang — which reads as a
// crash. Every result above is already computed and flushed by the time this runs, so there is
// nothing left to await. The other spikes here (`persistence/`, `unused/`, `compiler/`) end the
// same way, for the same reason.
Deno.exit(0)
