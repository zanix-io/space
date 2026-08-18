/** A leading `'server-only'`/`"server-only"` directive prologue — the same grammar slot (and
 * detection style) as `'use comet'`/`'use strict'`: a plain string-literal expression statement,
 * allowed to be preceded by comments, before any other code. Declares the module it appears in as
 * one that must never reach a client (Comet) bundle — enforced by {@linkcode cometPlugin}, which
 * fails the build with the offending import chain if a Comet's own module graph ever reaches one.
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
 * that could silently drift from this one.
 */
export const SERVER_ONLY_DIRECTIVE =
  /^(?:\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/)*\s*(['"])server-only\1;?/
