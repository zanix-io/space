import type { Plugin, ResolvedConfig } from 'vite'
import { dirname, resolve as resolvePath } from '@std/path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { type Loader, ResolutionMode, ResolveError, Workspace } from '@deno/loader'
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
 * discriminate node/browser within the same subpath), reusing the SSR loader here could silently
 * resolve the wrong file.
 *
 * Cached per discovered config path, never a single process-wide singleton: constructing one
 * `Workspace` with no explicit `configPath` at all falls back to auto-discovering from the
 * process's own `Deno.cwd()`, which is `@zanix/space`'s own development root while iterating on
 * `@zanix/space` itself (this plugin's real, intended target is always some OTHER app's
 * `config.root`) — silently correct only by coincidence, for whichever specifiers both configs
 * happen to declare identically (`react`), and silently WRONG for anything declared only in the
 * real target app's own `deno.json` (a real, separate npm dependency — `ms` — imported through a
 * Comet's own relative helper file). Each loader still only ever computes resolutions on demand,
 * never caches a module instance, so sharing one across calls for the SAME root creates no second
 * source of module identity — the same guarantee `getSharedLoader()`'s own doc already establishes
 * (that one is ALSO cached per discovered config path, not a bare singleton, for the identical
 * reason).
 *
 * Deliberately never calls `loader.addEntrypoints(...)` — a real app's own `node_modules` is
 * already fully materialized by the time this plugin's `configResolved` ever runs (Deno's own
 * `nodeModulesDir: 'auto'` resolves every bare specifier the app's `deno.json` declares as part
 * of the SAME `deno run` invocation that starts `zanix space dev` in the first place, well before
 * this plugin gets a chance to run), so `resolveDeno`/`loader.resolveSync` already succeeds
 * without it for anything genuinely declared there. `addEntrypoints` has a real side effect beyond
 * THIS loader's own graph: triggering it against a freshly-created project (one never previously
 * run through a real `deno run`) breaks the unrelated `ssr` environment's OWN, already-correct
 * dependency resolution (`RealImportEvaluator`/`bare-specifier-resolve.ts`'s own fix), the exact
 * kind of cross-cutting failure this file's own `ssr`-scoping comments elsewhere already guard
 * against — so it stays unused here.
 */
const browserLoadersByConfigPath = new Map<string, Promise<Loader>>()
function getBrowserLoader(root: string): Promise<Loader> {
  const configPath = findDenoConfigPath(root)
  const key = configPath ?? ''
  let loaderPromise = browserLoadersByConfigPath.get(key)
  if (!loaderPromise) {
    loaderPromise = new Workspace({ platform: 'browser', configPath })
      .createLoader()
    browserLoadersByConfigPath.set(key, loaderPromise)
  }
  return loaderPromise
}

/** Every bare specifier any environment's own resolved `optimizeDeps.include` lists — the
 * complete, deduplicated set this plugin needs to resolve. Vite populates `include` itself
 * (`@vitejs/plugin-react`'s own React-detection heuristic is one real source; there may be
 * others, present or future, for a different renderer or a different plugin entirely) — this
 * function never assumes WHY a specifier ended up there, only that it did. */
function collectOptimizeDepsIncludeSpecifiers(
  config: ResolvedConfig,
): string[] {
  const specifiers = new Set<string>()
  for (const spec of config.optimizeDeps?.include ?? []) specifiers.add(spec)
  for (const environment of Object.values(config.environments ?? {})) {
    for (const spec of environment.optimizeDeps?.include ?? []) {
      specifiers.add(spec)
    }
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
        if (resolved) {
          await collectBareSpecifiersFromFile(
            resolved,
            visited,
            bareSpecifiers,
          )
        }
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
async function discoverBareSpecifiersFromComets(
  cometFiles: string[],
): Promise<string[]> {
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
 * A referrer-aware sibling of `@deno/vite-plugin/resolver`'s own `resolveDeno` — that function
 * hardcodes `referrer: undefined` in its own `loader.resolveSync` call, which is exactly right for
 * resolving a Comet's own TOP-LEVEL bare imports against `config.root`'s single, unscoped import
 * map (no ambiguity there to resolve), but wrong for a specifier found INSIDE a file this plugin
 * itself already resolved to some OTHER local package (`@zanix/space`'s own `mod.ts`, once
 * `@zanix/space` itself resolves locally — see {@linkcode discoverNestedAliases}'s own doc for why
 * this is needed at all). A bare specifier like `modules/render/mod.ts` is only meaningful against
 * `@zanix/space`'s OWN `deno.jsonc` import map (`"modules/": "./src/modules/"`), never the
 * consuming project's — exactly the same "a member's `imports` are scoped to that member's own
 * directory" reasoning `resolveViteSpecifier`'s own `memberReferrerUrl` and
 * `bare-specifier-resolve.ts`'s own `resolveBareSpecifierCanonically` already establish for the
 * `ssr` side; this file's own browser-scoped loader had no equivalent until now.
 *
 * Mirrors `resolveDeno`'s own jsr:/http(s): `addEntrypoints`-then-re-resolve dance (needed because
 * `loader.resolveSync` alone returns an un-expanded `jsr:`/`http(s):` string the first time a given
 * target hasn't been graphed yet) rather than importing it, since `resolveDeno` itself has no
 * `referrer` parameter to thread through — reimplementing the ~15 lines here is simpler and safer
 * than forking `@deno/vite-plugin` to add one. Never handles `resolveDeno`'s own `id.startsWith('npm:')`
 * branch — that only matters for a LITERAL `npm:`-prefixed specifier, which real TypeScript source
 * text (what {@linkcode extractImportSpecifiers} scans) never contains; a bare specifier like
 * `'react'` is what always shows up here instead, same as `resolveDeno`'s own primary case.
 *
 * `addEntrypoints` here carries the exact same, already-accepted cross-cutting risk
 * {@linkcode getBrowserLoader}'s own doc describes for `resolveDeno`'s existing (already shipped,
 * unconditional) call to it in `configResolved` below — nothing new is introduced by calling it
 * again, referrer-aware, from this sibling function.
 */
async function resolveDenoAt(
  id: string,
  loader: Loader,
  referrer: string | undefined,
): Promise<{ id: string; isLocalFile: boolean } | null> {
  if (id.startsWith('\0')) return null
  let resolved: string
  try {
    resolved = loader.resolveSync(id, referrer, ResolutionMode.Import)
    if (
      resolved.startsWith('jsr:') || resolved.startsWith('http:') ||
      resolved.startsWith('https:')
    ) {
      try {
        await loader.addEntrypoints([resolved])
      } catch {
        return null
      }
      resolved = loader.resolveSync(resolved, referrer, ResolutionMode.Import)
    }
  } catch (err) {
    if (err instanceof ResolveError) return null
    throw err
  }
  if (resolved.startsWith('node:')) return null
  if (resolved.startsWith('file://')) {
    return { id: fileURLToPath(resolved), isLocalFile: true }
  }
  // A remote (jsr:/http(s):) or otherwise non-file result — genuinely unresolvable to a local
  // filesystem path this plugin's own `resolve.alias` mechanism could ever point to. Left for a
  // caller to skip, same as `configResolved`'s own existing `!/^https?:\/\//` filter does today for
  // a top-level specifier.
  return { id: resolved, isLocalFile: false }
}

/**
 * Recursively walks past a bare specifier's own resolution — the part `collectBareSpecifiersFromFile`
 * deliberately never does (see its own doc: "that's a leaf ... never opened"), correct for a genuine
 * npm/JSR package Vite's own pipeline (or this plugin's top-level resolution below) already knows
 * how to fully resolve on its own, but WRONG for `@zanix/space` itself: once `@zanix/space` resolves
 * to a real local file (its own `mod.ts`), THAT file's own bare imports (`modules/render/mod.ts`,
 * `@zanix/errors`, ...) are reachable only through `@zanix/space`'s OWN `deno.jsonc` import map —
 * invisible to Vite's `optimizeDeps` back-compat resolver for the exact same reason `@zanix/space`
 * itself was (see this file's own top-level doc), and invisible to THIS plugin's own top-level
 * discovery too, since it only ever walks a Comet's OWN relative-import graph, never a bare
 * specifier's resolved target. Confirmed empirically: without this, `@zanix/space`'s own optimized
 * bundle ends up with `modules/render/mod.ts` left as a raw, browser-unresolvable bare import baked
 * directly into `@zanix_space.js`'s own output text — a real reload-time
 * `Failed to resolve import "modules/render/mod.ts"` (`vite:import-analysis`), not a theoretical gap.
 *
 * `visitedFiles`/`visitedSpecifiers` are SHARED across every entry file this walks from (not
 * per-entry-file sets) — the same specifier or file reached twice (once through `@zanix/space`'s own
 * `mod.ts`, once through some OTHER Comet-reachable local package) only needs resolving once; `@std/path`-style
 * dedup makes the recursion terminate even through a real import cycle.
 *
 * Deliberately does NOT add anything to `optimizeDeps.include` — only the TOP-LEVEL entries this
 * walk starts from (`@zanix/space` itself) need that (see {@linkcode discoverBareSpecifiersFromComets}'s
 * own doc for why `include` membership matters at all). A specifier discovered by recursing PAST an
 * already-included entry is reached DURING esbuild's own bundling of that entry — confirmed
 * empirically that a plain `resolve.alias` entry, with no separate `include` entry of its own, is
 * enough for esbuild to inline it directly into the SAME output chunk (`@zanix_space.js` grew from a
 * 15-line stub with raw unresolved imports to a real ~5000-line bundle with every `modules/render/mod.ts`-style
 * import correctly inlined, alias-only, no `include` addition needed) — the identical mechanism
 * `react/jsx-dev-runtime`'s own subpath alias already relies on above.
 */
async function walkNestedFile(
  filePath: string,
  loader: Loader,
  visitedFiles: Set<string>,
  visitedSpecifiers: Set<string>,
  aliasMap: Map<string, string>,
): Promise<void> {
  if (visitedFiles.has(filePath)) return
  visitedFiles.add(filePath)

  let source: string
  try {
    source = await Deno.readTextFile(filePath)
  } catch {
    return
  }

  const referrer = pathToFileURL(filePath).href
  await Promise.all(
    extractImportSpecifiers(source).map(async (specifier) => {
      if (specifier.startsWith('.')) {
        const resolved = await resolveRelativeImportPath(filePath, specifier)
        if (resolved) {
          await walkNestedFile(resolved, loader, visitedFiles, visitedSpecifiers, aliasMap)
        }
        return
      }
      if (specifier.startsWith('/')) return // an absolute project path — not a package, skip

      if (visitedSpecifiers.has(specifier)) return
      visitedSpecifiers.add(specifier)

      const resolved = await resolveDenoAt(specifier, loader, referrer).catch(() => null)
      if (!resolved || !resolved.isLocalFile) return
      aliasMap.set(specifier, resolved.id)
      await walkNestedFile(resolved.id, loader, visitedFiles, visitedSpecifiers, aliasMap)
    }),
  )
}

/**
 * Entry point for {@linkcode walkNestedFile} — one call per top-level specifier this plugin already
 * resolved to a local file below (`localEntryFiles`), sharing one `visitedFiles`/`visitedSpecifiers`
 * pair across all of them so the SAME nested dependency reached through two different top-level
 * entries (plausible once more than one Comet-reachable local package is involved) is only ever
 * resolved once.
 */
async function discoverNestedAliases(
  localEntryFiles: string[],
  loader: Loader,
): Promise<Map<string, string>> {
  const aliasMap = new Map<string, string>()
  const visitedFiles = new Set<string>()
  const visitedSpecifiers = new Set<string>()
  await Promise.all(
    localEntryFiles.map((file) =>
      walkNestedFile(file, loader, visitedFiles, visitedSpecifiers, aliasMap)
    ),
  )
  return aliasMap
}

/**
 * Fixes a Vite architecture gap that breaks `optimizeDeps` (Vite's own npm dependency pre-bundler —
 * the step that, among other things, converts a CommonJS-only package like `react` into the real
 * ESM a browser's own `import` can execute) under `@deno/vite-plugin`: per `vite@8.2.0`'s own
 * source, `optimizeDeps.include` resolution for the `client` (and `ssr`) environment goes through a
 * completely SEPARATE, "back-compat" resolver (`createBackCompatIdResolver` → `createIdResolver`)
 * that builds its own minimal plugin container — `resolve.alias` plus Vite's own built-in
 * Node-style resolver — and NEVER consults any user-added plugin's own `resolveId` hook,
 * `@deno/vite-plugin`'s included. Since Deno's flattened `.deno` npm store doesn't match the
 * standard `node_modules` layout that built-in resolver expects, every bare specifier Vite decided
 * needs optimizing (`react`, `react-dom`, its own jsx-runtime subpaths, ...) silently fails to
 * resolve there — Vite then falls back to serving the raw, un-bundled, still-CommonJS source
 * directly, which a browser cannot execute as ESM (`SyntaxError: does not provide an export named
 * '...'`). This is real for ANY npm package a Comet imports that Vite decides to optimize, not
 * specific to React: a real browser's own `import` of a bare specifier requests the `/@id/`-wrapped
 * id through `dev-asset-handler.ts`'s own asset-serving path for an npm dependency, a request shape
 * distinct from an already-resolved project file.
 *
 * The fix stays entirely inside Vite's own, well-supported mechanisms — no second CJS-interop
 * system, no renderer-specific logic anywhere in this file: `resolve.alias` is a first-class Vite
 * config option the back-compat resolver DOES fully respect, so once each specifier is pre-resolved
 * to its real absolute file path (via `@deno/vite-plugin`'s own exported `resolveDeno` — the exact
 * same resolution `@deno/vite-plugin` uses internally for the normal transform path, just invoked
 * ahead of time here for the one resolver that can't reach it on its own), Vite's own
 * `optimizeDeps`/CJS-interop pipeline runs completely unmodified and produces the same real,
 * battle-tested output it always does. This plugin never touches React, JSX, or any renderer
 * concern — it only ever reads whatever `optimizeDeps.include` already contains (whoever put it
 * there) plus whatever {@linkcode discoverBareSpecifiersFromComets} finds by walking this project's
 * own Comet files, for whatever future renderer (`--renderer=preact` included) ends up needing the
 * same fix.
 *
 * Being resolved and aliased is not enough on its own for a specifier Vite never decided to
 * optimize in the first place — `optimizeDeps.include` membership is what actually triggers Vite's
 * own pre-bundling/CJS-interop pass; an alias with no corresponding `include` entry just remaps a
 * path Vite never touches. So every newly-discovered specifier gets pushed into the `client`
 * environment's own `optimizeDeps.include` too, alongside whatever was already there — this is
 * necessary because aliasing alone leaves `ms` (imported through a Comet's own relative helper
 * file, deliberately unrelated to React) still served as raw, un-bundled CommonJS, exactly the
 * original bug, just for a different package. Scoped to `client` specifically, never `ssr` — adding
 * a newly-discovered specifier to `ssr`'s own `include` breaks its ALREADY-correct dependency
 * resolution (`RealImportEvaluator`/`bare-specifier-resolve.ts`'s own, unrelated fix for that
 * environment); `resolve.alias` itself stays harmless everywhere (see the real code comment below
 * for why), only `optimizeDeps.include` membership needed this narrower scope.
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
      const alreadyIncluded = new Set(
        collectOptimizeDepsIncludeSpecifiers(config),
      )
      const cometFiles = await discoverComets(config.root)
      const discovered = await discoverBareSpecifiersFromComets(cometFiles)
      const newlyDiscovered = discovered.filter((spec) => !alreadyIncluded.has(spec))

      const specifiers = [...alreadyIncluded, ...newlyDiscovered]
      if (specifiers.length === 0) return

      const loader = await getBrowserLoader(config.root)
      const results = await Promise.all(
        specifiers.map(async (specifier) => {
          const result = await resolveDeno(specifier, loader).catch(() => null)
          // A specifier resolved straight from JSR/HTTP (never vendored into a local
          // `node_modules`-style store — a real ESM package like `@zanix/space` itself, reachable
          // through a Comet's own import) has no local file for Vite's back-compat resolver to
          // read; aliasing it to that raw URL only feeds `fs.readFileSync` a string it cannot open
          // (`https://...` is not a filesystem path). Left alone, same as an unresolvable
          // specifier — it already works through `@deno/vite-plugin`'s own transform path, which is
          // the only thing this plugin exists to route AROUND for genuinely local npm packages.
          return result?.kind === 'esm' && !/^https?:\/\//.test(result.id)
            ? { specifier, find: exactSpecifierRegex(specifier), replacement: result.id }
            : null
        }),
      )
      const locallyResolvedEntries = results.filter((entry) => entry !== null)

      // See `discoverNestedAliases`'s own doc — a top-level specifier resolving to a local file
      // (`@zanix/space` itself, most notably) needs its OWN bare imports discovered too, not just
      // aliased at the top level; `collectBareSpecifiersFromFile` never walks past a bare specifier
      // on its own.
      //
      // Computed PER ENTRY (not all at once) specifically to learn, for each one, whether it has
      // its own further nested dependencies at all — {@linkcode multiFileLocalPackages} below reads
      // this same per-entry breakdown to decide `optimizeDeps.include` membership. A shared
      // dependency reached from two different entries is simply walked twice (harmless: the second
      // walk's own `aliasMap.set` just repeats the same value) — cheap at the scale this ever runs
      // at (a handful of Comet-reachable local packages, never hundreds).
      const perEntryNested = await Promise.all(
        locallyResolvedEntries.map(async (entry) => ({
          specifier: entry.specifier,
          nested: await discoverNestedAliases([entry.replacement], loader),
        })),
      )
      const nestedAliases = new Map<string, string>()
      // A top-level specifier whose OWN file has further nested Deno-style bare-specifier
      // dependencies — a real, multi-file local package (`@zanix/space`, `@zanix/utils`, ...), as
      // opposed to a flat single-file npm/CJS dependency (`ms`) with no further Deno-specific
      // resolution needs of its own. This is exactly the distinction that matters for
      // `optimizeDeps.include` below: a multi-file local package's own reachable graph can contain
      // ANYTHING (a real TC39-decorated class Vite's normal transform can't parse at all, a `@std/*`
      // Deno-standard-library import esbuild's back-compat resolver can only ever see as a remote
      // `https://jsr.io/...` URL, never a local file — confirmed empirically for both, see
      // `client-entry-plugin.ts`'s and `mod.ts`'s own `./comet` export comment for the real,
      // encountered failures). None of that is a problem through Vite's NORMAL transform pipeline
      // (`@deno/vite-plugin`'s own resolver already handles every one of those correctly — it's
      // only optimizeDeps' own SEPARATE back-compat resolver, described in this file's own
      // top-level doc, that can't) — so a multi-file local package is deliberately EXCLUDED from
      // `include` below, left to resolve/transform normally, file by file, alias-only. A flat
      // single-file dependency has no such graph to fail on, so `include` (for its own, genuine
      // CJS-interop needs — the ORIGINAL reason this plugin exists, see `ms`'s own case in this
      // file's top-level doc) stays exactly as it already worked before this distinction existed.
      const multiFileLocalPackages = new Set<string>()
      for (const { specifier, nested } of perEntryNested) {
        if (nested.size > 0) multiFileLocalPackages.add(specifier)
        for (const [nestedSpecifier, id] of nested) nestedAliases.set(nestedSpecifier, id)
      }

      const aliasEntries = [
        ...locallyResolvedEntries.map(({ find, replacement }) => ({ find, replacement })),
        ...[...nestedAliases].map(([specifier, id]) => ({
          find: exactSpecifierRegex(specifier),
          replacement: id,
        })),
      ]
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
        const environmentResolve = environment.resolve as
          & typeof environment.resolve
          & {
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
      //
      // Filtered down to specifiers that actually got a local alias above: a Comet-reachable
      // specifier that resolved remotely (skipped above) needs no pre-bundling at all — adding it
      // to `include` with no corresponding alias would only hand Vite's back-compat resolver a
      // bare specifier it can't find in any local `node_modules`, same failure mode as `react`/
      // `react-dom` before this plugin existed, just for a package that was never CJS to begin with.
      const locallyResolvedSpecifiers = new Set(
        locallyResolvedEntries.map((entry) => entry.specifier),
      )
      const includeAdditions = newlyDiscovered.filter((spec) =>
        locallyResolvedSpecifiers.has(spec) && !multiFileLocalPackages.has(spec)
      )
      if (includeAdditions.length > 0) {
        for (const environment of Object.values(config.environments ?? {})) {
          if (environment.consumer !== 'client') continue
          environment.optimizeDeps.include = [
            ...(environment.optimizeDeps.include ?? []),
            ...includeAdditions,
          ]
        }
      }
    },
  }
}
