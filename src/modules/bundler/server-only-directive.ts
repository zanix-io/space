import { basename } from '@std/path'

/** A leading `'server-only'`/`"server-only"` directive prologue — the same grammar slot (and
 * detection style) as `'use comet'`/`'use strict'`: a plain string-literal expression statement,
 * allowed to be preceded by comments, before any other code. Declares the module it appears in as
 * one that must never reach a client (Comet) bundle — enforced by {@linkcode cometPlugin} at build
 * time (fails with the offending import chain if a Comet's own module graph ever reaches one) and,
 * in dev, by `dev-engine.ts`'s own `transformClientAsset` (same violation, reported per-request
 * instead of at `buildEnd`, since dev never runs a real Rollup build to walk).
 *
 * Deliberately a directive, not an import of some marker package (the way the npm `server-only`
 * package works for React apps, via bundler export-condition tricks): Space already has exactly
 * this convention for `'use comet'` (see `comet-directive.ts`), a directive costs nothing at
 * runtime (no module to resolve, no package to install, no export-condition wiring), and
 * `cometPlugin`'s `transform` hook already reads every module's `code` once per build regardless —
 * checking it against a second regex is free, not an extra pass over the source tree.
 *
 * Lives in its own module (mirroring `comet-directive.ts`) so a future second enforcement site, if
 * one is ever justified, reads the exact same regex — never a second, independently-maintained one
 * that could silently drift from this one. {@linkcode formatServerOnlyViolation} is the second half
 * of that same "one shared implementation, two call sites" contract, for the VIOLATION MESSAGE
 * itself.
 */
export const SERVER_ONLY_DIRECTIVE =
  /^(?:\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/)*\s*(['"])server-only\1;?/

/**
 * Renders a `'server-only'` violation exactly as a developer needs to fix it — shared verbatim
 * between {@linkcode cometPlugin} (build, given a full Rollup reverse-graph chain) and
 * `dev-engine.ts`'s own `transformClientAsset` (dev, given whatever chain `EnvironmentModuleNode`'s
 * own `importers` could reconstruct at the time of the request — possibly just the one offending
 * file itself, if dev hasn't discovered a further importer yet). `chain` is ordered
 * `[comet-or-closest-known-importer, ...intermediates, server-only module]`, i.e. the same
 * "offending Comet first, violation last" order {@linkcode SERVER_ONLY_DIRECTIVE}'s own doc
 * anticipates — a single-element `chain` (the server-only module alone, no importer resolved yet)
 * still renders something actionable, just without an import trail.
 *
 * Uses each file's own basename (never the full, often temp-dir-cluttered absolute path) — a chain
 * is only ever a handful of modules deep in practice, so the basenames alone are enough to locate
 * the fix.
 */
export function formatServerOnlyViolation(chain: string[]): string {
  const names = chain.map((id) => basename(id))
  const [head, ...rest] = names
  const lines = [head, ...rest.map((name, i) => `${'  '.repeat(i + 1)}→ ${name}`)]
  const violatingFile = names.at(-1)
  return `Server-only module imported into client Comet:\n\n${lines.join('\n')}\n\n` +
    `Fix: resolve whatever '${violatingFile}' computes in the page/layout that renders this ` +
    `Comet (server-side), then pass the result down as a plain prop — never import a ` +
    `'server-only' module (or anything that imports one, directly or transitively) from a ` +
    `'use comet' file.`
}
