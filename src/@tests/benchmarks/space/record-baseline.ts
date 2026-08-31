// deno-lint-ignore-file deno-zanix-plugin/no-znx-console
// Same exemption as `run.ts`'s own file-level directive — see that file's own header doc.
/**
 * Records `baseline.json` — the deterministic byte/count subset of a real `measureAllVariants()`
 * run (`htmlTransferredBytes`/`jsTransferredBytes`/`jsRequestCount`/`hydratedBoundaryCount` per
 * variant, `variants/baseline-metrics.ts`'s own doc explains why exactly these four), committed so
 * `check-baseline.ts` has something to diff a later run against.
 *
 * Deliberately NOT the same shape as `@zanix/server`'s own `bench:baseline` (median-across-N-runs,
 * a pasted `BASELINES` table, a statistically-derived regression margin) — that machinery exists
 * because `server`'s own ops/sec numbers are genuinely noisy (shared-runner timing), and deriving a
 * safe margin needs repeated measurement to know how much noise a gate must absorb. The four
 * metrics here are deterministic by construction (real Navigation/Resource Timing byte counts and
 * DOM query counts, not a duration) — the SAME build serves the SAME bytes every time, so a single
 * run already IS the ground truth; averaging it against itself would only hide a real 1-run change
 * behind an unearned sense of stability.
 *
 * Usage:
 * ```sh
 * deno task bench:baseline
 * ```
 * Overwrites `baseline.json` unconditionally — inspect the diff (`git diff
 * src/@tests/benchmarks/space/baseline.json`) before committing it, the same way any other
 * generated-but-committed file gets reviewed. Re-record after a deliberate, expected change to
 * what a variant ships (a new dependency, a new Comet in the scenario, ...) — `check-baseline.ts`
 * has no way to tell "expected" from "regression" on its own.
 *
 * @module
 */
import { fromFileUrl, join } from '@std/path'
import { measureAllVariants } from './variants/measure-all.ts'
import { extractDeterministicMetrics } from './variants/baseline-metrics.ts'

const BASELINE_PATH = join(fromFileUrl(import.meta.url), '..', 'baseline.json')

async function main() {
  const { results, failures } = await measureAllVariants()
  if (failures.length > 0) {
    console.error('\n=== Refusing to record a baseline: some variants failed to measure ===')
    for (const f of failures) console.error(`  ${f.name}: ${f.error}`)
    Deno.exit(1)
  }

  const baseline = extractDeterministicMetrics(results)
  await Deno.writeTextFile(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n')

  console.log(`\nRecorded ${BASELINE_PATH}:\n`)
  console.log(JSON.stringify(baseline, null, 2))
}

await main()

// See `run.ts`'s own doc for why this is needed — same Playwright/Rolldown event-loop reason.
Deno.exit(0)
