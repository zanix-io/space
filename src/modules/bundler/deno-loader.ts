import { dirname, join, resolve as resolvePath } from '@std/path'
import { type Loader, Workspace } from '@deno/loader'
import { parse as parseJsonc } from '@std/jsonc'

/** Walks up from `root` looking for the nearest `deno.json`/`deno.jsonc`, same algorithm
 * `@deno/vite-plugin`'s own (non-exported) `findDenoConfig` uses internally — replicated here,
 * not imported, since that function is a private implementation detail of `index.js`, never part
 * of its own public `exports` map. Prefers a `"workspace"`-bearing config over the nearest plain
 * one, same reasoning: a workspace root is what actually governs npm resolution for every member
 * underneath it. A cheap substring check, not a full JSONC parse — this only needs to notice the
 * key's presence, not read its value, so it doesn't need a JSONC-comment-aware parser dependency
 * this package doesn't otherwise have. Returns `undefined` if `root` has no config anywhere above
 * it (letting `Workspace` fall back to its own default auto-discovery from the process's own CWD,
 * the same fallback `@deno/vite-plugin`'s own `getLoader` takes for the identical case).
 *
 * Exported so `deno-optimize-deps-alias.ts`'s own `getBrowserLoader` and this file's
 * `getSharedLoader` share one implementation — both need the exact same walk-up algorithm, and
 * letting it drift into two copies is exactly how a fix to one silently misses the other. */
export function findDenoConfigPath(root: string): string | undefined {
  let nearest: string | undefined
  let dir = resolvePath(root)
  const fsRoot = resolvePath('/')

  while (true) {
    for (const name of ['deno.json', 'deno.jsonc']) {
      const candidate = join(dir, name)
      let content: string
      try {
        content = Deno.readTextFileSync(candidate)
      } catch {
        continue
      }
      nearest ??= candidate
      if (/["']workspace["']\s*:/.test(content)) return candidate
    }
    if (dir === fsRoot) break
    dir = dirname(dir)
  }
  return nearest
}

/**
 * One `@deno/loader` `Loader` instance per discovered `deno.json`/`deno.jsonc` — never a single
 * process-wide singleton, and never one per file or call. Everything in `zanix space dev`'s own
 * SSR-side resolution that needs `@deno/loader` directly (`cjs-interop.ts`'s own CJS-subtree
 * bundling, `bare-specifier-resolve.ts`'s canonical bare-specifier resolution) shares whichever
 * instance matches its own caller's `root`. This is deliberate, not just an efficiency shortcut:
 * this loader only ever computes resolution/content on demand — it never itself caches a module
 * INSTANCE — so sharing it doesn't create a second source of module identity; Vite's own module
 * graph stays the only thing that does that.
 *
 * Cached per discovered config path (via {@linkcode findDenoConfigPath}), not a bare, root-agnostic
 * singleton — confirmed the hard way this matters, the exact same finding `deno-optimize-deps-
 * alias.ts`'s own `getBrowserLoader` doc already describes for its own separate loader: a
 * `Workspace` constructed with no explicit `configPath` falls back to auto-discovering from the
 * process's own `Deno.cwd()`, which is `@zanix/space`'s own development root while iterating on
 * `@zanix/space` itself — silently correct only by coincidence, for whichever bare specifier both
 * configs happen to declare identically, and silently WRONG the moment a real consuming app has its
 * own real, on-disk `node_modules` a bare specifier could ALSO resolve through (Vite's own SSR
 * module-runner `fetchModule` fast path — see `bare-specifier-resolve.ts`'s own doc — walks that
 * real `node_modules` directly, from the real importer's own directory, entirely bypassing this
 * loader; the two diverge into two different physical files for the exact same specifier, and
 * `react-dom/server`'s dispatcher ends up installed on a `react` copy `useState` never reads from).
 * Reproduced empirically as a real `Invalid hook call` failure, fixed by this per-root caching.
 */
const sharedLoadersByConfigPath = new Map<string, Promise<Loader>>()
export function getSharedLoader(root: string): Promise<Loader> {
  const configPath = findDenoConfigPath(root)
  const key = configPath ?? ''
  let loaderPromise = sharedLoadersByConfigPath.get(key)
  if (!loaderPromise) {
    loaderPromise = new Workspace({ platform: 'node', configPath })
      .createLoader()
    sharedLoadersByConfigPath.set(key, loaderPromise)
  }
  return loaderPromise
}

/**
 * A SECOND, separate loader — rooted at `@zanix/space`'s OWN `deno.jsonc`, never a consuming
 * project's — for a real, confirmed gap {@linkcode getSharedLoader} structurally cannot close no
 * matter what `referrer` a caller threads through: `preact`, `@prefresh/core`, and `@prefresh/utils`
 * are real dependencies of THIS package (declared in its own `deno.jsonc`), never of a real
 * consuming project's own app code, which only ever reaches them transitively. A `Workspace` built
 * from a consuming project's own root config never inherits a JSR dependency's own nested import
 * map — confirmed empirically against a real, published `jsr:@zanix/space` dependency: even a
 * `referrer` URL literal INSIDE that package's own module tree (`.../src/modules/bundler/
 * space-plugin.ts`, the exact file that imports `preact`) still throws `Import "preact" not a
 * dependency and not in import map` from a `Workspace` rooted anywhere else — real Deno-native
 * `import()` resolves this correctly via `deno.lock`'s own per-package dependency graph, a
 * mechanism `@deno/loader`'s own `Workspace.resolveSync` simply doesn't replicate. See
 * `bare-specifier-resolve.ts`'s own doc for where this is actually used, and the real
 * `Failed to resolve dependency`/hard `Module not found` failures it closes.
 *
 * `import.meta.url` (never a hardcoded version) locates `@zanix/space`'s own `deno.jsonc` relative
 * to THIS file's own real, resolved location — a real JSR install or a local checkout, whichever
 * is actually executing this code — so this always reflects the exact same `@zanix/space` instance
 * a consuming project resolved, with nothing here to fall out of sync by hand. `fetch` reads it
 * uniformly across both schemes (`file://` locally, `https://` against JSR in production) — `Deno`'s
 * own filesystem APIs don't read a remote URL, but `fetch` does, for either one.
 *
 * `Workspace`'s own `configPath` option only accepts a real path/`file:` URL, never raw content —
 * the fetched text is written to a throwaway temp file for the one construction call that needs it,
 * left in place for this (long-lived, one-per-dev-session) loader's own lifetime rather than
 * cleaned up eagerly: a single small file, no different in kind from `RealImportEvaluator`'s own
 * `evalDir`.
 *
 * Primed once, at construction, with every `npm:`-scheme `imports` value this package's own
 * manifest declares (never a hand-picked package list to keep in sync) via `addEntrypoints` —
 * required before `resolveSync` can answer an `npm:` version constraint synchronously at all
 * (confirmed empirically: an unprimed constraint throws `Could not find constraint '<pkg>@<range>'
 * in the list of packages`, the same shape `resolveDeno`'s own `jsr:`/`http:` handling already
 * works around for those two schemes via its own `addEntrypoints` call).
 */
let spaceOwnLoaderPromise: Promise<Loader> | undefined
export function getSpaceOwnLoader(): Promise<Loader> {
  if (!spaceOwnLoaderPromise) {
    spaceOwnLoaderPromise = (async () => {
      const configUrl = new URL('../../../deno.jsonc', import.meta.url)
      const content = await (await fetch(configUrl)).text()
      const parsed = parseJsonc(content) as { imports?: Record<string, string> }
      const npmSpecifiers = Object.values(parsed.imports ?? {}).filter((value) =>
        value.startsWith('npm:')
      )
      const tempConfigPath = await Deno.makeTempFile({ suffix: '.jsonc' })
      await Deno.writeTextFile(tempConfigPath, content)
      const loader = await new Workspace({
        platform: 'node',
        configPath: tempConfigPath,
        noLock: true,
      })
        .createLoader()
      if (npmSpecifiers.length > 0) await loader.addEntrypoints(npmSpecifiers)
      return loader
    })()
  }
  return spaceOwnLoaderPromise
}
