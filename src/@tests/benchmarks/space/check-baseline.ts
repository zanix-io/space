// deno-lint-ignore-file deno-zanix-plugin/no-znx-console
// Same exemption as `run.ts`'s own file-level directive — see that file's own header doc.
/**
 * Re-measures all 4 variants and diffs the deterministic subset (`variants/baseline-metrics.ts`)
 * against the committed `baseline.json` (`record-baseline.ts`). Exits non-zero the moment any
 * variant's byte metrics grow past `TOLERANCE_PERCENT`, or its discrete counts
 * (`jsRequestCount`/`hydratedBoundaryCount`) differ AT ALL from the recorded baseline — the real
 * gate `bench:space`'s own FCP/LCP/interaction numbers deliberately never get (see this package's
 * `benchmarks.yml` for why those stay report-only: shared-runner noise a threshold here would only
 * dress up as a false regression).
 *
 * A byte-metric SHRINKING past the tolerance is reported too, but never fails the run — smaller is
 * never the failure mode this gate exists to catch, though a sudden, large drop is usually still
 * worth a human's attention (e.g. a script silently failing to bundle), hence reporting it.
 *
 * Usage:
 * ```sh
 * deno task bench:baseline:check
 * ```
 *
 * @module
 */
import { fromFileUrl, join } from '@std/path'
import { measureAllVariants } from './variants/measure-all.ts'
import { extractDeterministicMetrics } from './variants/baseline-metrics.ts'
import type { Baseline, DeterministicMetrics } from './variants/baseline-metrics.ts'

const BASELINE_PATH = join(fromFileUrl(import.meta.url), '..', 'baseline.json')

/** Percentage a byte metric may grow before this becomes a failure — not zero-tolerance, unlike
 * the two discrete counts below: a build's exact byte count shifts by a few bytes across ordinary
 * dependency patch bumps (a changed license comment, a renamed internal chunk hash) that carry no
 * real size risk, and gating on that would just retrain everyone to re-record the baseline on
 * every unrelated bump instead of actually reading the diff. 10% is deliberately generous rather
 * than tight — the "a dependency leaked into the wrong renderer's bundle" failure mode this gate
 * exists for (`benchmarks.yml`'s own example) is typically a multiple, not a few percent. */
const TOLERANCE_PERCENT = 10

interface FieldCheck {
  field: keyof DeterministicMetrics
  baseline: number
  current: number
  isCount: boolean
}

function checkField({ field, baseline, current, isCount }: FieldCheck): string | null {
  if (isCount) {
    return current === baseline
      ? null
      : `${field}: ${baseline} -> ${current} (exact match required, any change fails)`
  }
  if (baseline === 0) {
    return current === 0 ? null : `${field}: 0 -> ${current} (was zero, any growth fails)`
  }
  const changePercent = ((current - baseline) / baseline) * 100
  if (changePercent > TOLERANCE_PERCENT) {
    return `${field}: ${baseline} -> ${current} (+${changePercent.toFixed(1)}%, ` +
      `exceeds +${TOLERANCE_PERCENT}% tolerance)`
  }
  if (changePercent < -TOLERANCE_PERCENT) {
    console.log(
      `  (info, not a failure) ${field}: ${baseline} -> ${current} ` +
        `(${changePercent.toFixed(1)}%, shrank past the tolerance band — worth a look)`,
    )
  }
  return null
}

async function main() {
  let recorded: Baseline
  try {
    recorded = JSON.parse(await Deno.readTextFile(BASELINE_PATH))
  } catch (error) {
    console.error(
      `\nNo baseline at ${BASELINE_PATH} (or it failed to parse): ${error}\n` +
        'Run `deno task bench:baseline` first, then commit the resulting baseline.json.',
    )
    Deno.exit(1)
  }

  const { results, failures } = await measureAllVariants()
  if (failures.length > 0) {
    console.error('\n=== Some variants failed to measure — cannot check the baseline ===')
    for (const f of failures) console.error(`  ${f.name}: ${f.error}`)
    Deno.exit(1)
  }

  const current = extractDeterministicMetrics(results)
  const violations: string[] = []

  console.log(`\n=== Checking against baseline recorded ${recorded.recordedAt} ===\n`)

  const recordedNames = Object.keys(recorded.variants)
  const currentNames = Object.keys(current.variants)
  for (const name of currentNames) {
    if (!recordedNames.includes(name)) {
      console.log(`  (info) "${name}" has no baseline entry yet — not checked this run.`)
    }
  }
  for (const name of recordedNames) {
    if (!currentNames.includes(name)) {
      violations.push(`"${name}" is in the baseline but was not measured this run (removed?).`)
    }
  }

  for (const [name, base] of Object.entries(recorded.variants)) {
    const now = current.variants[name]
    if (!now) continue // already reported as a violation above
    console.log(`--- ${name} ---`)
    const fields: Array<{ field: keyof DeterministicMetrics; isCount: boolean }> = [
      { field: 'htmlTransferredBytes', isCount: false },
      { field: 'jsTransferredBytes', isCount: false },
      { field: 'jsRequestCount', isCount: true },
      { field: 'hydratedBoundaryCount', isCount: true },
    ]
    let clean = true
    for (const { field, isCount } of fields) {
      const problem = checkField({ field, baseline: base[field], current: now[field], isCount })
      if (problem) {
        clean = false
        violations.push(`${name} — ${problem}`)
        console.log(`  FAIL ${problem}`)
      }
    }
    if (clean) console.log('  OK (within tolerance, counts unchanged)')
    console.log('')
  }

  if (violations.length > 0) {
    console.log('=== Baseline check FAILED ===')
    for (const v of violations) console.log(`  - ${v}`)
    console.log(
      '\nIf this growth is expected (a deliberate dependency/feature change), re-record with ' +
        '`deno task bench:baseline` and commit the updated baseline.json alongside the change ' +
        'that caused it.',
    )
    Deno.exit(1)
  }

  console.log('=== Baseline check passed ===')
}

await main()

// See `run.ts`'s own doc for why this is needed — same Playwright/Rolldown event-loop reason.
Deno.exit(0)
