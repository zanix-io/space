import { dirname, join, resolve as resolvePath } from '@std/path'
import { type Loader, Workspace } from '@deno/loader'

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
