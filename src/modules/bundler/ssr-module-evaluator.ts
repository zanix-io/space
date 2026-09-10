import type { EvaluatedModuleNode, ModuleEvaluator, ModuleRunnerContext } from 'vite/module-runner'
import { join, toFileUrl } from '@std/path'
import { isDenoSpecifier, parseDenoSpecifier } from '@deno/vite-plugin/resolver'
import {
  fromNativeRuntimeSentinel,
  normalizeNativeRuntimeSpecifier,
} from './native-runtime-modules.ts'
import { getSharedLoader } from './deno-loader.ts'
import { resolveDenoAt } from './deno-specifier-resolver.ts'

/** See {@linkcode RealImportEvaluator.runExternalModule}'s own doc for why ONLY these two go
 * through `resolveDenoAt`'s loader-based resolution instead of a plain `import(specifier)`. */
const REQUIRES_LOADER_RESOLUTION = new Set(['preact/debug', 'preact/devtools'])

/**
 * The specifier {@linkcode RealImportEvaluator.runExternalModule} hands to a real `import()`, given
 * `resolveDenoAt`'s result for the same lookup. See that method's own doc, at its call site, for why
 * a local-file result needs converting back to a `file://` URL rather than being passed through as
 * the plain filesystem path `resolveDenoAt` returns it as. Extracted into its own pure function so
 * this conversion is unit-testable without a real `import()` call.
 */
export function resolvedImportTarget(
  resolved: { id: string; isLocalFile: boolean } | null,
  fallbackSpecifier: string,
): string {
  if (resolved === null) return fallbackSpecifier
  return resolved.isLocalFile ? toFileUrl(resolved.id).href : resolved.id
}

/**
 * Replaces Vite's own default SSR module evaluator (`ESModulesEvaluator`, from
 * `vite/module-runner` — the one `server.ssrLoadModule()` uses internally, via
 * `SSRCompatModuleRunner`, with no way to swap it out) for exactly one reason: its
 * `runInlinedModule` evaluates transformed code via `new AsyncFunction(...)`, and V8 (Deno's own
 * engine) never parses native TC39 decorator syntax through the `Function`/`AsyncFunction`
 * constructor — confirmed directly, isolated from Vite entirely. A real
 * `@zanix/space` page's `@Page()` (and any other decorator `@zanix/server`'s handler classes use)
 * is real, standard ECMAScript decorator syntax — `@Page()`'s own registration logic branches on
 * a real TC39 decorator `context.kind`, so downleveling to TypeScript's legacy
 * `experimentalDecorators` (which esbuild/Vite <8 CAN downlevel through `AsyncFunction` cleanly)
 * is not a safe substitute: legacy decorators receive a completely different call shape and would
 * silently misbehave for any decorator written against the real TC39 API, not just fail loudly.
 *
 * The actual fix turned out to need nothing more than a different file EXTENSION: the identical
 * transformed code that throws `SyntaxError: Invalid or unexpected token` at the decorator line
 * when evaluated as `.mjs` parses and runs correctly as `.ts` — Deno only enables decorator-syntax
 * parsing for TypeScript file extensions, confirmed with a minimal, Vite-free reproduction.
 * `runInlinedModule` here does exactly that: writes the SAME code Vite's own
 * evaluator would have passed to `AsyncFunction`, unmodified, into a real `.ts` file (wrapped in an
 * `export async function` using the identical parameter names/order Vite's own evaluator uses —
 * `ssrModuleExportsKey`/`ssrImportMetaKey`/`ssrImportKey`/`ssrDynamicImportKey`/`ssrExportAllKey`/
 * `ssrExportNameKey`, from `vite/module-runner`'s own constants), then does a real dynamic
 * `import()` of it — real ES module parsing, unlike `Function()`, does support native decorators.
 *
 * `runInlinedModule`/`runExternalModule` are the sole two methods `ModuleRunner` ever calls on its
 * own `evaluator` — everything else (the module graph, hot-invalidation, `transformRequest`, the
 * `client` environment, HMR) stays entirely Vite's own, untouched. This class owns no
 * invalidation/caching logic of its own; a fresh temp file per call is what lets a re-evaluation
 * after invalidation always see the newly transformed code, never a stale one — verified with a real
 * edit-and-reload spike (not assumed): decorators, `accessor` fields, a
 * relative import, an npm bare specifier resolved through the project's own Deno import map (via
 * `@deno/vite-plugin`), invalidate-then-re-evaluate producing a genuinely fresh module (not a cached
 * one), a real syntax error still surfacing a clear file/line/column message, and
 * `transformRequest()` continuing to work unaffected, all confirmed together against one real
 * fixture.
 *
 * **`runExternalModule` carries one deliberate exception on top of matching Vite's own default
 * evaluator** — see its own doc, and `native-runtime-modules.ts`'s own header doc, for the real
 * `@zanix/space`/`@zanix/server` module-identity bug this closes: without it, a route file's own
 * `@Page()` registers against a copy of `@zanix/server`'s `ProgramModule` that the native
 * `zanix space dev` process never serves requests through, so every route silently 404s despite
 * `ssrLoadModule()` succeeding with no error at all.
 */
export class RealImportEvaluator implements ModuleEvaluator {
  #dir: string
  #root: string
  #counter = 0

  constructor(dir: string, root: string) {
    this.#dir = dir
    this.#root = root
  }

  public async runInlinedModule(
    context: ModuleRunnerContext,
    code: string,
    module: Readonly<EvaluatedModuleNode>,
  ): Promise<void> {
    const ssrModuleExportsKey = '__vite_ssr_exports__'
    const ssrImportMetaKey = '__vite_ssr_import_meta__'
    const ssrImportKey = '__vite_ssr_import__'
    const ssrDynamicImportKey = '__vite_ssr_dynamic_import__'
    const ssrExportAllKey = '__vite_ssr_exportAll__'
    const ssrExportNameKey = '__vite_ssr_exportName__'

    // `context[ssrImportMetaKey].url` is what a module's own `import.meta.url` evaluates to — Vite's
    // own module runner (`ModuleRunner.directRequest`) computes this by running `module.id`/`.file`
    // through a POSIX `path.resolve`-style normalizer, which silently collapses a real remote
    // specifier's `https://` down to `https:/` (consecutive `/` are never meaningful in a filesystem
    // path, so the normalizer treats them as one) — confirmed empirically, a real, reproduced bug:
    // any Comet whose OWN source file is reached through a bare/remote specifier (a ready-made
    // Comet shipped by a THIRD-PARTY package, e.g. `@zanix/space-ui`'s `NavDrawer`, never one of
    // `@zanix/space`'s own — those are diverted to a genuine native `import()` instead, see
    // `runExternalModule`'s own doc, so `import.meta.url` there is computed by Deno itself, never
    // touched by this normalizer at all) gets a corrupted, single-slash `data-comet-module` in
    // `zanix space dev` — malformed in a way `resolveCometModuleUrl` (`comet-manifest.ts`) never
    // recognizes as a real `https://`/`http://` URL, so it falls through to the WRONG branch entirely
    // instead of the one that correctly serves a remote module.
    //
    // `module.id`/`.file` themselves are never touched by that normalizer — they still carry
    // `@deno/vite-plugin`'s own real, un-mangled wrapped specifier
    // (`deno::<loader>::<id>::<resolved>#deno`), the exact same shape `dev-engine.ts`'s own
    // `realFilePathOf` already parses via `isDenoSpecifier`/`parseDenoSpecifier` for an unrelated
    // reason (recovering a real on-disk path for `'server-only'`/`'use comet'` directive scanning).
    // Reusing that same pair here recovers the real, un-mangled resolved value and corrects
    // `import.meta.url` BEFORE this module ever runs — a real filesystem path is left untouched
    // (that case already works correctly; only a genuinely remote `http(s):` resolution needed
    // fixing), and nothing here is specific to any one package — it corrects `import.meta.url` for
    // ANY module reached this way, not just a hardcoded allowlist.
    if (module.id && isDenoSpecifier(module.id)) {
      const { resolved } = parseDenoSpecifier(module.id)
      if (resolved.startsWith('http://') || resolved.startsWith('https://')) {
        context[ssrImportMetaKey].url = resolved
      }
    }

    const params = [
      ssrModuleExportsKey,
      ssrImportMetaKey,
      ssrImportKey,
      ssrDynamicImportKey,
      ssrExportAllKey,
      ssrExportNameKey,
    ].join(', ')
    const wrapped = `export async function __run__(${params}) {\n"use strict";\n${code}\n}\n`

    // `.ts`, never `.mjs`/`.js` — see this class's own doc for why. Counter-suffixed so a fresh
    // generation is always its own new module specifier — Deno's own ES module cache would
    // otherwise return the SAME stale evaluation for a reused path, defeating invalidation.
    const file = join(this.#dir, `gen-${this.#counter++}.ts`)
    await Deno.writeTextFile(file, wrapped)

    const mod = await import(toFileUrl(file).href) as {
      __run__: (
        exports: unknown,
        importMeta: unknown,
        ssrImport: unknown,
        ssrDynamicImport: unknown,
        ssrExportAll: unknown,
        ssrExportName: unknown,
      ) => Promise<void>
    }
    await mod.__run__(
      context[ssrModuleExportsKey],
      context[ssrImportMetaKey],
      context[ssrImportKey],
      context[ssrDynamicImportKey],
      context[ssrExportAllKey],
      context[ssrExportNameKey],
    )
    Object.seal(context[ssrModuleExportsKey])
  }

  // Matches `ESModulesEvaluator.runExternalModule` exactly (`vite/module-runner`'s own source) —
  // anything Vite decides to externalize rather than transform (e.g. `node:async_hooks`, used
  // transitively by `@zanix/server`'s own `AsyncContext`) already imports cleanly; the decorator
  // limitation this class exists for never applies to an externalized module in the first place.
  //
  // ONE deliberate exception: `native-runtime-modules.ts`'s own `nativeRuntimeModulesPlugin`
  // resolves `@zanix/*`/`react`/`preact` (and their subpaths) to a synthetic
  // `znxruntime://<specifier>` id specifically so they arrive HERE, as an externalized module,
  // instead of being transformed/inlined like a normal dependency — see that file's own doc for the
  // full module-identity fix this is the other half of. `fromNativeRuntimeSentinel` recovers the
  // ORIGINAL specifier text — bare (`'@zanix/space'`) for a route file's own import, or
  // `jsr:`/`npm:`-qualified (`'jsr:@zanix/space@^1.0.0/comet'`) when it comes from WITHIN a
  // third-party package's own source, resolved through THAT package's own declared range (see
  // `native-runtime-modules.ts`'s own `JSR_OR_NPM_SPECIFIER_RE` doc). `normalizeNativeRuntimeSpecifier`
  // undoes that qualification either way, so the `@zanix/*` check and the resolution below both see
  // the same bare form regardless of which shape it arrived in.
  //
  // A `@zanix/*` specifier is resolved via `resolveDenoAt` (with `getSharedLoader`'s own
  // node-platform loader, scoped to `this.#root` — the SERVED PROJECT, never this package's own
  // directory) against the BARE, normalized form — the exact same specifier text the project's own
  // direct `@zanix/space`/`@zanix/space/react` imports already resolve through its own top-level
  // `imports` entry, so a third-party package's own internal `@zanix/space` dependency converges on
  // the identical instance instead of depending on Deno's own cross-range deduplication. A native
  // `import()` of that resolved URL then hits Deno's own process-wide module cache and returns the
  // SAME instance the project's own code already loaded — never a second copy pinned to whatever
  // the running `zanix space dev` process happens to have cached for an unrelated project.
  // Everything else `NATIVE_RUNTIME_MODULES` covers (`react`/`react-dom`/`preact`/`preact/hooks`,
  // and any OTHER subpath of those a consumer writes and declares itself, like `react-dom/server`
  // or `react-dom/client`) keeps the plain `import(specifier)` this evaluator always had: an npm
  // package is already safe without the loader — Deno's own `nodeModulesDir: "auto"` flattens the
  // SERVED PROJECT's whole dependency tree into one shared `node_modules`, so a bare
  // `import('react')` already resolves to the same instance regardless of which config asked — and
  // resolving it down to an already-expanded file path here would skip Deno's own built-in
  // CJS-to-ESM interop for a bare npm specifier, a real, confirmed regression for exactly that case
  // (`react`/`react-dom` ship real CJS, including in subpaths like `react-dom/server`; `preact`
  // doesn't, but is kept on the same safe path for consistency with what it's already known to work
  // with).
  //
  // `REQUIRES_LOADER_RESOLUTION` (`preact/debug`, `preact/devtools`) is the one deliberate,
  // narrowly-scoped exception: a real, confirmed case where `@preact/preset-vite`'s own devtools
  // sub-plugin injects `import "preact/debug"` directly into whichever real route file its own
  // entry-detection heuristic latches onto, so the served project's own `deno.json` has no reason
  // to ever declare a `"preact/debug"` entry — unlike `react-dom/server` above, the CONSUMER never
  // wrote this import itself, so there's no declared-import path for a plain `import()` to succeed
  // through. This module's own resolution scope is a REMOTE one in production (`@zanix/space`
  // served from `jsr.io`), where Deno's native bare-specifier resolution has no local
  // `node_modules` to walk for a subpath nothing in scope declares. Confirmed empirically: a plain
  // `import("preact/debug")` from here throws `Import "preact/debug" not a dependency and not in
  // import map`, the literal shape behind the `Module not found` crash this exception closes.
  // `resolveDenoAt` avoids that failure mode entirely by resolving directly against the served
  // project's own real, on-disk `node_modules` (following `preact`'s own package.json `exports`
  // map itself) rather than relying on this module's own ambient specifier scope to already know
  // about a subpath. This carries none of the CJS-interop risk above: both are real ESM.
  //
  // Falls back to a plain `import(specifier)` only when `resolveDenoAt` itself can't resolve the
  // specifier (`resolved` stays `null`) — the same safety net this evaluator always had for
  // whatever case its own loader genuinely doesn't cover.
  public async runExternalModule(filepath: string): Promise<unknown> {
    const specifier = fromNativeRuntimeSentinel(filepath)
    if (specifier === null) return import(filepath)
    const normalized = normalizeNativeRuntimeSpecifier(specifier)
    if (!normalized.startsWith('@zanix/') && !REQUIRES_LOADER_RESOLUTION.has(normalized)) {
      return import(specifier)
    }
    const loader = await getSharedLoader(this.#root)
    const resolved = await resolveDenoAt(normalized, loader, undefined)
    // Falls back to the ORIGINAL specifier, never `normalized` — a bare `'@zanix/space/comet'`
    // has no guaranteed meaning against the ambient process on its own (that's the exact gap this
    // whole method exists to route around), while the original, possibly `jsr:`-qualified text
    // (`'jsr:@zanix/space@^1.0.0/comet'`) always resolves via Deno's own generic JSR mechanism
    // regardless of any import map, the same safety net this evaluator always had.
    //
    // `resolved.id` is a PLAIN FILESYSTEM PATH, never a URL, whenever `isLocalFile` is true —
    // `resolveDenoAt` runs it through `fileURLToPath` itself (see that function's own doc). A bare
    // `/Users/...`-style path resolves correctly through `import()` only when THIS module's own
    // base URL already happens to be `file://`: a specifier starting with `/` resolves as an
    // absolute PATH against the calling module's own origin, per the WHATWG URL spec `import()`
    // follows. Under a real global `@zanix/cli` install (`jsr:@zanix/cli@<version>`), this
    // package's own code runs from a REMOTE `https://jsr.io/...` origin instead, so the identical
    // bare path resolves to `https://jsr.io/Users/...` and throws `Module not found`. `toFileUrl`
    // converts it to a real `file://` URL first — the one shape that resolves identically
    // regardless of which origin the calling module was itself loaded from. A non-local result
    // (`isLocalFile: false`, a `jsr:`/`http(s):` string `resolveDenoAt` already left fully
    // qualified) passes through unchanged.
    const target = resolvedImportTarget(resolved, specifier)
    return import(target)
  }
}
