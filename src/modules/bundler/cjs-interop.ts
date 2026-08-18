import { type Loader, RequestedModuleType, ResolutionMode } from '@deno/loader'
import type { Plugin } from 'vite'
import type { LoadContext, OnLoadResult } from '@deno/vite-plugin'
import { getSharedLoader } from './deno-loader.ts'
import { resolveBareSpecifierCanonically } from './bare-specifier-resolve.ts'

/**
 * Fixes a real, confirmed `zanix space dev` blocker that is entirely separate from
 * {@linkcode RealImportEvaluator}'s own decorator fix (`ssr-module-evaluator.ts`): `react` and
 * `react-dom` are CommonJS at their real npm entry files, and Vite's SSR pipeline never transforms
 * CJS to ESM on its own — reproduced with Vite's own untouched default evaluator too, so this is
 * pre-existing, not a regression this package introduced. Left unfixed, this blocks the one case
 * `zanix space dev` structurally can't avoid: a real JSX + React page.
 *
 * This module owns none of the module graph, resolution/invalidation, or HMR — those stay
 * entirely Vite's/`@deno/vite-plugin`'s own. It only ever rewrites a single module's own
 * transformed source text, the same shape as any other Vite `transform` hook.
 *
 * ## Why the CJS subtree is bundled by hand, not routed through Vite's own module graph
 *
 * A relative `require('./foo')` inside a CJS file cannot simply be resolved to an absolute path
 * and left for Vite to load on its own: confirmed empirically that an absolute, already-resolved
 * path is treated by `@deno/vite-plugin`'s own internal routing as "inside project root, already
 * resolved" and read through Vite's native filesystem loader instead of this plugin's own `onLoad`
 * — the sub-file's raw, un-transformed CJS content would reach the evaluator unprocessed. Nor can
 * the sub-request be routed by re-encoding `@deno/vite-plugin`'s own private virtual-id scheme
 * (`\0deno::...#deno`) — that format is undocumented, internal, and not guaranteed stable across
 * dot releases.
 *
 * The fix instead resolves and loads the ENTIRE relative-require subtree up front, directly via
 * `@deno/loader`'s own public `Workspace`/`Loader` API (the same resolver `@deno/vite-plugin` uses
 * internally, just invoked directly here — via `deno-loader.ts`'s shared instance), and inlines it
 * as a single, self-contained synchronous CJS runtime — the same shape as webpack/browserify's own
 * hand-built `__require`. Only a BARE specifier (`require('react')` from inside `react-dom`'s own
 * code) still goes through Vite's real module graph (via `__vite_ssr_import__`), which is what
 * preserves the React singleton — Vite dedupes by resolved id, not by original specifier string, so
 * a module already loaded through the page's own `import 'react'` is reused, never duplicated —
 * PROVIDED both resolve to the same id in the first place, which is
 * {@linkcode bare-specifier-resolve.ts!canonicalBareSpecifierResolvePlugin}'s own job, not this
 * file's (see that file's own doc for the identity bug it fixes and the real spike that validated
 * it).
 *
 * ## Why every factory function — and the top-level bare-specifier fetch — must stay synchronous
 *
 * An earlier version made every CJS factory `async` so it could `await __cjsRequire__(...)`/
 * `await __vite_ssr_import__(...)` inline. That failed Rolldown's own parser with `` `await` is
 * only allowed within async functions and at the top levels of modules `` — traced to react's own
 * source wrapping its entire dev-mode implementation in a plain, non-async IIFE (`"production" !==
 * process.env.NODE_ENV && (function () { ... var React = require("react") ... })();`). `await`
 * inside a nested, non-async closure is invalid regardless of how any OUTER function is declared —
 * marking an outer wrapper `async` does not make an inner, separately-declared function awaitable.
 * The fix: every relative-require lookup is fully synchronous (`__cjsRequire__(id)`), since the
 * entire subtree was already recursively pre-loaded before the bundle is even emitted; a bare
 * specifier is instead pre-fetched exactly once, at the bundle's own true top level (the only place
 * `await` is guaranteed syntactically valid), then looked up synchronously via `__bareRequire__`.
 *
 * ## A bare specifier is resolved canonically before being handed to `__vite_ssr_import__`
 *
 * `__vite_ssr_import__(target, {})` is called with `target` resolved via
 * `bare-specifier-resolve.ts`'s own {@linkcode resolveBareSpecifierCanonically} first, not the
 * original bare string. This is NOT redundant with that file's own `resolveId` hook
 * (`canonicalBareSpecifierResolvePlugin`) being registered in `createSpaceDevEngine`'s own
 * `plugins` — a bare specifier called from inside THIS file's own hand-written bundle text goes
 * through Vite's own module-runner `fetchModule`, which has a fast path (a bare string + a known
 * importer) that resolves it via Vite's plain Node resolution and never consults any plugin's
 * `resolveId` at all (confirmed empirically; see `resolveBareSpecifierCanonically`'s own doc for
 * the full finding). Resolving here first, and handing `__vite_ssr_import__` an already-resolved
 * absolute path, is what makes it skip that fast path — the same canonical resolution
 * `bare-specifier-resolve.ts`'s `resolveId` hook already applies to a normal import statement.
 *
 * Whatever the CJS module's own bare requires resolve to (a plain CJS `.js`, a real ESM module with
 * no `default` export at all, ...), the fetched value is used as-is — the WHOLE namespace object,
 * never narrowed to `.default` (an earlier version did, which happened to work by accident for a
 * CJS target — its own synthesized `default` equals the whole `exports` object — and silently
 * returned `undefined` for a real ESM dependency with no `default` export; confirmed empirically).
 */

const REQUIRE_RE = /require\(\s*(['"])([^'"]+)\1\s*\)/g
// The same content-based heuristic real tools (e.g. `@rollup/plugin-commonjs`) use — `@deno/
// loader`'s own `MediaType.Cjs` does not reliably fire for a structurally-CJS `.js` file (confirmed
// empirically: it only fires for a literal `.cjs` extension), so detection can't rely on it.
// `exports\.\w+` (not `\w` — confirmed empirically with `react-dom/server.browser.js`'s own real
// `exports.version`/`exports.renderToString`/... assignments: a single-char `\w` followed by a
// trailing `\b` never matches a real multi-character property name, since there's no word boundary
// between two word characters — this file was silently passed through unwrapped until fixed).
const CJS_SHAPE_RE = /\bmodule\.exports\b|\bexports\.\w+|\bObject\.defineProperty\(\s*exports\s*,/
const ESM_SHAPE_RE = /^\s*(import|export)\b/m

const decoder = new TextDecoder()

interface CjsBundle {
  /** The resolved id of the file `wrapCjsIfNeeded` was originally called for. */
  entryId: string
  /** Resolved id -> factory function source (`''` for an externalized/`node:` dependency). */
  factories: Map<string, string>
  /** Every bare (non-relative) specifier `require()`d anywhere in the subtree. */
  bareSpecifiers: Set<string>
}

/**
 * Recursively resolves and loads every RELATIVE `require()` reachable from `entryUrl`, producing
 * one synchronous CJS factory per file. Never recurses into a bare specifier's own subtree — that
 * stays external, resolved through Vite's real module graph instead (see this module's own doc).
 */
async function buildCjsBundle(
  entryUrl: string,
  loader: Loader,
): Promise<CjsBundle> {
  const factories = new Map<string, string>()
  const bareSpecifiers = new Set<string>()
  const visiting = new Set<string>()

  async function visit(fileUrl: string): Promise<void> {
    if (factories.has(fileUrl) || visiting.has(fileUrl)) return
    visiting.add(fileUrl)

    const result = await loader.load(fileUrl, RequestedModuleType.Default)
    if (result.kind === 'external') {
      factories.set(fileUrl, '')
      visiting.delete(fileUrl)
      return
    }

    const code = decoder.decode(result.code)
    const specs: string[] = []
    for (const match of code.matchAll(REQUIRE_RE)) specs.push(match[2])

    const resolvedIds: string[] = []
    for (const spec of specs) {
      if (spec.startsWith('.')) {
        const resolved = loader.resolveSync(
          spec,
          fileUrl,
          ResolutionMode.Require,
        )
        // subtree must finish loading before the next require's factory can safely reference it.
        // deno-lint-ignore no-await-in-loop -- a genuine recursive graph walk; each require's own
        await visit(resolved)
        resolvedIds.push(resolved)
      } else {
        bareSpecifiers.add(spec)
        resolvedIds.push(spec)
      }
    }

    let index = 0
    const rewritten = code.replace(REQUIRE_RE, () => {
      const resolvedId = resolvedIds[index]
      const isRelative = specs[index].startsWith('.')
      index++
      return isRelative
        ? `__cjsRequire__(${JSON.stringify(resolvedId)})`
        : `__bareRequire__(${JSON.stringify(resolvedId)})`
    })
    factories.set(
      fileUrl,
      `function(module, exports) {\nconst require = __cjsRequire__\n${rewritten}\n}`,
    )
    visiting.delete(fileUrl)
  }

  await visit(entryUrl)
  return { entryId: entryUrl, factories, bareSpecifiers }
}

/**
 * Rewrites `code` into a self-contained synchronous CJS runtime if — and only if — it structurally
 * looks like CommonJS (see `CJS_SHAPE_RE`/`ESM_SHAPE_RE`); returns `null` for anything else, the
 * same "not my concern, leave it untouched" contract every Vite `transform` hook follows. Safe to
 * call more than once for the same `id` (e.g. once via `deno()`'s own `onLoad`, once via the
 * `transform`-hook fallback below) — each call independently resolves and rebuilds its own bundle,
 * with no shared mutable state beyond the process-wide loader cache.
 */
export async function wrapCjsIfNeeded(
  code: string,
  id: string,
  root: string,
): Promise<OnLoadResult> {
  if (!CJS_SHAPE_RE.test(code) || ESM_SHAPE_RE.test(code)) return null

  const fileUrl = id.startsWith('file://') ? id : new URL(id, 'file:///').href
  const loader = await getSharedLoader(root)
  const { entryId, factories, bareSpecifiers } = await buildCjsBundle(
    fileUrl,
    loader,
  )

  const factoryEntries = [...factories.entries()].filter(([, body]) => body !== '')
  const fnNames = new Map(
    factoryEntries.map(([fid], i) => [fid, `__cjsFactory_${i}__`]),
  )
  const factoryDecls = factoryEntries
    .map(([fid, body]) => body.replace('function(', `function ${fnNames.get(fid)}(`))
    .join('\n\n')
  const ids = factoryEntries.map(([fid]) => fid)
  const registryEntries = ids
    .map((fid) => `  ${JSON.stringify(fid)}: ${fnNames.get(fid)},`)
    .join('\n')

  const bareEntries = [...bareSpecifiers]
  // Resolved via `resolveBareSpecifierCanonically` FIRST, never the bare string handed to
  // `__vite_ssr_import__` directly — see this file's own header doc ("A bare specifier is resolved
  // canonically before ...") for why: Vite's own module-runner `fetchModule` takes a fast path for
  // a bare string called with a known importer that bypasses the plugin `resolveId` chain (and
  // therefore `bare-specifier-resolve.ts`'s own fix) entirely. Falls back to the original spec
  // untouched when canonical resolution declines (e.g. a real npm package `@deno/loader` and Vite's
  // own native Node resolution already agree on) — the whole namespace object is used as-is either
  // way, never narrowed to `.default` (an earlier version did; see this file's own header doc).
  const bareFetches = (await Promise.all(bareEntries.map(async (spec, i) => {
    const resolved = await resolveBareSpecifierCanonically(spec, root)
    const target = resolved ?? spec
    return `const __bareModule_${i}__ = await __vite_ssr_import__(${JSON.stringify(target)}, {})`
  }))).join('\n')
  const bareMap = bareEntries
    .map((spec, i) => `  ${JSON.stringify(spec)}: __bareModule_${i}__,`)
    .join('\n')

  const bundle = `export {}
${bareFetches}
const __bareModules__ = {
${bareMap}
}
function __bareRequire__(spec) { return __bareModules__[spec] }
${factoryDecls}
const __cjsFactories__ = {
${registryEntries}
}
const __cjsCache__ = {}
function __cjsRequire__(fid) {
  if (__cjsCache__[fid]) return __cjsCache__[fid].exports
  const module = { exports: {} }
  __cjsCache__[fid] = module
  __cjsFactories__[fid](module, module.exports)
  return module.exports
}
const __cjsResult__ = __cjsRequire__(${JSON.stringify(entryId)})
const __cjsResultType__ = typeof __cjsResult__
const __cjsIsObjectLike__ = __cjsResultType__ === 'object' || __cjsResultType__ === 'function'
const __cjsResultKeys__ = __cjsResult__ && __cjsIsObjectLike__ ? Object.keys(__cjsResult__) : []
for (const __cjsKey__ of __cjsResultKeys__) {
  __vite_ssr_exportName__(__cjsKey__, () => __cjsResult__[__cjsKey__])
}
if (!__cjsResultKeys__.includes('default')) {
  __vite_ssr_exportName__('default', () => __cjsResult__)
}
`
  return { code: bundle }
}

/**
 * A factory, not a plain handler — `deno()`'s own `LoadContext` (`@deno/vite-plugin`'s public type)
 * carries no `root`/config information at all, only `code`/`id`/`mediaType`/`environment`/`ssr`, so
 * `root` must be captured via closure from `createSpaceDevEngine`'s own `options.root` at the call
 * site (`deno({ onLoad: denoOnLoadCjsInterop(options.root) })`) instead. `root` is what makes
 * `wrapCjsIfNeeded`'s own bare-specifier resolution agree with the SAME project's real, on-disk
 * `node_modules` Vite's own SSR fast path resolves against — see `resolveBareSpecifierCanonically`'s
 * own doc for the regression this fixes.
 *
 * The returned function is passed as `deno()`'s own `onLoad` option — the primary integration
 * point, run right after `@deno/loader` transpiles a module `@deno/vite-plugin` itself resolved.
 * Only ever active for the `ssr` environment; the `client` environment's own CJS handling (if any is
 * ever needed there) is intentionally out of scope for this dev-only SSR fix.
 */
export function denoOnLoadCjsInterop(
  root: string,
): (ctx: LoadContext) => OnLoadResult | Promise<OnLoadResult> {
  return (ctx) => {
    if (!ctx.ssr) return null
    return wrapCjsIfNeeded(ctx.code, ctx.id, root)
  }
}

/**
 * A second, independent safety net alongside {@linkcode denoOnLoadCjsInterop} — confirmed
 * necessary, not defensive-programming filler: the SAME underlying CJS file can reach the
 * evaluator through TWO different resolution paths in practice (once through `@deno/vite-plugin`'s
 * own wrapped id, which triggers its `onLoad`; once through a plain, unwrapped specifier — e.g.
 * Vite's own automatic JSX-runtime auto-injection — which resolves via Vite's native FS loader and
 * skips `onLoad` entirely). A generic `transform` hook fires for every module regardless of which
 * path it arrived through, so it catches exactly the case `onLoad` alone misses. Registered before
 * `deno()` in `createSpaceDevEngine`'s own `plugins` array so it runs first — either hook's own
 * `wrapCjsIfNeeded` call has an identical, idempotent effect if the other already handled the file.
 */
export function cjsInteropFallbackPlugin(): Plugin {
  return {
    name: 'zanix-space-dev-cjs-interop-fallback',
    transform(code, id) {
      if (this.environment?.name !== 'ssr') return null
      return wrapCjsIfNeeded(code, id, this.environment.config.root)
    },
  }
}
