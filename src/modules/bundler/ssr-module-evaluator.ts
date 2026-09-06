import type { EvaluatedModuleNode, ModuleEvaluator, ModuleRunnerContext } from 'vite/module-runner'
import { join, toFileUrl } from '@std/path'
import { isDenoSpecifier, parseDenoSpecifier } from '@deno/vite-plugin/resolver'
import { fromNativeRuntimeSentinel } from './native-runtime-modules.ts'

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
  #counter = 0

  constructor(dir: string) {
    this.#dir = dir
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
  // resolves `@zanix/space`/`@zanix/server` (and their subpaths) to a synthetic
  // `znxruntime://<specifier>` id specifically so they arrive HERE, as an externalized module,
  // instead of being transformed/inlined like a normal dependency — see that file's own doc for the
  // full module-identity fix this is the other half of. `fromNativeRuntimeSentinel` recovers the
  // ORIGINAL bare specifier text and this does a plain native `import()` of THAT, instead of the
  // synthetic url — resolved by Deno against the exact same import map the native `zanix space dev`
  // process already loaded `@zanix/space`/`@zanix/server` through, so this returns the SAME,
  // reference-identical module instance the native side already holds, not a second copy.
  public runExternalModule(filepath: string): Promise<unknown> {
    return import(fromNativeRuntimeSentinel(filepath) ?? filepath)
  }
}
