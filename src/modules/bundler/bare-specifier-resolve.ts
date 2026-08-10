import type { Plugin } from 'vite'
import { ResolutionMode } from '@deno/loader'
import { fileURLToPath } from 'node:url'
import { getSharedLoader } from './deno-loader.ts'

/**
 * Fixes a real, confirmed module-identity bug in `@deno/vite-plugin@2.0.3`'s own resolver, not
 * something this package's design introduced — found while integrating `cjs-interop.ts`, and
 * validated with a disposable spike (10/10 criteria: cross-path identity, a real React SSR render,
 * CJS→CJS, CJS→ESM, ESM→ESM, invalidation, plain project-relative resolution) before this file was
 * written as production code.
 *
 * ## The asymmetry
 *
 * `@deno/vite-plugin`'s own `resolveViteSpecifier` (`resolver.js`) resolves a bare specifier
 * (`'react'`) differently depending on WHO is asking:
 * - From an importer that is NOT itself one of `@deno/vite-plugin`'s own deno-wrapped virtual ids
 *   (e.g. a plain project file like a page module) — it resolves through `resolveDeno()`, checks
 *   whether the target sits inside the Vite project root, and — for anything outside it (every
 *   `node_modules` package) — wraps the result into its own private virtual id format
 *   (`toDenoSpecifier`, `\0deno::<loader>::<id>::<resolved>#deno`).
 * - From an importer that IS itself one of those wrapped ids (any `node_modules` file — which is
 *   every file `cjs-interop.ts` touches, and in practice most of `node_modules`) — a DIFFERENT
 *   branch runs: it resolves the specifier and, for any `file://` result, returns the PLAIN,
 *   UNWRAPPED absolute path immediately, unconditionally — never checking the project-root rule,
 *   never wrapping.
 *
 * The result: the exact same physical file gets TWO different ids in Vite's module graph depending
 * on who imports it — `page.tsx`'s own `import 'react'` lands on the wrapped id, while
 * `react-dom`'s own internal `require('react')` (reached through `cjs-interop.ts`, itself always a
 * `node_modules`-and-therefore-wrapped importer) lands on the plain one. Vite instantiates `react`
 * twice. Confirmed as the actual root cause of a real failure, not a theory: `react-dom/server`'s
 * `renderToStaticMarkup` installs the hooks dispatcher on ONE `react` copy, and `useState()` (read
 * from the OTHER copy) sees a null dispatcher and throws — `useState` genuinely worked (no
 * `undefined`-is-not-a-function error) but crashed on `Invalid hook call` specifically because of
 * the duplicate instance, not because of anything CJS-interop-specific.
 *
 * This isn't unique to CJS at all — the asymmetry is about whether the IMPORTER is deno-wrapped,
 * nothing about CJS vs ESM — so a real ESM package importing another real ESM package from inside
 * `node_modules` would hit the identical bug. `cjs-interop.ts` just happens to be what surfaces it
 * in practice, since virtually everything it touches is a wrapped importer.
 *
 * ## The fix: resolve canonically, ahead of `@deno/vite-plugin`, using only its public API
 *
 * Registered BEFORE `deno()` in `createSpaceDevEngine`'s own `plugins` array. For a genuinely bare
 * specifier only (never relative/absolute/virtual/scheme-prefixed — those are left entirely to the
 * existing pipeline, untouched), this resolves it via `@deno/loader`'s own public
 * `Loader.resolveSync(id, undefined, ResolutionMode.Import)` — `referrer: undefined` is the exact
 * same call shape `@deno/vite-plugin`'s own `resolveDeno()` uses for a NON-wrapped importer — and
 * returns the resulting plain absolute path directly, for EVERY importer alike. Returning a value
 * short-circuits Vite's plugin chain: `@deno/vite-plugin`'s own `resolveId` never runs for this id
 * (it explicitly declines anything it didn't produce itself — `resolveDeno`'s own `if
 * (id.startsWith("\x00")) return null`), so its importer-dependent branching never gets a chance to
 * diverge. Same specifier, same referrer strategy, every time — that's what makes this canonical.
 *
 * This never reconstructs `@deno/vite-plugin`'s own private `\0deno::...` id format (the disposable
 * spike explicitly ruled that approach out first, as too fragile — an undocumented internal format
 * not guaranteed stable across dot releases) — it only ever computes a resolution result and hands
 * a plain string back into Vite's OWN resolveId chain. Nor does it introduce a second module graph:
 * this function owns no `Map<id, moduleInstance>` of its own — the only state involved is
 * `deno-loader.ts`'s shared `Loader`, a stateless resolver, not a module cache. Vite's own module
 * graph remains the single place that caches, dedupes, and invalidates every module this pipeline
 * touches, bare-specifier or not.
 *
 * `canonicalBareSpecifierResolvePlugin`'s own `resolveId` hook is exactly the right fix for a
 * NORMAL import/export statement (resolved at Vite's own transform time). It is NOT, on its own,
 * enough for a bare specifier referenced from inside `cjs-interop.ts`'s own hand-written bundle
 * text — see {@linkcode resolveBareSpecifierCanonically}'s own doc below for the second, separate
 * finding that requires calling the SAME resolution directly from there too.
 *
 * ## A caveat that turned out not to be one — checked empirically, not assumed
 *
 * Because a canonically-resolved bare specifier no longer reaches `@deno/vite-plugin`'s own `load`
 * hook (it never gets wrapped into a deno-specifier id in the first place), it never gets
 * `@deno/loader`'s own TypeScript/JSX transpilation either — it falls through to Vite's native
 * filesystem loader instead (or `cjs-interop.ts`'s own `transform`-hook fallback, for CJS content).
 * Before shipping this, that looked like a real risk: a bare specifier resolving to raw, untranspiled
 * `.ts`/`.tsx` source seemed like it could reach the evaluator unparsed. Confirmed by a real
 * regression test that it is NOT a problem in practice: Vite's own transform pipeline already runs
 * its native esbuild-based TS/TSX/JSX step on ANY file it loads, completely independent of whether
 * `@deno/loader` ever touched it first — that's one of Vite's own baseline features, not something
 * `@deno/vite-plugin` adds. A bare specifier resolving to real, JSX-containing `.tsx` source
 * transpiles and evaluates correctly end to end. No workaround was needed here.
 */
/**
 * The actual canonical resolution, factored out so `cjs-interop.ts` can call it directly — not
 * just for reuse's sake, but because relying on {@linkcode canonicalBareSpecifierResolvePlugin}'s
 * own `resolveId` hook alone is not enough for a bare specifier referenced from inside
 * `cjs-interop.ts`'s own hand-written bundle text. Confirmed empirically, a second real finding on
 * top of the asymmetry above: Vite's own module-runner `fetchModule` (what `__vite_ssr_import__`
 * actually calls into at runtime) has a fast path — `!isFileUrl && importer && url[0] !== "." &&
 * url[0] !== "/"` (`vite/dist/node/chunks/node.js`'s own `fetchModule`) — that, for ANY bare
 * specifier called with a known importer, resolves it via Vite's own plain Node-style
 * `tryNodeResolve` and returns immediately, WITHOUT ever calling the plugin container's `resolveId`
 * — meaning `canonicalBareSpecifierResolvePlugin`'s hook never runs for this call shape at all, no
 * matter where it sits in the `plugins` array. This is invisible for a real npm package like
 * `react`, since `@deno/loader`'s own resolution and Vite's plain Node resolution happen to agree
 * on the same physical `node_modules` path — but it fails outright for anything ONLY resolvable
 * through a Deno-specific mechanism (an import-map alias, `jsr:`, ...), which is exactly what this
 * package's own regression fixtures (`@test-fixtures/pkg-c`, `@test-fixtures/pkg-d`) exist to prove.
 * `cjs-interop.ts` therefore resolves a bare `require()`/bare bare-import target with THIS function
 * itself before ever calling `__vite_ssr_import__`, handing it an already-resolved absolute path
 * (which fails the fast path's own `url[0] !== "/"` check, so it takes the NORMAL, plugin-aware
 * resolution route instead) — using the exact same resolution as `resolveId` above, so both call
 * sites still agree on one canonical id for one physical file.
 *
 * `root` must be the SAME Vite project root the specifier's own importer resolves against — passed
 * through to `deno-loader.ts`'s own `getSharedLoader(root)`, which is cached per discovered
 * `deno.json`, not a single root-agnostic singleton (see that function's own doc for the real,
 * confirmed `Invalid hook call` regression this guards against: without it, this function and
 * Vite's own plain Node fast path above can each resolve the SAME bare specifier to a DIFFERENT
 * physical file the moment the target project has its own real, on-disk `node_modules`).
 */
export async function resolveBareSpecifierCanonically(
  id: string,
  root: string,
): Promise<string | null> {
  // Only a genuinely bare specifier — relative, absolute, Vite/Rollup virtual ids (`\0...`), and
  // scheme-prefixed specifiers (`npm:`, `jsr:`, `http(s):`) are left entirely to the existing
  // pipeline; this function only ever narrows what it's confirmed safe to canonicalize.
  if (id.startsWith('.') || id.startsWith('/') || id.startsWith('\0') || SCHEME_RE.test(id)) {
    return null
  }
  const loader = await getSharedLoader(root)
  let resolved: string
  try {
    resolved = loader.resolveSync(id, undefined, ResolutionMode.Import)
  } catch {
    return null // not resolvable this way — let the existing pipeline try its own resolution
  }
  if (!resolved.startsWith('file://')) return null // npm:/jsr:/http: — not this function's concern
  return fileURLToPath(resolved)
}

export function canonicalBareSpecifierResolvePlugin(): Plugin {
  return {
    name: 'zanix-space-dev-canonical-bare-specifier-resolve',
    resolveId(id) {
      if (this.environment?.name !== 'ssr') return null
      return resolveBareSpecifierCanonically(id, this.environment.config.root)
    },
  }
}

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/
