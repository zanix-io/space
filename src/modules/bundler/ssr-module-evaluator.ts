import type { ModuleEvaluator, ModuleRunnerContext } from 'vite/module-runner'
import { join, toFileUrl } from '@std/path'

/**
 * Replaces Vite's own default SSR module evaluator (`ESModulesEvaluator`, from
 * `vite/module-runner` — the one `server.ssrLoadModule()` uses internally, via
 * `SSRCompatModuleRunner`, with no way to swap it out) for exactly one reason: its
 * `runInlinedModule` evaluates transformed code via `new AsyncFunction(...)`, and V8 (Deno's own
 * engine) never parses native TC39 decorator syntax through the `Function`/`AsyncFunction`
 * constructor — confirmed directly, isolated from Vite entirely, before this was written. A real
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
 * parsing for TypeScript file extensions, confirmed with a minimal, Vite-free reproduction before
 * this was built. `runInlinedModule` here does exactly that: writes the SAME code Vite's own
 * evaluator would have passed to `AsyncFunction`, unmodified, into a real `.ts` file (wrapped in an
 * `export async function` using the identical parameter names/order Vite's own evaluator uses —
 * `ssrModuleExportsKey`/`ssrImportMetaKey`/`ssrImportKey`/`ssrDynamicImportKey`/`ssrExportAllKey`/
 * `ssrExportNameKey`, from `vite/module-runner`'s own constants), then does a real dynamic
 * `import()` of it — real ES module parsing, unlike `Function()`, does support native decorators.
 *
 * This is the ONLY thing that changes: `runInlinedModule`/`runExternalModule` are the sole two
 * methods `ModuleRunner` ever calls on its own `evaluator` — everything else (the module graph,
 * hot-invalidation, `transformRequest`, the `client` environment, HMR) stays entirely Vite's own,
 * untouched. This class owns no invalidation/caching logic of its own; a fresh temp file per call
 * is what lets a re-evaluation after invalidation always see the newly transformed code, never a
 * stale one — verified with a real edit-and-reload spike (not assumed) before this was written:
 * decorators, `accessor` fields, a relative import, an npm bare specifier resolved through the
 * project's own Deno import map (via `@deno/vite-plugin`), invalidate-then-re-evaluate producing a
 * genuinely fresh module (not a cached one), a real syntax error still surfacing a clear
 * file/line/column message, and `transformRequest()` continuing to work unaffected, all confirmed
 * together against one real fixture.
 */
export class RealImportEvaluator implements ModuleEvaluator {
  #dir: string
  #counter = 0

  constructor(dir: string) {
    this.#dir = dir
  }

  public async runInlinedModule(context: ModuleRunnerContext, code: string): Promise<void> {
    const ssrModuleExportsKey = '__vite_ssr_exports__'
    const ssrImportMetaKey = '__vite_ssr_import_meta__'
    const ssrImportKey = '__vite_ssr_import__'
    const ssrDynamicImportKey = '__vite_ssr_dynamic_import__'
    const ssrExportAllKey = '__vite_ssr_exportAll__'
    const ssrExportNameKey = '__vite_ssr_exportName__'

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
  public runExternalModule(filepath: string): Promise<unknown> {
    return import(filepath)
  }
}
