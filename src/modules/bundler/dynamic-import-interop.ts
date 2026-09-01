import type { Plugin } from 'vite'
import type { LoadContext, OnLoadResult } from '@deno/vite-plugin'
import { maskComments } from './cjs-interop.ts'

/**
 * Fixes a real `zanix space dev` blocker distinct from every other fix in this directory: a truly
 * dynamic `import(specifier)` call — one whose argument Vite's own import-analysis cannot resolve
 * to a plain string literal at build time (a variable, a member expression, a template literal
 * with real `${...}` interpolation) — is left completely untouched by Vite's SSR transform. Vite's
 * own warning names this explicitly: "The above dynamic import cannot be analyzed by Vite... If
 * this is intended to be left as-is, you can use the `/* @vite-ignore *‍/` comment". Left as native
 * `import(...)` syntax, such a call reaches the SSR module runner as a genuine, unintercepted
 * dynamic `import()` — it never goes through `resolveId`/`onLoad`/`transform` at all, so it never
 * gets `noExternal: true`'s bundling, {@linkcode wrapCjsIfNeeded}'s CJS interop, or any other
 * SSR-pipeline fix in this directory. Confirmed as the real, sole cause of a `zanix space dev`
 * crash reached via a genuine, deliberate lazy-dependency pattern (an npm-package-style constant
 * string held in a variable so an optional dependency is never imported at module-evaluation time
 * unless actually used): `ReferenceError: exports is not defined` at a transitively-required CJS
 * npm dependency's own entry file, resolved through the project's real on-disk `node_modules` (the
 * exact symptom {@linkcode wrapCjsIfNeeded}'s own header doc already describes for `react`'s CJS
 * entry — same failure class, reached through a path that fix's own `onLoad`/`transform` hooks
 * never see, since neither one ever runs for a module a raw `import()` loads directly).
 *
 * The fix: force such a call through the SAME runtime helper (`__vite_ssr_dynamic_import__`) Vite's
 * own import-analysis ALREADY rewrites an analyzable dynamic import to — that identifier is a real,
 * bound parameter in the scope of every module `RealImportEvaluator.runInlinedModule`
 * (`ssr-module-evaluator.ts`) executes, so calling it directly here is not a new mechanism, only a
 * manual application of the one Vite's own SSR transform already uses for the cases it CAN analyze.
 * Doing so routes the call back through the module runner's own `resolveId`/`load`/`transform`
 * cycle — the same one every static `import` in the graph already goes through — closing the gap
 * for exactly the shape Vite's own transform declines to touch.
 *
 * A plain string-literal argument (`import('foo')`) or a template literal with no `${...}` hole
 * (`` import(`foo`) ``) is left untouched — Vite's own transform already rewrites those correctly
 * on its own; rewriting them again here would be redundant, not incorrect, but every other fix in
 * this directory stays as narrowly scoped as the real bug it closes, and this one follows the same
 * discipline.
 */

const DYNAMIC_IMPORT_RE = /\bimport\s*\(/g

// Recognizes exactly the argument shapes Vite's own import-analysis already resolves statically —
// a single-quoted, double-quoted, or interpolation-free template-literal string, with nothing else
// before the call's closing `)`. Matched against the text immediately following the `import(` this
// file's own scan found; anything that does NOT match here is what Vite's own warning calls
// "cannot be analyzed", and is exactly what this file exists to force through the runtime helper
// instead.
const SIMPLE_LITERAL_ARG_RE =
  /^\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\$]|\\.|\$(?!\{))*`)\s*\)/

const SSR_DYNAMIC_IMPORT_HELPER = '__vite_ssr_dynamic_import__('

/**
 * Rewrites every unanalyzable `import(...)` in `code` to call `__vite_ssr_dynamic_import__(...)`
 * instead — same argument, only the callee changes — so it goes through the SSR module runner
 * instead of executing as a raw, unintercepted native dynamic import. Returns `code` unchanged
 * (the SAME reference, so a caller can cheaply tell nothing changed) when there is nothing to
 * rewrite — the same "not my concern" contract every transform in this directory follows.
 */
export function forceUnanalyzableDynamicImports(code: string): string {
  if (!code.includes('import')) return code // cheap reject before the full tokenizer scan below

  const masked = maskComments(code)
  const matches = [...masked.matchAll(DYNAMIC_IMPORT_RE)]
  if (matches.length === 0) return code

  let rewritten = ''
  let lastIndex = 0
  let changed = false

  for (const match of matches) {
    const matchStart = match.index
    const argStart = matchStart + match[0].length
    // Checked against the ORIGINAL `code`, never `masked` — `masked` only blanks comments, and the
    // real string content right after the call matters here.
    if (SIMPLE_LITERAL_ARG_RE.test(code.slice(argStart))) continue

    rewritten += code.slice(lastIndex, matchStart) + SSR_DYNAMIC_IMPORT_HELPER
    lastIndex = argStart
    changed = true
  }
  if (!changed) return code

  rewritten += code.slice(lastIndex)
  return rewritten
}

function toResult(code: string, original: string): OnLoadResult | null {
  return code === original ? null : { code }
}

/**
 * `deno()`'s own `onLoad` integration point — the primary path, mirroring
 * {@linkcode denoOnLoadCjsInterop}'s own shape exactly. Unlike that fix, this one applies
 * regardless of a module's CJS/ESM shape — a genuinely dynamic `import(...)` can appear in either
 * kind of source, and `metadata.ts`'s own real crash (this file's own header doc) originates in a
 * plain ESM file, never a CJS one.
 */
export function denoOnLoadDynamicImportInterop(): (ctx: LoadContext) => OnLoadResult | null {
  return (ctx) => {
    if (!ctx.ssr) return null
    return toResult(forceUnanalyzableDynamicImports(ctx.code), ctx.code)
  }
}

/**
 * A second, independent safety net alongside {@linkcode denoOnLoadDynamicImportInterop} — same
 * reasoning as {@linkcode cjsInteropFallbackPlugin}'s own doc: the same module can reach the
 * evaluator through a resolution path that skips `deno()`'s own `onLoad` entirely, and a generic
 * `transform` hook fires regardless of which path it arrived through.
 */
export function dynamicImportInteropFallbackPlugin(): Plugin {
  return {
    name: 'zanix-space-dev-dynamic-import-interop-fallback',
    transform(code) {
      if (this.environment?.name !== 'ssr') return null
      return toResult(forceUnanalyzableDynamicImports(code), code)
    },
  }
}
