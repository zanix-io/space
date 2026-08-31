import type { Plugin } from 'vite'
import { ResolutionMode } from '@deno/loader'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isAbsolute } from '@std/path'
import { isDenoSpecifier } from '@deno/vite-plugin/resolver'
import { getSharedLoader } from './deno-loader.ts'

/**
 * Fixes a module-identity bug in `@deno/vite-plugin@2.0.3`'s own resolver, not something this
 * package's design introduced.
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
 * twice. That duplicate instance is the actual root cause of a real failure, not just a theoretical
 * risk: `react-dom/server`'s `renderToStaticMarkup` installs the hooks dispatcher on ONE `react`
 * copy, and `useState()` (read from the OTHER copy) sees a null dispatcher and throws — `useState`
 * genuinely worked (no `undefined`-is-not-a-function error) but crashed on `Invalid hook call`
 * specifically because of the duplicate instance, not because of anything CJS-interop-specific.
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
 * `Loader.resolveSync(id, referrer, ResolutionMode.Import)` and returns the resulting plain absolute
 * path directly. Returning a value short-circuits Vite's plugin chain: `@deno/vite-plugin`'s own
 * `resolveId` never runs for this id (it explicitly declines anything it didn't produce itself —
 * `resolveDeno`'s own `if (id.startsWith("\x00")) return null`), so its own importer-dependent
 * wrapping-vs-unwrapping branching (the asymmetry this section documents) never gets a chance to
 * diverge for it. `referrer` itself is NOT hardcoded to `undefined` for every importer — see
 * {@linkcode resolveBareSpecifierCanonically}'s own doc for why a real referrer must be threaded
 * through for a path-scoped `scopes` override to ever apply, and why doing so doesn't reopen the
 * asymmetry this fix closes: a `node_modules`-rooted importer (every case the asymmetry above
 * actually depends on) is deliberately excluded from referrer computation, so it still resolves
 * exactly as before — referrer-less, one canonical id regardless of wrapped/unwrapped status.
 *
 * This never reconstructs `@deno/vite-plugin`'s own private `\0deno::...` id format — that is
 * deliberately avoided as too fragile, an undocumented internal format not guaranteed stable across
 * dot releases — it only ever computes a resolution result and hands a plain string back into Vite's
 * OWN resolveId chain. Nor does it introduce a second module graph:
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
 * ## A caveat that isn't one
 *
 * Because a canonically-resolved bare specifier no longer reaches `@deno/vite-plugin`'s own `load`
 * hook (it never gets wrapped into a deno-specifier id in the first place), it never gets
 * `@deno/loader`'s own TypeScript/JSX transpilation either — it falls through to Vite's native
 * filesystem loader instead (or `cjs-interop.ts`'s own `transform`-hook fallback, for CJS content).
 * A bare specifier resolving to raw, untranspiled `.ts`/`.tsx` source is not a problem in practice:
 * Vite's own transform pipeline already runs its native esbuild-based TS/TSX/JSX step on ANY file it
 * loads, completely independent of whether `@deno/loader` ever touched it first — that's one of
 * Vite's own baseline features, not something `@deno/vite-plugin` adds. A bare specifier resolving
 * to real, JSX-containing `.tsx` source transpiles and evaluates correctly end to end. No workaround
 * is needed here.
 *
 * ## The `client` environment has the identical asymmetry — a real, live HMR regression
 *
 * This plugin's `resolveId` hook runs for the `client` environment too, not only `ssr`: the exact
 * same `@deno/vite-plugin` asymmetry this file's header documents (a bare specifier resolving to two
 * different ids depending on whether its importer is itself `node_modules`-resident) reproduces just
 * as much for the `client` environment — it only needs an importer shaped like `react-dom`'s own
 * internal `require('react')` in the SSR case: a real npm package, living inside `node_modules`,
 * importing another package via a bare specifier. Confirmed empirically (`zanix space dev --renderer
 * preact`, a real, published `jsr:@zanix/space@0.3.1` consumer project, Preact comet HMR silently
 * not applying): the served dev responses showed `@prefresh/core`'s own `import { Component } from
 * 'preact'` resolving to
 * `/@fs/<abs-path>/node_modules/.deno/preact@.../preact/dist/preact.module.js` (the "wrapped
 * importer" branch's plain-absolute-path output, taking Vite's `/@fs/` route), while the SAME
 * physical file, reached through `preact/jsx-runtime`'s own internal (relative, not bare) import of
 * `preact`, resolved to the "clean" `/node_modules/.deno/preact@.../preact/dist/preact.module.js`
 * route instead — two different module ids, two different `preact` instances, two different
 * `options` objects. Preact's Fast Refresh depends on `@prefresh/core` patching the SAME `options`
 * singleton object Preact's own `createElement`/`jsxDEV` reads from (see `@prefresh/core`'s own
 * `runtime/vnode.js`) — with two instances, `@prefresh/core`'s `vnodesForComponent.get(OldType)`
 * (`replaceComponent`, `@prefresh/core`'s own `src/index.js`) always misses, and `flushUpdates()`
 * completes with zero error and zero effect: a real Comet edit re-imports successfully (a genuine
 * `200 OK` for the cache-busted module URL, confirmed via the dev socket's own
 * `client-module-changed` → `window.__spaceApplyClientUpdate` path all firing correctly), yet the
 * DOM never updates and nothing is logged — indistinguishable, from the outside, from Comet HMR
 * simply not working at all.
 *
 * React never reproduced this because its dev-mode Fast Refresh here has no equivalent ingredient:
 * under Vite 8/Rolldown, `react()` (`space-plugin.ts`) uses Rolldown's own native `oxc.jsx` refresh
 * transform, not a Babel-injected npm package — there is no `node_modules`-resident package
 * analogous to `@prefresh/core` importing `react`/`react-dom` via a bare specifier for the asymmetry
 * to ever trigger. Preact's toolchain (`@prefresh/vite`/`@prefresh/core`/`@prefresh/utils`, real npm
 * packages, real bare-specifier imports of `preact` from inside `node_modules`) is what supplies the
 * missing ingredient — which is also why this went unnoticed until Preact HMR was specifically
 * exercised against a real published consumer project rather than this repo's own fixtures (most of
 * which, per this file's own note above, never populate a real on-disk `node_modules` the asymmetry
 * needs to diverge from Vite's plain resolver in the first place).
 *
 * The fix is the same one already proven for `ssr`: let this plugin's canonical resolution run for
 * `client` too, so `@deno/vite-plugin`'s own asymmetric branch never gets a chance to diverge there
 * either. Nothing about {@linkcode resolveBareSpecifierCanonically} itself is `ssr`-specific — `root`
 * comes from `this.environment.config.root` (already environment-agnostic), and the packages this
 * matters for (`preact`, `@prefresh/core`, `@prefresh/utils`) are plain, isomorphic ESM with no
 * `browser`-vs-`node` export-condition split for `@deno/loader`'s resolution to get wrong.
 */
/**
 * The actual canonical resolution, factored out so `cjs-interop.ts` can call it directly — not
 * just for reuse's sake, but because relying on {@linkcode canonicalBareSpecifierResolvePlugin}'s
 * own `resolveId` hook alone is not enough for a bare specifier referenced from inside
 * `cjs-interop.ts`'s own hand-written bundle text. That is a second, separate gap on top of the
 * asymmetry above: Vite's own module-runner `fetchModule` (what `__vite_ssr_import__` actually
 * calls into at runtime) has a fast path — `!isFileUrl && importer && url[0] !== "." && url[0] !==
 * "/"` (`vite/dist/node/chunks/node.js`'s own `fetchModule`) — that, for ANY bare specifier called
 * with a known importer, resolves it via Vite's own plain Node-style `tryNodeResolve` and returns
 * immediately, WITHOUT ever calling the plugin container's `resolveId` — meaning
 * `canonicalBareSpecifierResolvePlugin`'s hook never runs for this call shape at all, no matter
 * where it sits in the `plugins` array. This is invisible for a real npm package like `react`, since
 * `@deno/loader`'s own resolution and Vite's plain Node resolution happen to agree on the same
 * physical `node_modules` path — but it fails outright for anything ONLY resolvable through a
 * Deno-specific mechanism (an import-map alias, `jsr:`, ...), as exercised by this package's own
 * regression fixtures (`@test-fixtures/pkg-c`, `@test-fixtures/pkg-d`). `cjs-interop.ts` therefore
 * resolves a bare `require()`/bare bare-import target with THIS function itself before ever calling
 * `__vite_ssr_import__`, handing it an already-resolved absolute path (which fails the fast path's
 * own `url[0] !== "/"` check, so it takes the NORMAL, plugin-aware resolution route instead) — using
 * the exact same resolution as `resolveId` above, so both call sites still agree on one canonical id
 * for one physical file.
 *
 * `root` must be the SAME Vite project root the specifier's own importer resolves against — passed
 * through to `deno-loader.ts`'s own `getSharedLoader(root)`, which is cached per discovered
 * `deno.json`, not a single root-agnostic singleton (see that function's own doc for the
 * `Invalid hook call` failure this guards against: without it, this function and Vite's own plain
 * Node fast path above can each resolve the SAME bare specifier to a DIFFERENT physical file the
 * moment the target project has its own real, on-disk `node_modules`).
 *
 * ## `importer` — required for a path-scoped `scopes` override to apply at all
 *
 * `importer` (the plain absolute path of the file doing the importing, when Vite/Rollup's own
 * `resolveId(source, importer, options)` hook shape provides one) is forwarded to
 * `loader.resolveSync` as its own `referrer` argument, via {@linkcode referrerUrlFor}. This is not
 * an optional refinement — per the WHATWG Import Maps spec `@deno/loader` implements, a `scopes`
 * entry is matched against the REFERRER's own URL, not the bare specifier alone; calling
 * `resolveSync` with `referrer: undefined` (this function's own behavior before this fix) makes
 * every `scopes` entry structurally unreachable, unconditionally, for every resolution this
 * function ever performs — regardless of whether the specifier's prefix is even ambiguous.
 *
 * A consuming project's own `deno.json` declaring a top-level `utils/` alias for its own
 * `./src/utils/`, alongside a separate, correctly-scoped `scopes["../server/"]["utils/"]` override
 * redirecting a linked dependency's (e.g. `@zanix/server`'s) own bare `utils/` imports to that
 * dependency's real `../server/src/utils/` instead, is exactly the shape a referrer-less call gets
 * wrong (confirmed correct at the plain Deno-resolution layer via `deno info --json`, which honors
 * the referrer/scope relationship natively). Because this plugin is registered AHEAD of `deno()` in
 * `createSpaceDevEngine`'s own `plugins` array and always short-circuits (see this file's own
 * header doc), a referrer-less call intercepts `mod.ts`'s own `utils/targets.ts` import, matches
 * only the TOP-LEVEL `imports["utils/"]` entry (the only one reachable with no referrer), and
 * resolves it against the consuming project's own `src/utils/` directory — a file that may not even
 * exist there — instead of the dependency's own real `src/utils/targets.ts`, surfacing as `Failed
 * to load url /src/utils/targets.ts (resolved id: .../<consumer>/src/utils/targets.ts) in
 * .../server/mod.ts`. `@deno/vite-plugin`'s own `resolveViteSpecifier` (`resolver.js`) already
 * computes this exact referrer for a plain-file importer via its own internal (unexported)
 * `memberReferrerUrl` specifically so "a member-scoped entry wins over the root map on a name
 * collision" — this function's `referrerUrlFor` mirrors that same, already-proven-correct exclusion
 * set (a deno-wrapped importer, a `node_modules`-rooted one, and Vite's own `/@fs/`/`/@id/`
 * dev-server-only virtual paths, none of which are real project source a `scopes` entry should ever
 * match against) using `@deno/vite-plugin`'s own public `isDenoSpecifier`, rather than inventing a
 * new one.
 *
 * This is a correctness fix, not a reintroduction of the module-identity asymmetry described above:
 * that asymmetry was about the SAME target file getting two different Vite module ids depending on
 * importer type (wrapped vs. plain). Threading a real referrer through changes the TARGET a
 * genuinely scope-ambiguous specifier resolves to — the outcome a `scopes` override exists to
 * produce — while an unambiguous specifier (no matching `scopes` entry) resolves identically with
 * or without a referrer, since the WHATWG resolution algorithm falls back to the same top-level
 * `imports` map either way. No new per-importer id divergence is introduced for any specifier a
 * project doesn't itself choose to scope differently.
 */
function referrerUrlFor(importer: string | undefined): string | undefined {
  if (importer === undefined || isDenoSpecifier(importer)) return undefined
  const importerPath = importer.split('?')[0]
  if (
    !isAbsolute(importerPath) || importerPath.startsWith('/@') ||
    importerPath.includes('/node_modules/')
  ) {
    return undefined
  }
  return pathToFileURL(importerPath).href
}

export async function resolveBareSpecifierCanonically(
  id: string,
  root: string,
  importer?: string,
): Promise<string | null> {
  // Only a genuinely bare specifier — relative, absolute, Vite/Rollup virtual ids (`\0...`), and
  // scheme-prefixed specifiers (`npm:`, `jsr:`, `http(s):`) are left entirely to the existing
  // pipeline; this function only ever narrows what it's confirmed safe to canonicalize.
  if (
    id.startsWith('.') || id.startsWith('/') || id.startsWith('\0') ||
    SCHEME_RE.test(id)
  ) {
    return null
  }
  const loader = await getSharedLoader(root)
  let resolved: string
  try {
    resolved = loader.resolveSync(id, referrerUrlFor(importer), ResolutionMode.Import)
  } catch {
    return null // not resolvable this way — let the existing pipeline try its own resolution
  }
  if (!resolved.startsWith('file://')) return null // npm:/jsr:/http: — not this function's concern
  return fileURLToPath(resolved)
}

export function canonicalBareSpecifierResolvePlugin(): Plugin {
  return {
    name: 'zanix-space-dev-canonical-bare-specifier-resolve',
    resolveId(id, importer) {
      const envName = this.environment?.name
      if (envName !== 'ssr' && envName !== 'client') return null
      return resolveBareSpecifierCanonically(id, this.environment.config.root, importer)
    },
  }
}

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/
