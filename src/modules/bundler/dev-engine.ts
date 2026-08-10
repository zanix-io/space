import type { HotUpdateOptions, Plugin, ViteDevServer } from 'vite'
import { createServer, createServerModuleRunner } from 'vite'
import deno from '@deno/vite-plugin'
import { computeAffectedRoutes } from './affected-routes.ts'
import { RealImportEvaluator } from './ssr-module-evaluator.ts'
import { cjsInteropFallbackPlugin, denoOnLoadCjsInterop } from './cjs-interop.ts'
import { canonicalBareSpecifierResolvePlugin } from './bare-specifier-resolve.ts'

// `HotUpdateOptions`/`Plugin` are intentionally NOT re-exported here, same reasoning as
// `space-plugin.ts`'s own `Plugin` doc comment: both are deeply recursive Vite/Rolldown vendor
// types this package doesn't own. `changeType`/`plugins` referencing them is an accepted,
// structural `deno doc --lint` finding, not a gap in this package's own documentation.

/**
 * Reported once per file change that affects the `ssr` environment's module graph — never for
 * the `client` environment (see {@linkcode createSpaceDevEngine}'s own doc for why).
 */
export interface SsrModuleChangedEvent {
  /** Absolute path of the file Vite detected as changed. */
  file: string
  /** Whether the file was created, edited, or deleted. */
  changeType: HotUpdateOptions['type']
  /** Route-boundary module ids reachable from `file`, per {@linkcode computeAffectedRoutes}. */
  affectedRoutes: string[]
}

/** Options for {@linkcode createSpaceDevEngine}. */
export interface SpaceDevEngineOptions {
  /** Project root Vite resolves file watching and module ids against. */
  root: string
  /**
   * Extra Vite plugins to compose alongside the engine's own internal hot-update plugin — e.g.
   * `spacePlugin()` for the `client`/`ssr` Environment API config this engine relies on.
   */
  plugins?: Plugin[]
  /**
   * Called once per edited `globalCss` file (`SpaceAppConfig.globalCss`, served as a real
   * `<link rel="stylesheet" href="...?direct">` — see `dev-css-hrefs.ts`'s own doc), with the
   * exact `?direct` urls a browser's own `<link>` tag needs re-fetched to pick up the change. Never
   * fired for a Comet's own local `import './x.css'` — that path is served as a JS-injected
   * `<style>` module through Vite's own client HMR runtime instead (same mechanism Fast Refresh
   * itself needs), not a plain `<link>` swap; it rides that mechanism once wired, not this one.
   */
  onClientCssChanged?: (urls: string[]) => void
  /**
   * Identifies whether a module id is a route-boundary file (e.g. a `routes/**\/page.tsx`
   * convention) — passed through to {@linkcode computeAffectedRoutes} unchanged.
   */
  isRouteEntry: (id: string) => boolean
  /** Called once per file change that affects the `ssr` environment. See its own doc. */
  onSsrModuleChanged?: (event: SsrModuleChangedEvent) => void
}

/**
 * A client-facing file (CSS, or a Comet's own `.tsx`), already transformed by Vite's `client`
 * environment — the browser-ready counterpart of what `ssrLoadModule` produces for the server
 * side. Returned by {@linkcode SpaceDevEngine}'s `transformClientAsset`.
 */
export interface TransformedAsset {
  /** The transformed source — real CSS for a stylesheet request, real JS for anything else. */
  code: string
  /** `text/css; charset=utf-8` or `application/javascript; charset=utf-8`, resolved from the
   * module graph's own `type` field — never guessed from the request's file extension, which a
   * Comet's transformed JS output (still requested with a `.tsx` url) would get wrong. */
  contentType: string
  /** Vite's own content hash for this transform result, when it computed one — forwarded as-is
   * to an `ETag` response header by a caller that wants conditional-request support; this engine
   * never sets response headers itself. */
  etag?: string
}

/** What {@linkcode createSpaceDevEngine} returns. */
export interface SpaceDevEngine {
  /** Loads (or reloads, if invalidated) `id` through Vite's SSR module pipeline. */
  ssrLoadModule: (id: string) => Promise<Record<string, unknown>>
  /**
   * Transforms `url` (a root-relative path, e.g. `/comets/counter.tsx` or
   * `/comets/styles.css?direct`) through Vite's `client` environment, for a real browser request
   * to consume — never for anything running inside this Deno process itself (that's
   * `ssrLoadModule`'s job). Appending `?direct` to a `.css` url returns raw transformed CSS,
   * suitable for a server-rendered `<link rel="stylesheet">`; without it, a `.css` url resolves
   * to the JS module Vite's own client runtime (`/@vite/client`) injects as a `<style>` tag at
   * runtime — the same distinction a real browser's own `import './styles.css'` relies on. Never
   * appends `?direct` itself — a caller building a `<link>` href is the one who knows it wants
   * raw CSS; this method only ever passes `url` through as given.
   *
   * @returns `null` for a url Vite can't resolve to a real file (a 404, as far as this engine is
   * concerned) — never throws for that specific case. Still throws for a genuine transform error
   * (e.g. a real syntax error in the requested file) — a caller decides how to turn that into an
   * HTTP response.
   */
  transformClientAsset: (url: string) => Promise<TransformedAsset | null>
  /** Stops the underlying Vite dev server and its file watcher. */
  close: () => Promise<void>
}

/** Vite's own `EnvironmentModuleNode.type` field ("js" | "css" | "asset") is the only reliable
 * source for a transformed file's real content-type — not part of `TransformResult` itself, and
 * not safely inferrable from the request url's own extension (a Comet's `.tsx` request resolves
 * to `type: 'js'`, never `'tsx'`). Confirmed against `vite@8.2.1`'s own dev middleware, which
 * derives its `Content-Type` response header the identical way, before this was relied on here. */
function contentTypeFor(moduleType: string | undefined): string {
  switch (moduleType) {
    case 'css':
      return 'text/css; charset=utf-8'
    case 'js':
      return 'application/javascript; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}

/** Vite's own stable, documented convention for exposing a virtual module id (one starting with
 * a real `\0` byte, per the Rollup convention every plugin — `@deno/vite-plugin` included — marks
 * its own virtual ids with) as a valid browser-requestable URL: prefixed with `/@id/`, with the
 * `\0` byte itself replaced by the literal string `__x00__` (a real byte is invalid in a URL).
 * Vite's own dev middleware reverses this (`unwrapId`) before ever calling `transformRequest` —
 * confirmed by reading `vite@8.2.0`'s own `transformRequest`/`doTransform` source directly:
 * neither one performs this decoding itself, they only ever run downstream of the middleware that
 * already did. `createDevAssetHandler` never mounts that middleware (`Deno.serve()` is the only
 * listener, see `createSpaceDevEngine`'s own doc) — so every `/@id/__x00__deno::...` request this
 * engine receives from a real browser (any bare npm import a Comet makes — `react`, for
 * instance) needs this SAME decoding applied by hand first, or `@deno/vite-plugin`'s own
 * `resolveId`/`load` hooks silently never recognize it (`isDenoSpecifier` checks for a literal
 * `\0deno` prefix, which the still-`/@id/`-wrapped, still-`__x00__`-encoded string never has) and
 * the request 404s. Confirmed as a real, previously-uncaught gap via a real, disposable
 * `puppeteer-core` spike against a real Chrome — every prior test exercised `transformClientAsset`
 * with an ALREADY-unwrapped url (`/counter.tsx`), never with the wrapped `/@id/` form a real
 * browser's own `import` of a bare specifier actually requests next.
 *
 * A no-op for anything else (relative project files, `/@vite/`, `/@fs/`, `/.vite/`, `/@react-refresh`,
 * ...) — none of those carry an encoded null byte, so `unwrapId`'s own real implementation is a
 * no-op for them too; this mirrors that exactly rather than special-casing each prefix separately.
 */
function unwrapViteId(url: string): string {
  const ID_PREFIX = '/@id/'
  const NULL_BYTE_PLACEHOLDER = '__x00__'
  if (!url.startsWith(ID_PREFIX)) return url
  return url.slice(ID_PREFIX.length).replace(NULL_BYTE_PLACEHOLDER, '\0')
}

function ssrHotUpdatePlugin(options: SpaceDevEngineOptions): Plugin {
  return {
    name: 'zanix-space-dev-hot-update',
    hotUpdate(ctx) {
      if (this.environment.name !== 'ssr') {
        // `client`-environment CSS (`globalCss`, served as a real `<link>` — see
        // `onClientCssChanged`'s own doc) is intercepted here and relayed over the same
        // `SpaceDevSocket` channel `onSsrModuleChanged` already uses — no browser is ever
        // connected to Vite's own client HMR channel (this engine never binds a real HTTP
        // listener for it, see this function's own doc), so leaving a CSS change to Vite's
        // default handling would silently do nothing. Any other `client`-environment change
        // (a Comet's own `.tsx`/local CSS import) is still left untouched (falls through,
        // `return`s `undefined`) until Fast Refresh's own transport is wired.
        const directCssUrls = ctx.modules
          .filter((mod) => mod.file?.endsWith('.css') && mod.url.includes('?direct'))
          .map((mod) => mod.url)
        if (directCssUrls.length > 0) {
          options.onClientCssChanged?.(directCssUrls)
          return []
        }
        return
      }

      const affectedRoutes = computeAffectedRoutes(ctx.modules, options.isRouteEntry)
      options.onSsrModuleChanged?.({ file: ctx.file, changeType: ctx.type, affectedRoutes })

      // An empty array tells Vite "this update was fully handled" — nothing further to
      // propagate over the `ssr` environment's own HMR channel, which no browser is ever
      // connected to in the first place (see this function's own doc).
      return []
    },
  }
}

/**
 * Creates the in-process Vite engine `zanix space dev` uses purely as a module
 * detection/invalidation engine — never as an HTTP server. `Deno.serve()` stays the only
 * listener; the returned engine is never bound to a port, and Vite's own `middlewares` are never
 * mounted anywhere (there's no supported bridge between Vite's Connect-based dev middleware and
 * `Deno.serve()`'s Web `Request`/`Response` handler — see `denoland/deno#28850`). Confirmed
 * viable end-to-end with a real, disposable spike before this was written as production code: a
 * real `Deno.serve()` process reflected an SSR module's edited content on the very next request,
 * without the process ever restarting, including through transitive dependency changes.
 *
 * No `vite.config.ts` is read (`configFile: false`) — every option this needs is passed inline,
 * which also sidesteps a documented `@deno/vite-plugin` gap (it can't resolve Deno-style imports
 * used *inside* `vite.config.ts` itself, since that file is evaluated before the plugin can
 * intercept it). `@deno/vite-plugin`'s own `deno()` plugin IS always included here — every bare
 * specifier a real page imports (`@zanix/space` itself, `react`, any other project dependency)
 * resolves against this project's own `deno.json` import map because of it; a caller's own
 * `options.plugins` never needs to add it separately. `cjsInteropFallbackPlugin()` and `deno()`'s
 * own `onLoad` (`cjs-interop.ts`) are ALSO always included, ahead of `deno()` in the array — a real
 * npm dependency that's structurally CommonJS at its own entry file (`react`/`react-dom` included)
 * fails to load through Vite's SSR pipeline otherwise, confirmed even against Vite's own untouched
 * default evaluator; see `cjs-interop.ts`'s own doc for the full reasoning.
 *
 * `watch.usePolling` defaults to `true`: Deno's filesystem-event delivery underneath chokidar's
 * native watcher was unreliable in practice during that same spike — polling is slightly less
 * efficient but deterministic, and a dev-server watch loop doesn't need sub-millisecond
 * efficiency to feel instant to a person editing a file.
 *
 * @param options - See {@linkcode SpaceDevEngineOptions}.
 * @returns A handle exposing only what a caller needs — `ssrLoadModule` and `close` — never the
 * raw `ViteDevServer` itself, so nothing outside this module is tempted to reach for
 * `.middlewares`/`.listen()` and reintroduce the bridge this function exists to avoid.
 *
 * `ssrLoadModule` does not use `server.ssrLoadModule()` (Vite's own convenience wrapper) — that
 * method is hardcoded to Vite's own default evaluator (`ESModulesEvaluator`, from
 * `vite/module-runner`), which cannot evaluate a real `@Page()` (or any other real ECMAScript
 * decorator `@zanix/server`'s handler classes use): it runs transformed code via `new
 * AsyncFunction(...)`, and V8 never parses native decorator syntax through that constructor. This
 * engine instead builds its own runner via `createServerModuleRunner` with a custom evaluator
 * (`ssr-module-evaluator.ts`'s own `RealImportEvaluator` — see its own doc for the full reasoning
 * and the real, disposable spike that confirmed it) that materializes the SAME transformed code as
 * a real `.ts` file and evaluates it via a real dynamic `import()` instead — the only thing that
 * changes; the module graph, hot-invalidation, and `transformRequest` below stay entirely Vite's
 * own.
 *
 * @example
 * ```ts
 * const engine = await createSpaceDevEngine({
 *   root: Deno.cwd(),
 *   plugins: spacePlugin(),
 *   isRouteEntry: (id) => id.includes('/routes/') && id.endsWith('page.tsx'),
 *   onSsrModuleChanged: ({ affectedRoutes }) => {
 *     for (const route of affectedRoutes) invalidatePage(route)
 *   },
 * })
 *
 * const page = await engine.ssrLoadModule('/routes/products/page.tsx')
 * ```
 */
export async function createSpaceDevEngine(
  options: SpaceDevEngineOptions,
): Promise<SpaceDevEngine> {
  const server: ViteDevServer = await createServer({
    root: options.root,
    configFile: false,
    appType: 'custom',
    server: {
      middlewareMode: true,
      watch: {
        usePolling: true,
        interval: 100,
        ignored: ['**/node_modules/**', '**/.git/**'],
      },
    },
    // Vite 8's default CSS transformer (Lightning CSS, a Rust native addon) fails to load under
    // Deno's npm compat — `require('lightningcss-<platform>')` resolves fine under plain Node
    // from the same on-disk package layout, but not through Deno's own npm resolution, and its
    // own fallback path (a `.node` file expected as a direct sibling, normally placed there by a
    // postinstall script Deno doesn't run) fails too. Confirmed empirically: `createServer()`
    // throws an uncaught `Cannot find module '...lightningcss.<platform>.node'` at boot even with
    // zero CSS files involved. `postcss` sidesteps this entirely — CSS transform/minification
    // isn't this engine's concern anyway (that's `cssPlugin`'s dev-mode counterpart, tracked
    // separately); this default only needs to be revisited if `transformClientAsset` below
    // specifically wants Lightning CSS's behavior — confirmed unaffected by that addition, since
    // it goes through the same `createServer()` config either way.
    css: { transformer: 'postcss' },
    // `environments.ssr.resolve.noExternal: true` — without it, Vite's own SSR dev pipeline
    // auto-externalizes any dependency it finds resolved into a REAL, on-disk `node_modules`
    // directory (every real consuming app has one; this repo's own Deno-flattened `.deno` store
    // alone never triggers it, which is why most fixtures in this file don't reproduce the bug).
    // An externalized module is handed to `RealImportEvaluator.runExternalModule`
    // (`ssr-module-evaluator.ts`), a raw native `import()` that completely bypasses
    // `cjs-interop.ts`'s own CJS-wrapping transform below — reproduced empirically as a real
    // `ReferenceError: module is not defined` at `react/index.js`, present regardless of
    // `@deno/loader`'s own resolution/`addEntrypoints`, and fixed by this one setting alone
    // (confirmed with a disposable repro: an identical setup fails without it, succeeds with it —
    // see `dev-engine.test.ts`'s own "noExternal regression" test). Belongs here, unconditionally,
    // rather than in `spacePlugin()` — the exact same reasoning as the three CJS-interop plugins
    // just below: this engine's own promise that a real npm dependency loads through `ssrLoadModule`
    // must not depend on which optional plugins a caller happens to pass. A real Node builtin
    // (`node:async_hooks`, ...) stays externalized regardless, since `noExternal` only ever governs
    // non-builtin resolution.
    environments: { ssr: { resolve: { noExternal: true } } },
    // `deno()` — resolves every bare specifier a real page imports (`@zanix/space` itself, `react`,
    // any project dependency) against this project's own `deno.json` import map before anything
    // else in the pipeline needs to resolve one. Without it, only relative imports work.
    //
    // `canonicalBareSpecifierResolvePlugin()` is listed FIRST, ahead of everything else — it fixes
    // a real module-identity bug in `@deno/vite-plugin`'s own resolver for bare specifiers (see its
    // own doc), and must run before `deno()`'s own `resolveId` gets a chance to. `deno()`'s own
    // resolution stays the fallback for anything the canonical hook deliberately leaves alone
    // (relative/absolute/virtual/scheme-prefixed ids) — see that file's own doc.
    //
    // `cjsInteropFallbackPlugin()` is listed before `deno()` so its `transform` hook always runs,
    // regardless of which of the two resolution paths described in its own doc a given file
    // arrives through; `deno({ onLoad })` is the primary integration point for the common path.
    //
    // All three fix real, confirmed `zanix space dev` blockers — see `ssr-module-evaluator.ts`'s,
    // `bare-specifier-resolve.ts`'s, and `cjs-interop.ts`'s own docs — none of them touch the
    // `client` environment or production SSR.
    plugins: [
      canonicalBareSpecifierResolvePlugin(),
      cjsInteropFallbackPlugin(),
      deno({ onLoad: denoOnLoadCjsInterop(options.root) }),
      ...(options.plugins ?? []),
      ssrHotUpdatePlugin(options),
    ],
  })

  const clientEnvironment = server.environments.client

  // Never `server.ssrLoadModule()` — see this function's own doc for why (Vite's own default
  // evaluator can't parse native decorator syntax). `evalDir` holds only this engine's own
  // generated `.ts` files (`RealImportEvaluator`'s own doc), removed on `close()` below.
  const evalDir = await Deno.makeTempDir({ prefix: 'zanix-space-dev-ssr-' })
  const runner = createServerModuleRunner(server.environments.ssr, {
    evaluator: new RealImportEvaluator(evalDir),
  })

  return {
    ssrLoadModule: (id) => runner.import(id),
    async transformClientAsset(url) {
      // See `unwrapViteId`'s own doc — must happen before EVERY use of `url` below, not just
      // `transformRequest`'s: Vite's own module graph stores/looks entries up by the same
      // unwrapped id `doTransform` itself uses internally, so `getModuleByUrl` needs it too, or it
      // silently misses (returning `undefined`, falling through to the wrong content type) for
      // exactly the same class of request this whole function exists to fix.
      const unwrappedUrl = unwrapViteId(url)

      let result: Awaited<ReturnType<typeof clientEnvironment.transformRequest>>
      try {
        result = await clientEnvironment.transformRequest(unwrappedUrl)
      } catch (error) {
        // A missing file doesn't return a falsy result — it REJECTS, with `code: 'ERR_LOAD_URL'`
        // (confirmed against `vite@8.2.1`'s own real error, not assumed from a generic-sounding
        // message). Translated to `null` here so this is the one, sole place a caller needs to
        // handle "not found" — every other rejection (a real syntax error, for instance) still
        // propagates unchanged, matching this method's own documented contract.
        if ((error as { code?: string }).code === 'ERR_LOAD_URL') return null
        throw error
      }
      if (!result) return null

      const mod = await clientEnvironment.moduleGraph.getModuleByUrl(unwrappedUrl)
      return { code: result.code, contentType: contentTypeFor(mod?.type), etag: result.etag }
    },
    close: async () => {
      await server.close()
      await Deno.remove(evalDir, { recursive: true })
    },
  }
}
