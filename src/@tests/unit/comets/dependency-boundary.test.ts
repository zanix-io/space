import { assert } from '@std/assert'

/**
 * Structural guard rail: nothing reachable at RUNTIME from a client-facing entry point
 * (`@zanix/space/comet`, its `/react`/`/preact` siblings, and `@zanix/space/client`) may ever
 * CODE-reach `@zanix/utils`'s `workers` module (`WorkerManager`/`processor.ts`, a real `new
 * Worker(...)` user Vite's `vite:worker-import-meta-url` plugin tries to sub-build) or its full
 * `logger` entry point (`/logger`, as opposed to the browser-safe `/logger/client`) — see
 * `csrf-form-field.ts`'s own doc for the real regression this closes (`form-draft-persistence.ts`
 * → `csrf-guard.ts` → `@zanix/utils/helpers` → `masking/hard.ts` → the full logger → `workers`,
 * shipped in 1.4.0, fixed by extracting `CSRF_FORM_FIELD` into its own dependency-free module).
 *
 * Walks the REAL module graph via `deno info --json`, following ONLY `code` edges — a `type`-only
 * edge (e.g. `hydrate-error-boundaries.ts`'s `import type { Messages } from
 * '../i18n/load-messages.ts'`) is erased by Vite before Rollup ever resolves it, so it must never
 * count as reachable here either; aggregating every module's own dependencies regardless of edge
 * kind (the way `i18n/dependency-boundary.test.ts`'s ICU check gets away with, since ICU never
 * appears in this package's graph at all, code or type) would produce a false positive the moment
 * a type-only-imported module happens to import the forbidden package for its own, legitimate,
 * server-side reasons — exactly `load-messages.ts`'s real shape.
 *
 * @module
 */

const ENTRYPOINTS = [
  'src/modules/comets/mod.ts',
  'src/modules/comets/mod-react.ts',
  'src/modules/comets/mod-preact.ts',
  'src/modules/client/mod.ts',
  'src/modules/client/mod-preact.ts',
]

interface DenoInfoModule {
  specifier: string
  dependencies?: { code?: { specifier: string } }[]
}

async function codeReachableSet(entry: string): Promise<Set<string>> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ['info', '--json', entry],
    stdout: 'piped',
    stderr: 'piped',
  })
  const { stdout, stderr, success } = await command.output()
  if (!success) {
    throw new Error(`'deno info --json ${entry}' failed: ${new TextDecoder().decode(stderr)}`)
  }
  // deno-lint-ignore no-explicit-any -- `deno info --json`'s own output shape, not this package's.
  const parsed: any = JSON.parse(new TextDecoder().decode(stdout))
  const byId = new Map<string, DenoInfoModule>()
  for (const module of parsed.modules ?? []) byId.set(module.specifier, module)
  // A `code.specifier` naming a bare cross-package specifier (e.g. `jsr:@zanix/utils@^4.1.0/
  // helpers`) never has a `modules` entry keyed by that exact string — only `parsed.redirects`
  // maps it to the resolved specifier (`https://jsr.io/...`) that DOES. Without following this,
  // the BFS below silently stops at every package boundary and falsely reports a clean graph.
  const redirects: Record<string, string> = parsed.redirects ?? {}
  const resolve = (specifier: string): string => redirects[specifier] ?? specifier

  // BFS strictly over `code` edges, starting from the entry itself — a `type`-only edge into a
  // module is never followed, so that module's OWN (possibly server-only) code dependencies never
  // enter the reachable set, matching what Vite actually bundles.
  const entrySpecifier = parsed.roots?.[0] ?? entry
  const visited = new Set<string>()
  const queue = [entrySpecifier]
  while (queue.length > 0) {
    const rawId = queue.shift() as string
    // The bare (pre-redirect) specifier is kept in `visited` too — it's what `reachesWorkers`/
    // `reachesFullLogger` actually pattern-match against for a cross-package edge.
    if (visited.has(rawId)) continue
    visited.add(rawId)
    const module = byId.get(resolve(rawId))
    for (const dep of module?.dependencies ?? []) {
      const next = dep.code?.specifier
      if (next && !visited.has(next)) queue.push(next)
    }
  }
  return visited
}

/** `@zanix/utils/workers` (`WorkerManager`/`processor.ts`'s real `new Worker(...)`) has no
 * browser-safe variant at all — unlike `logger`, there is no `/workers/client` to avoid a false
 * positive against, so both the bare subpath specifier AND any resolved file under its own source
 * tree count as a violation. Reached here via a plain RELATIVE import from inside `@zanix/utils`
 * itself (`logger/defaults/storage/default.ts` → `../../workers/mod.ts`), never through the bare
 * `.../workers` specifier directly — so the bare-specifier check alone would miss it. */
function reachesWorkers(specifier: string): boolean {
  if (specifier.startsWith('jsr:')) {
    return /^@zanix\/utils@[^/]+\/workers$/.test(specifier.slice('jsr:'.length))
  }
  return specifier.includes('jsr.io/@zanix/utils/') && specifier.includes('/src/modules/workers/')
}

/** `@zanix/utils/logger` (the FULL entry) vs. `/logger/client` (browser-safe) share most of their
 * own internals (`base.ts`, `defaults/storage/*`, `main.ts`) once resolved — a resolved-path check
 * like {@linkcode reachesWorkers}'s would false-positive on a legitimate `/logger/client` import
 * (`client-logger.ts`'s own, real, correct dependency). Only the un-resolved BARE specifier
 * reliably distinguishes the two, so this checks that exact string, nothing resolved. */
function reachesFullLogger(specifier: string): boolean {
  if (!specifier.startsWith('jsr:')) return false
  return /^@zanix\/utils@[^/]+\/logger$/.test(specifier.slice('jsr:'.length))
}

for (const entry of ENTRYPOINTS) {
  Deno.test(
    `${entry}: never CODE-reaches @zanix/utils/workers or the full (non-client) @zanix/utils/logger`,
    async () => {
      const reachable = await codeReachableSet(entry)
      const workerOffenders = [...reachable].filter(reachesWorkers)
      assert(
        workerOffenders.length === 0,
        `${entry} CODE-reaches @zanix/utils/workers (real new Worker(...) usage), which a real ` +
          `client bundle can never resolve:\n${workerOffenders.join('\n')}`,
      )
      const loggerOffenders = [...reachable].filter(reachesFullLogger)
      assert(
        loggerOffenders.length === 0,
        `${entry} CODE-reaches the full @zanix/utils/logger (use /logger/client instead):\n` +
          loggerOffenders.join('\n'),
      )
    },
  )
}
