import { fileURLToPath } from 'node:url'
import { type Loader, ResolutionMode, ResolveError, Workspace } from '@deno/loader'
import { findDenoConfigPath } from './deno-loader.ts'

/**
 * Shared, referrer-aware Deno specifier resolution — extracted from `deno-optimize-deps-alias.ts`
 * into its own module so `discover-comets.ts` can reuse it too, without creating an import cycle
 * (`deno-optimize-deps-alias.ts` already imports `discoverComets` FROM `discover-comets.ts`).
 *
 * @module
 */

/** A SEPARATE loader instance from `deno-loader.ts`'s own `getSharedLoader()` — that one is
 * `platform: 'node'`, deliberately scoped to this project's own SSR-side resolution needs
 * (`cjs-interop.ts`, `bare-specifier-resolve.ts` — see its own doc). Every caller of THIS one
 * resolves modules a real BROWSER will load (an `optimizeDeps` alias target, or a Comet's own
 * bundled chunk), so `platform: 'browser'` is the semantically correct choice — for a package with
 * platform-conditional `exports` (unlike `react`/`react-dom`, which don't discriminate node/browser
 * within the same subpath), reusing the SSR loader here could silently resolve the wrong file.
 *
 * Cached per discovered config path, never a single process-wide singleton: constructing one
 * `Workspace` with no explicit `configPath` at all falls back to auto-discovering from the
 * process's own `Deno.cwd()`, which is `@zanix/space`'s own development root while iterating on
 * `@zanix/space` itself (every real caller's own intended target is always some OTHER app's
 * `root`) — silently correct only by coincidence, for whichever specifiers both configs happen to
 * declare identically (`react`), and silently WRONG for anything declared only in the real target
 * app's own `deno.json`. Each loader still only ever computes resolutions on demand, never caches a
 * module instance, so sharing one across calls for the SAME root creates no second source of
 * module identity — the same guarantee `getSharedLoader()`'s own doc already establishes (that one
 * is ALSO cached per discovered config path, not a bare singleton, for the identical reason).
 *
 * Deliberately never calls `loader.addEntrypoints(...)` up front — a real app's own `node_modules`
 * is already fully materialized by the time any real caller runs (Deno's own `nodeModulesDir:
 * 'auto'` resolves every bare specifier the app's `deno.json` declares as part of the SAME
 * `deno run` invocation that starts `zanix space dev`/`build` in the first place), so
 * `resolveDenoAt` already succeeds without it for anything genuinely declared there — it only ever
 * calls `addEntrypoints` itself, narrowly, for a specifier that resolves to `jsr:`/`http(s):` and
 * needs expanding. Triggering it eagerly against a freshly-created project (one never previously
 * run through a real `deno run`) breaks the unrelated `ssr` environment's OWN, already-correct
 * dependency resolution (`RealImportEvaluator`/`bare-specifier-resolve.ts`'s own fix), so it stays
 * unused here beyond that one narrow, already-accepted case.
 */
const browserLoadersByConfigPath = new Map<string, Promise<Loader>>()
export function getBrowserLoader(root: string): Promise<Loader> {
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

/**
 * A referrer-aware sibling of `@deno/vite-plugin/resolver`'s own `resolveDeno` — that function
 * hardcodes `referrer: undefined` in its own `loader.resolveSync` call, which is exactly right for
 * resolving a project's own TOP-LEVEL bare imports against `root`'s single, unscoped import map (no
 * ambiguity there to resolve), but wrong for a specifier found INSIDE a file already resolved to
 * some OTHER local/remote package (`@zanix/space`'s own `mod.ts`, or a third-party Comet's own
 * re-export barrel). A bare specifier reached that way is only ever meaningful against THAT
 * package's own import map or module graph — never the consuming project's — exactly the same "a
 * member's `imports` are scoped to that member's own directory" reasoning `resolveViteSpecifier`'s
 * own `memberReferrerUrl` and `bare-specifier-resolve.ts`'s own `resolveBareSpecifierCanonically`
 * already establish for the `ssr` side.
 *
 * Mirrors `resolveDeno`'s own jsr:/http(s): `addEntrypoints`-then-re-resolve dance (needed because
 * `loader.resolveSync` alone returns an un-expanded `jsr:`/`http(s):` string the first time a given
 * target hasn't been graphed yet) rather than importing it, since `resolveDeno` itself has no
 * `referrer` parameter to thread through — reimplementing the ~15 lines here is simpler and safer
 * than forking `@deno/vite-plugin` to add one. Never handles `resolveDeno`'s own `id.startsWith('npm:')`
 * branch — that only matters for a LITERAL `npm:`-prefixed specifier, which real TypeScript source
 * text never contains; a bare specifier like `'react'` is what always shows up here instead, same
 * as `resolveDeno`'s own primary case.
 */
export async function resolveDenoAt(
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
  // filesystem path an alias-based caller could ever point to; a directive-scanning caller
  // (`discover-comets.ts`) instead fetches this URL directly to read its content. Left for either
  // kind of caller to handle on its own.
  return { id: resolved, isLocalFile: false }
}
