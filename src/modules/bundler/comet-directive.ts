/** A leading `'use comet'`/`"use comet"` directive prologue — the same grammar slot (and detection
 * style) as `'use strict'`/React Server Components' `'use client'`: a plain string-literal
 * expression statement, allowed to be preceded by comments, before any other code. This is a
 * heuristic regex check, not a full parse — deliberately, since it only ever needs to recognize a
 * convention this package itself defines, never arbitrary third-party source.
 *
 * Shared between `comet-plugin.ts` (build-time chunk-splitting/manifest) and `discover-comets.ts`
 * (build-time entry discovery, for `buildSpaceClient`) so both ever recognize the exact same set
 * of files — never two independently-maintained regexes that could silently drift apart.
 */
export const USE_COMET_DIRECTIVE = /^(?:\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/)*\s*(['"])use comet\1;?/
