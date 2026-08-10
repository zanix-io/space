import type { Plugin, ResolvedConfig } from 'vite'
import { dirname, resolve as resolvePath } from '@std/path'
import { type Loader, Workspace } from '@deno/loader'
import { resolveDeno } from '@deno/vite-plugin/resolver'
import { discoverComets } from './discover-comets.ts'
import { findDenoConfigPath } from './deno-loader.ts'

// `Plugin`/`ResolvedConfig` are intentionally NOT re-exported — same accepted, structural
// `deno doc --lint` finding already established by `space-plugin.ts`'s own doc comment.

/** A SEPARATE loader instance from `deno-loader.ts`'s own `getSharedLoader()` — that one is
 * `platform: 'node'`, deliberately scoped to this project's own SSR-side resolution needs
 * (`cjs-interop.ts`, `bare-specifier-resolve.ts` — see its own doc). This plugin resolves modules
 * a real BROWSER will load, so `platform: 'browser'` is the semantically correct choice — for a
 * package with platform-conditional `exports` (unlike `react`/`react-dom`, which don't
 * discriminate node/browser within the same subpath, confirmed empirically), reusing the SSR
 * loader here could silently resolve the wrong file.
 *
 * Cached per discovered config path, never a single process-wide singleton — confirmed the hard
 * way that this matters: constructing one `Workspace` with no explicit `configPath` at all falls
 * back to auto-discovering from the process's own `Deno.cwd()`, which is `@zanix/space`'s own
 * development root while iterating on `@zanix/space` itself (this plugin's real, intended target
 * is always some OTHER app's `config.root`) — silently correct only by coincidence, for whichever
 * specifiers both configs happen to declare identically (`react`, in that spike), and silently
 * WRONG for anything declared only in the real target app's own `deno.json` (a real, separate npm
 * dependency — `ms` — imported through a Comet's own relative helper file, in that same spike).
 * Each loader still only ever computes resolutions on demand, never caches a module instance, so
 * sharing one across calls for the SAME root creates no second source of module identity — the
 * same guarantee `getSharedLoader()`'s own doc already establishes (that one is ALSO cached per
 * discovered config path now, not a bare singleton, fixed for the identical reason).
 *
 * Deliberately never calls `loader.addEntrypoints(...)` — a real app's own `node_modules` is
 * already fully materialized by the time this plugin's `configResolved` ever runs (Deno's own
 * `nodeModulesDir: 'auto'` resolves every bare specifier the app's `deno.json` declares as part
 * of the SAME `deno run` invocation that starts `zanix space dev` in the first place, well before
 * this plugin gets a chance to run), so `resolveDeno`/`loader.resolveSync` already succeeds
 * without it for anything genuinely declared there. `addEntrypoints` was tried and reverted: it
 * has a real, confirmed side effect beyond THIS loader's own graph — triggering it against a
 * freshly-created project (never previously run through a real `deno run`, only true of a
 * disposable verification spike's own artificially-constructed temp project, never a real app)
 * broke the unrelated `ssr` environment's OWN, already-correct dependency resolution
 * (`RealImportEvaluator`/`bare-specifier-resolve.ts`'s own fix), the exact kind of cross-cutting
 * regression this file's own `ssr`-scoping comments elsewhere already guard against.
 */
const browserLoadersByConfigPath = new Map<string, Promise<Loader>>()
function getBrowserLoader(root: string): Promise<Loader> {
  const configPath = findDenoConfigPath(root)
  const key = configPath ?? ''
  let loaderPromise = browserLoadersByConfigPath.get(key)
  if (!loaderPromise) {
    loaderPromise = new Workspace({ platform: 'browser', configPath }).createLoader()
    browserLoadersByConfigPath.set(key, loaderPromise)
  }
  return loaderPromise
}

/** Every bare specifier any environment's own resolved `optimizeDeps.include` lists — the
 * complete, deduplicated set this plugin needs to resolve. Vite populates `include` itself
 * (`@vitejs/plugin-react`'s own React-detection heuristic is one real source; there may be
 * others, present or future, for a different renderer or a different plugin entirely) — this
 * function never assumes WHY a specifier ended up there, only that it did. */
function collectOptimizeDepsIncludeSpecifiers(config: ResolvedConfig): string[] {
  const specifiers = new Set<string>()
  for (const spec of config.optimizeDeps?.include ?? []) specifiers.add(spec)
  for (const environment of Object.values(config.environments ?? {})) {
    for (const spec of environment.optimizeDeps?.include ?? []) specifiers.add(spec)
  }
  return [...specifiers]
}

/** Matches `from '<spec>'`/`from "<spec>"` (covers both `import ... from` and `export ... from`,
 * regardless of what precedes `from` — braces, `*`, `type`, a default binding, ...), a bare
 * `import '<spec>'` side-effect import (no `from`), and `import('<spec>')`. A heuristic scan over
 * source text, not a real parser — same deliberate simplicity `comet-directive.ts`'s own
 * `USE_COMET_DIRECTIVE` and `@deno/vite-plugin`'s own `HTTP_IMPORT_RE` already establish for this
 * codebase and its own dependencies; a template-literal dynamic import (`` import(`${x}`) ``) is
 * the same known, accepted gap `HTTP_IMPORT_RE`'s own doc calls out. */
const FROM_SPECIFIER_RE = /\bfrom\s+(['"])([^'"]+)\1/g
const BARE_IMPORT_RE = /(?:^|[;\n{}])\s*import\s+(['"])([^'"]+)\1/g
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g

function extractImportSpecifiers(source: string): string[] {
  const specifiers = new Set<string>()
  for (const re of [FROM_SPECIFIER_RE, BARE_IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(source))) specifiers.add(match[2])
  }
  return [...specifiers]
}

/** Resolves a relative import (`./x`, `../x`) to a real file on disk, trying the raw path first
 * (an author who already wrote the extension), then each real source extension in turn — the
 * same simple, extension-probing resolution `RealImportEvaluator`'s own materialized files rely
 * on implicitly via Deno's native resolution, applied by hand here since this walk happens before
 * Vite's own resolver is involved at all. `null` for a specifier that resolves to nothing real
 * (a typo, a `.css`/asset import this scan doesn't need to follow further). */
async function resolveRelativeImportPath(
  fromFile: string,
  specifier: string,
): Promise<string | null> {
  const rawPath = resolvePath(dirname(fromFile), specifier)
  const candidates = ['', '.tsx', '.ts', '.jsx', '.js'].map((ext) => rawPath + ext)
  // All candidates checked in parallel (never a sequential try/one-at-a-time loop), then the
  // first match in extension-priority order wins — same result a sequential probe would give,
  // without an `await` inside a loop.
  const stats = await Promise.all(
    candidates.map((candidate) => Deno.stat(candidate).catch(() => null)),
  )
  const matchIndex = stats.findIndex((stat) => stat?.isFile)
  return matchIndex === -1 ? null : candidates[matchIndex]
}

/** Walks `filePath`'s own import graph, following ONLY relative imports (never a bare specifier
 * further — that's a leaf, collected into `bareSpecifiers` and never opened, the same reasoning
 * `resolveDeno` itself needs no help following an npm package's OWN internal imports; only THIS
 * project's own relative-import chain needs manual walking, since that's the part no existing
 * resolver here does ahead of time). `visited` guards against revisiting the same file through
 * two different comets that share a helper, and against an accidental relative import cycle. */
async function collectBareSpecifiersFromFile(
  filePath: string,
  visited: Set<string>,
  bareSpecifiers: Set<string>,
): Promise<void> {
  if (visited.has(filePath)) return
  visited.add(filePath)

  let source: string
  try {
    source = await Deno.readTextFile(filePath)
  } catch {
    return
  }

  await Promise.all(
    extractImportSpecifiers(source).map(async (specifier) => {
      if (specifier.startsWith('.')) {
        const resolved = await resolveRelativeImportPath(filePath, specifier)
        if (resolved) await collectBareSpecifiersFromFile(resolved, visited, bareSpecifiers)
        return
      }
      if (specifier.startsWith('/')) return // an absolute project path — not a package, skip
      bareSpecifiers.add(specifier)
    }),
  )
}

/**
 * Every bare specifier reachable from `cometFiles` (as found by {@linkcode discoverComets}),
 * discovered by walking each file's own relative-import graph — the part of the fix that makes it
 * genuinely generic rather than covering only `react`/`react-dom` (the one case Vite's own
 * `@vitejs/plugin-react`-driven heuristic already adds to `optimizeDeps.include` automatically).
 * `ms` (a real, deliberately React-unrelated CJS package, imported through a relative helper
 * file, never directly by a Comet itself) was the real case that exposed this gap: being resolved
 * and aliased by this plugin is not enough on its own — `optimizeDeps.include` membership is what
 * actually triggers Vite's own pre-bundling/CJS-interop pass in the first place; an alias with no
 * corresponding `include` entry just remaps a path Vite never decided to optimize.
 */
async function discoverBareSpecifiersFromComets(cometFiles: string[]): Promise<string[]> {
  if (cometFiles.length === 0) return []

  const visited = new Set<string>()
  const bareSpecifiers = new Set<string>()
  await Promise.all(
    cometFiles.map((file) => collectBareSpecifiersFromFile(file, visited, bareSpecifiers)),
  )
  return [...bareSpecifiers]
}

/** An exact-match-only regex for `specifier` — never a plain string. Rollup's own alias matching
 * treats a plain string `find` as ALSO matching any `find + '/...'` subpath (the standard
 * "package prefix" convention) — confirmed as a real bug the hard way: with `react` and
 * `react/jsx-dev-runtime` both present as plain-string aliases, `react`'s own (shorter, earlier)
 * entry wins the subpath match first, replacing only the `react` portion and leaving
 * `/jsx-dev-runtime` appended onto a FILE path (`.../react/index.js/jsx-dev-runtime`) — which
 * then fails Vite's own `isOptimizable` check (it no longer ends in `.js`) with a confusing
 * "Cannot optimize dependency" warning, never an outright error. An anchored regex makes each
 * entry match its own specifier only, regardless of insertion order. */
function exactSpecifierRegex(specifier: string): RegExp {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped}$`)
}

/**
 * Fixes a real Vite architecture gap that breaks `optimizeDeps` (Vite's own npm dependency
 * pre-bundler — the step that, among other things, converts a CommonJS-only package like `react`
 * into the real ESM a browser's own `import` can execute) under `@deno/vite-plugin`: confirmed by
 * reading `vite@8.2.0`'s own source directly, `optimizeDeps.include` resolution for the `client`
 * (and `ssr`) environment goes through a completely SEPARATE, "back-compat" resolver
 * (`createBackCompatIdResolver` → `createIdResolver`) that builds its own minimal plugin
 * container — `resolve.alias` plus Vite's own built-in Node-style resolver — and NEVER consults
 * any user-added plugin's own `resolveId` hook, `@deno/vite-plugin`'s included. Since Deno's
 * flattened `.deno` npm store doesn't match the standard `node_modules` layout that built-in
 * resolver expects, every bare specifier Vite decided needs optimizing (`react`, `react-dom`, its
 * own jsx-runtime subpaths, ...) silently fails to resolve there — Vite then falls back to
 * serving the raw, un-bundled, still-CommonJS source directly, which a browser cannot execute as
 * ESM (`SyntaxError: does not provide an export named '...'`). This is real for ANY npm package a
 * Comet imports that Vite decides to optimize, not specific to React — confirmed via a real,
 * disposable `puppeteer-core` spike against a real Chrome (no prior test ever drove a real
 * browser through `dev-asset-handler.ts`'s own asset-serving path for an npm dependency; every
 * existing test called `transformClientAsset` with an already-resolved project file, never with
 * the `/@id/`-wrapped id a real browser's own `import` of a bare specifier requests next).
 *
 * The fix stays entirely inside Vite's own, well-supported mechanisms — no second CJS-interop
 * system, no renderer-specific logic anywhere in this file: `resolve.alias` is a first-class Vite
 * config option the back-compat resolver DOES fully respect (confirmed empirically), so once each
 * specifier is pre-resolved to its real absolute file path (via `@deno/vite-plugin`'s own exported
 * `resolveDeno` — the exact same resolution `@deno/vite-plugin` uses internally for the normal
 * transform path, just invoked ahead of time here for the one resolver that can't reach it on its
 * own), Vite's own `optimizeDeps`/CJS-interop pipeline runs completely unmodified and produces the
 * same real, battle-tested output it always does. This plugin never touches React, JSX, or any
 * renderer concern — it only ever reads whatever `optimizeDeps.include` already contains (whoever
 * put it there) plus whatever {@linkcode discoverBareSpecifiersFromComets} finds by walking this
 * project's own Comet files, for whatever future renderer (`--renderer=preact` included) ends up
 * needing the same fix.
 *
 * Being resolved and aliased is not enough on its own for a specifier Vite never decided to
 * optimize in the first place — `optimizeDeps.include` membership is what actually triggers
 * Vite's own pre-bundling/CJS-interop pass; an alias with no corresponding `include` entry just
 * remaps a path Vite never touches. So every newly-discovered specifier gets pushed into the
 * `client` environment's own `optimizeDeps.include` too, alongside whatever was already there —
 * confirmed necessary the hard way: aliasing alone left `ms` (imported through a Comet's own
 * relative helper file, deliberately unrelated to React) still served as raw, un-bundled
 * CommonJS, exactly the original bug, just for a different package. Scoped to `client`
 * specifically, never `ssr` — confirmed, also the hard way, that adding a newly-discovered
 * specifier to `ssr`'s own `include` breaks its ALREADY-correct dependency resolution
 * (`RealImportEvaluator`/`bare-specifier-resolve.ts`'s own, unrelated fix for that environment);
 * `resolve.alias` itself stays harmless everywhere (see the real code comment below for why), only
 * `optimizeDeps.include` membership needed this narrower scope.
 *
 * Static aliases, computed once in `configResolved` (not a per-request `customResolver` function)
 * — `resolve.alias` entries with a function `customResolver` are deprecated as of `vite@8.2.0`
 * (removal planned for Vite 9); by the time `configResolved` fires, every plugin's own `config()`
 * contribution to `optimizeDeps.include` has already been merged into the final, complete list,
 * so a one-time resolution pass (plus this plugin's own Comet-reachable discovery) is all this
 * ever needs.
 *
 * A specifier this can't resolve (a real typo, or a package genuinely not reachable) is left
 * alone — Vite's own existing "Cannot optimize"/"Failed to resolve" warning still surfaces for
 * it, same as before this plugin existed; this only ever adds aliases/include entries, never
 * removes Vite's own fallback behavior for the cases it can't fix.
 */
export function denoOptimizeDepsAliasPlugin(): Plugin {
  return {
    name: 'zanix-deno-optimize-deps-alias',
    async configResolved(config) {
      const alreadyIncluded = new Set(collectOptimizeDepsIncludeSpecifiers(config))
      const cometFiles = await discoverComets(config.root)
      const discovered = await discoverBareSpecifiersFromComets(cometFiles)
      const newlyDiscovered = discovered.filter((spec) => !alreadyIncluded.has(spec))

      const specifiers = [...alreadyIncluded, ...newlyDiscovered]
      if (specifiers.length === 0) return

      const loader = await getBrowserLoader(config.root)
      const results = await Promise.all(
        specifiers.map(async (specifier) => {
          const result = await resolveDeno(specifier, loader).catch(() => null)
          return result?.kind === 'esm'
            ? { find: exactSpecifierRegex(specifier), replacement: result.id }
            : null
        }),
      )
      const aliasEntries = results.filter((entry) => entry !== null)
      if (aliasEntries.length === 0) return

      // Aliases are pushed everywhere, `ssr` included — confirmed harmless there: `ssr` never
      // actually runs Vite's own `optimizeDeps` in this project's dev pipeline
      // (`RealImportEvaluator`/`bare-specifier-resolve.ts` own that resolution instead, see
      // `dev-engine.ts`'s own doc), so a `resolve.alias` entry there just remaps a specifier to
      // the exact same file that resolution would already have picked, a no-op in practice.
      config.resolve.alias.push(...aliasEntries)
      for (const environment of Object.values(config.environments ?? {})) {
        // `environment.resolve.alias` is real at runtime (confirmed empirically) but missing from
        // `vite@8.2.0`'s own `ResolvedEnvironmentOptions.resolve` type — that type is
        // `Required<ResolveOptions>` alone, while the TOP-LEVEL `ResolvedConfig.resolve` type
        // explicitly intersects in `{ alias: Alias[] }`; the per-environment one doesn't, even
        // though the same field exists there too (same "Environment API is still a release
        // candidate" gap `space-plugin.ts`'s own doc already calls out for a different symbol).
        const environmentResolve = environment.resolve as typeof environment.resolve & {
          alias: typeof aliasEntries
        }
        environmentResolve.alias.push(...aliasEntries)
      }

      // `optimizeDeps.include` membership itself — unlike the alias above — is NOT harmless to
      // add for `ssr`: confirmed the hard way, adding a Comet-discovered specifier (`react`
      // included) to the `ssr` environment's own `include` broke SSR rendering outright
      // ("Cannot read properties of null (reading 'useState')" — a real, different module
      // instance than the one `RealImportEvaluator`'s own resolution installs the dispatcher
      // into). `newlyDiscovered` specifiers only ever get added to `include` for the `client`
      // (browser-consumed) environment — the only one this whole mechanism is about — never
      // `ssr`, whose own dependency resolution stays entirely on its existing, working path.
      if (newlyDiscovered.length > 0) {
        for (const environment of Object.values(config.environments ?? {})) {
          if (environment.consumer !== 'client') continue
          environment.optimizeDeps.include = [
            ...(environment.optimizeDeps.include ?? []),
            ...newlyDiscovered,
          ]
        }
      }
    },
  }
}
