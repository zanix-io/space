import type {
  EnvironmentModuleNode,
  HotPayload,
  HotUpdateOptions,
  Plugin,
  PluginOption,
  ViteDevServer,
} from 'vite'
import { createServer, createServerModuleRunner } from 'vite'
import deno from '@deno/vite-plugin'
import { isDenoSpecifier, parseDenoSpecifier } from '@deno/vite-plugin/resolver'
import { computeAffectedRoutes } from './affected-routes.ts'
import { RealImportEvaluator } from './ssr-module-evaluator.ts'
import { cjsInteropFallbackPlugin, denoOnLoadCjsInterop } from './cjs-interop.ts'
import {
  denoOnLoadDynamicImportInterop,
  dynamicImportInteropFallbackPlugin,
} from './dynamic-import-interop.ts'
import { canonicalBareSpecifierResolvePlugin } from './bare-specifier-resolve.ts'
import { nativeRuntimeModulesPlugin } from './native-runtime-modules.ts'
import { USE_COMET_DIRECTIVE } from './comet-directive.ts'
import { formatServerOnlyViolation, SERVER_ONLY_DIRECTIVE } from './server-only-directive.ts'

// `HotUpdateOptions`/`Plugin`/`PluginOption` are intentionally NOT re-exported here, same
// reasoning as `space-plugin.ts`'s own `Plugin` doc comment: all are deeply recursive
// Vite/Rolldown vendor types this package doesn't own. `changeType`/`plugins` referencing them is
// an accepted, structural `deno doc --lint` finding, not a gap in this package's own
// documentation.

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
  /**
   * Whether `file` itself (not one of `affectedRoutes`) starts with the `'use comet'` directive —
   * lets a caller tell "the route's own file, or a server-only dependency (a `layout.tsx`, a
   * `loader`), changed — a connected browser genuinely needs a fresh document" apart from "only a
   * Comet changed, and it already reports its own `client-module-changed` update separately (see
   * `onClientModuleChanged`'s own doc) — that alone is enough to bring a connected page up to
   * date, without discarding whatever client-only state (a Comet's own `useState`, a form draft)
   * a full reload would".
   *
   * A Comet is reachable from the `ssr` environment's own module graph too (its initial HTML is
   * still server-rendered), so editing one fires `onSsrModuleChanged` exactly the same as editing
   * the route file itself would — this field is what lets a caller choose to still refresh this
   * app's own route registry/compiled dispatch table (so the NEXT real, fresh request reflects the
   * edit) while skipping only the "tell an already-connected browser to reload" side effect for
   * this one case.
   */
  isComet: boolean
}

/** Options for {@linkcode createSpaceDevEngine}. */
export interface SpaceDevEngineOptions {
  /** Project root Vite resolves file watching and module ids against. */
  root: string
  /**
   * Extra Vite plugins to compose alongside the engine's own internal hot-update plugin — e.g.
   * `spacePlugin()` for the `client`/`ssr` Environment API config this engine relies on.
   * `PluginOption[]`, not `Plugin[]` — `spacePlugin({ renderer: 'react' })`'s own return type
   * includes a `Promise<Plugin>` entry (React Compiler's plugin, resolved lazily — see
   * `space-plugin.ts`'s own doc), which this option must be able to carry through unchanged into
   * `createServer()`'s own `plugins` array below, itself already `PluginOption[]`-typed by Vite.
   */
  plugins?: PluginOption[]
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
   * Called once per edited `client`-environment script module (a Comet's own `.tsx`/`.ts`/`.jsx`/
   * `.js`). Optional: until this option is set, such a change is silently dropped (see
   * {@linkcode ssrHotUpdatePlugin}'s own doc for exactly where). `urls` are Vite's own module graph
   * urls (e.g. `/comets/counter.tsx`), the same identifiers `createHotContext(id)` receives on the
   * browser side (`dev-vite-hot-client.ts`'s own doc) — a caller re-broadcasts them verbatim over
   * `SpaceDevSocket` (`broadcastClientModuleChanged`), it never needs to resolve or transform them
   * further itself.
   *
   * Genuinely renderer-agnostic, not just deliberately worded that way — this engine has no notion
   * of which renderer produced a given Comet, and both renderers'
   * own transforms need this delivered the same way (React's `oxc.jsx`-based refresh transform and
   * Preact's `@prefresh/vite` transform both register through `import.meta.hot`/`createHotContext`
   * identically — see `dev-vite-hot-client.ts`'s own doc for the actual transform output). What
   * determines whether a connected browser acts on this at all is whether its own dev-server
   * orchestrator ALSO served `dev-vite-hot-client.ts`'s own `/@vite/client` replacement — see
   * `dev-client-script.ts`'s own `handleClientModuleChanged` doc for that guard, which applies
   * identically to either renderer.
   *
   * Never fired for a `.css` file (own dedicated {@linkcode onClientCssChanged} above) — a Comet's
   * own local `import './x.css'` stays out of scope for this option (see
   * `ssrHotUpdatePlugin`'s own doc for why that boundary is deliberate, not an oversight).
   */
  onClientModuleChanged?: (urls: string[]) => void
  /**
   * Identifies whether a module id is a route-boundary file (e.g. a `routes/**\/page.tsx`
   * convention) — passed through to {@linkcode computeAffectedRoutes} unchanged.
   */
  isRouteEntry: (id: string) => boolean
  /** Called once per file change that affects the `ssr` environment. See its own doc. */
  onSsrModuleChanged?: (event: SsrModuleChangedEvent) => void
  /**
   * Called whenever Vite's OWN dependency optimizer decides a full browser reload is needed —
   * relayed from its internal `environment.hot.send({ type: 'full-reload' })` calls (confirmed
   * against `vite@8.2.2`'s own source; this engine's own `client` environment `hot` channel is
   * always a real, always-present object — even with zero real network clients ever connected,
   * see `createSpaceDevEngine`'s own doc — so wrapping its `send` method catches every one of
   * these emissions uniformly, no per-call-site instrumentation needed). Real Vite relies on its
   * own WebSocket/HMR channel to relay this straight to the browser; this engine never binds that
   * channel to anything real, so without this option, the signal went nowhere — a real, confirmed
   * incident: a mid-session dependency re-optimize (discovering a dependency it didn't know about
   * during its first scan) changes a pre-bundled dependency's own version hash, and a page already
   * holding a transform result that embeds the STALE hash loads a second, genuinely duplicate
   * module instance of that dependency — confirmed live for `@prefresh/core`, silently breaking
   * Preact Fast-Refresh with zero error and no automatic recovery. A caller broadcasts this over
   * `SpaceDevSocket` (`broadcastFullReloadNeeded`) — see that function's own doc.
   */
  onFullReloadNeeded?: () => void
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
 * Vite's own dev middleware reverses this (`unwrapId`) before ever calling `transformRequest` — per
 * `vite@8.2.0`'s own `transformRequest`/`doTransform` source, neither one performs this decoding
 * itself, they only ever run downstream of the middleware that already did. `createDevAssetHandler`
 * never mounts that middleware (`Deno.serve()` is the only listener, see `createSpaceDevEngine`'s
 * own doc) — so every `/@id/__x00__deno::...` request this engine receives from a real browser (any
 * bare npm import a Comet makes — `react`, for instance) needs this SAME decoding applied by hand
 * first, or `@deno/vite-plugin`'s own `resolveId`/`load` hooks silently never recognize it
 * (`isDenoSpecifier` checks for a literal `\0deno` prefix, which the still-`/@id/`-wrapped,
 * still-`__x00__`-encoded string never has) and the request 404s. This matters because a real
 * browser's own `import` of a bare specifier requests exactly this wrapped `/@id/` form, distinct
 * from an already-unwrapped url (`/counter.tsx`).
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

/** Whether `filePath` itself starts with the `'use comet'` directive — see
 * {@linkcode SsrModuleChangedEvent.isComet}'s own doc for why `ssrHotUpdatePlugin` needs this.
 * Re-reads the file directly (the same regex `discoverComets`/`comet-plugin.ts` already use for
 * the identical check at build time) rather than inspecting `ctx.modules`' own transformed code —
 * simpler, and this only ever runs once per real file save, never a hot path. A file that no
 * longer exists (a delete) is never a Comet as far as this check is concerned — nothing left to
 * read the directive from. */
async function isCometFile(filePath: string): Promise<boolean> {
  try {
    return USE_COMET_DIRECTIVE.test(await Deno.readTextFile(filePath))
  } catch {
    return false
  }
}

/** Same check as {@linkcode isCometFile}, against {@linkcode SERVER_ONLY_DIRECTIVE} instead — see
 * {@linkcode findDevChainToComet}'s own doc for where this is actually used. */
async function isServerOnlyFile(filePath: string): Promise<boolean> {
  try {
    return SERVER_ONLY_DIRECTIVE.test(await Deno.readTextFile(filePath))
  } catch {
    return false
  }
}

/**
 * The real, on-disk absolute path behind an `EnvironmentModuleNode` — for any real `@zanix/space`
 * subpath import (`@zanix/space`, `@zanix/space-ui`, ... all live OUTSIDE the project root, in a
 * separate package directory), `@deno/vite-plugin`'s own `resolveViteSpecifier` resolves it to one
 * of its own virtual `\0deno::<loader>::<id>::<resolved>#deno` specifiers (`toDenoSpecifier`) —
 * NEVER a plain path Vite would recognize as one. Crucially, this means checking `mod.id` for
 * {@linkcode isDenoSpecifier} MUST run before ever trusting `mod.file`: Vite's own module graph
 * unconditionally sets `mod.file = cleanUrl(resolvedId)` for every node, virtual or not — for one
 * of these, that's just the SAME virtual specifier string with its own trailing `#deno` marker
 * stripped (`cleanUrl`'s only real effect here), never an actual file. Checking `mod.file` FIRST
 * (this function's own original, buggy shape) silently "succeeds" with that stripped-but-still-
 * virtual string, which {@linkcode isServerOnlyFile}/{@linkcode isCometFile} then fail to read as
 * a file and quietly treat as "not a match" — the exact reason a real, confirmed
 * `@zanix/space/assets-manifest` violation went completely undetected in dev before this was
 * caught: `mod.file` was truthy, just permanently wrong. `mod.id` (never mangled by `cleanUrl`)
 * always still carries the full specifier, `#deno` suffix included, so {@linkcode parseDenoSpecifier}
 * (the same public helper `@deno/vite-plugin` uses internally, already relied on elsewhere in this
 * package — see `bare-specifier-resolve.ts`'s own doc) reliably recovers the real path from it.
 *
 * `mod.file` is only ever trusted directly once `mod.id` is confirmed NOT to be a Deno specifier —
 * the ordinary case for a plain project-local file, where it already IS the real path.
 */
function realFilePathOf(mod: EnvironmentModuleNode): string | null {
  if (mod.id && isDenoSpecifier(mod.id)) {
    const { resolved } = parseDenoSpecifier(mod.id)
    // `resolved` is only ever a real filesystem path for an `esm`-kind local/JSR source — an
    // `http(s):` URL (a remote import) has no on-disk file to read, and can never carry
    // `'server-only'`/`'use comet'` as source `deno.readTextFile` could check anyway.
    return resolved.startsWith('http:') || resolved.startsWith('https:') ? null : resolved
  }
  return mod.file
}

/**
 * `transformClientAsset`'s own counterpart to `comet-plugin.ts`'s build-time
 * `findChainToComet`/`buildEnd` enforcement — same violation (a `'server-only'` module reachable
 * from a Comet), same shared {@linkcode formatServerOnlyViolation} message, but walked against
 * Vite's own dev `EnvironmentModuleNode.importers` (populated incrementally as the dev server
 * discovers import relationships, request by request) instead of a full Rollup build's own
 * reverse module graph. `mod` here is already confirmed server-only by the caller.
 *
 * Breadth-first over `importers` (the same "who pulled this in" direction the build-time walk
 * uses), stopping at the first ancestor `isCometFile` recognizes. Dev's own graph is necessarily
 * incomplete compared to a real build's (only relationships a request has actually exercised so
 * far are known) — if no Comet ancestor has been discovered yet, this still returns a real,
 * one-element chain (the offending file alone), which {@linkcode formatServerOnlyViolation}
 * already renders as something actionable, just without an import trail.
 */
async function findDevChainToComet(mod: EnvironmentModuleNode): Promise<string[]> {
  const visited = new Set<EnvironmentModuleNode>([mod])
  const parent = new Map<EnvironmentModuleNode, EnvironmentModuleNode>()
  const queue: EnvironmentModuleNode[] = [mod]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) break

    for (const importer of current.importers) {
      if (visited.has(importer)) continue
      visited.add(importer)
      parent.set(importer, current)

      const importerPath = realFilePathOf(importer)
      // deno-lint-ignore no-await-in-loop -- genuine sequential graph walk, same as comet-plugin.ts
      if (importerPath && await isCometFile(importerPath)) {
        const chain: EnvironmentModuleNode[] = [importer]
        for (let node = importer; node !== mod;) {
          const next = parent.get(node)
          if (next === undefined) break
          node = next
          chain.push(node)
        }
        return chain.map((node) => realFilePathOf(node) ?? node.url)
      }
      queue.push(importer)
    }
  }

  return [realFilePathOf(mod) ?? mod.url]
}

function ssrHotUpdatePlugin(options: SpaceDevEngineOptions): Plugin {
  return {
    name: 'zanix-space-dev-hot-update',
    async hotUpdate(ctx) {
      if (this.environment.name !== 'ssr') {
        // `client`-environment CSS (`globalCss`, served as a real `<link>` — see
        // `onClientCssChanged`'s own doc) is intercepted here and relayed over the same
        // `SpaceDevSocket` channel `onSsrModuleChanged` already uses — no browser is ever
        // connected to Vite's own client HMR channel (this engine never binds a real HTTP
        // listener for it, see this function's own doc), so leaving a CSS change to Vite's
        // default handling would silently do nothing.
        const directCssUrls = ctx.modules
          .filter((mod) => mod.file?.endsWith('.css') && mod.url.includes('?direct'))
          .map((mod) => mod.url)
        if (directCssUrls.length > 0) {
          options.onClientCssChanged?.(directCssUrls)
          return []
        }

        // Any other `client`-environment change (a Comet's own `.tsx`/`.ts`/`.jsx`/`.js`, never a
        // local CSS import — see `onClientModuleChanged`'s own doc for why that stays excluded) is
        // reported here only when `onClientModuleChanged` is set. A caller that never sets it sees
        // identical behavior either way: falls through below, `return`s `undefined`.
        const clientModuleUrls = ctx.modules
          .filter((mod) => !mod.file?.endsWith('.css'))
          .map((mod) => mod.url)
        if (clientModuleUrls.length > 0 && options.onClientModuleChanged) {
          options.onClientModuleChanged(clientModuleUrls)
          return []
        }
        return
      }

      const affectedRoutes = computeAffectedRoutes(
        ctx.modules,
        options.isRouteEntry,
      )
      options.onSsrModuleChanged?.({
        file: ctx.file,
        changeType: ctx.type,
        affectedRoutes,
        isComet: await isCometFile(ctx.file),
      })

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
 * `Deno.serve()`'s Web `Request`/`Response` handler — see `denoland/deno#28850`). A `Deno.serve()`
 * process reflects an SSR module's edited content on the very next request, without the process
 * ever restarting, including through transitive dependency changes.
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
 * fails to load through Vite's SSR pipeline otherwise, including against Vite's own untouched
 * default evaluator; see `cjs-interop.ts`'s own doc for the full reasoning.
 *
 * `watch.usePolling` defaults to `true`: Deno's filesystem-event delivery underneath chokidar's
 * native watcher is unreliable in practice — polling is slightly less efficient but deterministic,
 * and a dev-server watch loop doesn't need sub-millisecond efficiency to feel instant to a person
 * editing a file.
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
 * (`ssr-module-evaluator.ts`'s own `RealImportEvaluator` — see its own doc for the full reasoning)
 * that materializes the SAME transformed code as a real `.ts` file and evaluates it via a real
 * dynamic `import()` instead — the only thing that changes; the module graph, hot-invalidation, and
 * `transformRequest` below stay entirely Vite's own.
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
      // A real consuming app's own `deno.json` `workspace` can link a bare specifier
      // (`@zanix/space`, `@zanix/space-ui`, ...) straight to a SIBLING package's checkout,
      // entirely outside `options.root` — `comet-manifest.ts`'s own `resolveCometModuleUrl`
      // dev-mode fallback then requests it as a plain `/@fs/<absolute-path>`, Vite's own
      // convention for exactly this. Vite's default `fs.allow` (`searchForWorkspaceRoot`) walks
      // up from `root` and stops at the FIRST `.git`/lockfile boundary it finds — a Deno workspace
      // MEMBER with its own `.git` (as any project scaffolded by `zanix new` has) never reaches
      // the shared workspace root that way, so a cross-package file like this is silently treated
      // as "not found" (`ERR_LOAD_URL`), not denied — confirmed empirically, not assumed (a real
      // `default-error-view.tsx` 404 in `zanix space dev`, reproduced with a bare `createServer()`
      // against a temp root outside this very repo). `fs.strict: false` is the one fix that
      // doesn't need to know the workspace's own shape (member `.git` boundaries, lockfile
      // presence, or a missing root `.git` altogether): this dev server only ever serves whatever
      // Vite's OWN module resolution already decided to load — a page, a Comet, this package's own
      // built-in views — never an arbitrary client-supplied path, so widening what CAN be served
      // costs nothing a production request path could ever reach (`modules/dev/` is never imported
      // by `modules/render/`/`modules/router/`, see `dev-asset-handler.ts`'s own doc).
      fs: { strict: false },
      watch: {
        usePolling: true,
        // 300ms, not chokidar's own 100ms default — real polling-fallback watchers elsewhere in
        // the ecosystem (webpack, nodemon) default considerably higher (1000ms) specifically
        // because polling is understood to cost more than native fs events; 300ms keeps a saved
        // file feeling instant to a human (well under normal edit-save-observe perception) while
        // cutting real `fs.stat` volume 3x against every watched file, every tick, forever — real
        // relief for exactly the kind of main-thread contention documented below, on top of (not
        // instead of) excluding known-unbounded output directories.
        interval: 300,
        // Every one of these mirrors a directory `zanix new`'s own generated `.gitignore`
        // (`ignore.base`, `@zanix/cli`) already calls out as build/report output, never a real
        // source file a route/layout/Comet could live in — `coverage/` is the real, confirmed
        // incident this list closes: a project that has ever run `deno test --coverage` accumulates
        // thousands of small HTML/JSON files there (`deno coverage`'s own per-source-line report),
        // and this watcher previously had no entry for it. `usePolling` (this option's own doc,
        // above) means every one of those files gets a real `fs.stat` every `interval` — thousands
        // of them, every tick, forever, on the SAME single-threaded process this whole dev server
        // (and the native `zanix space dev` process hosting it) runs on. That's enough sustained
        // main-thread contention to starve out unrelated `await`s queued behind it: confirmed by
        // reproducing a real login POST against `console`'s own `csrfGuard()`-protected page —
        // `@zanix/helpers`' `validateHash` (a tight loop of thousands of sequential
        // `await crypto.subtle.digest()` calls, each one a fresh trip through the event loop) took
        // several MINUTES to resolve with a populated `coverage/` present at the project root,
        // against ~100ms with none — while every other request stayed fast, since nothing else on
        // the hot path awaits that many times in a row. Removing (or excluding) `coverage/` alone
        // reproducibly fixes it; the same reasoning extends to every other output directory below,
        // since none of them can ever legitimately grow without bound the way `coverage/` does.
        //
        // Deliberately no `**/__tmp__/**` entry, despite `__tmp__/` appearing right alongside
        // `coverage/` in that same `.gitignore` template — confirmed the hard way, not an
        // oversight: unlike every directory below (always build/report OUTPUT living inside a
        // project), `getTemporaryFolder` (`@zanix/utils`) uses `__tmp__` ecosystem-wide as a
        // general scratch ROOT that a whole temporary PROJECT gets created inside (this repo's own
        // `dev-engine.test.ts`, and `@zanix/cli`'s own `command-live-boot.test.ts`, both do
        // exactly this). A glob broad enough to exclude a project's own `__tmp__` SUBFOLDER also
        // excludes the project's OWN root when `root` itself lives inside an ancestor `__tmp__` —
        // adding it here silently stopped every one of that file's file-watch-propagation tests
        // from ever seeing an edit at all (every `waitUntil` there timed out uniformly, not just
        // the ones touching this list), which is how this was caught.
        ignored: [
          '**/node_modules/**',
          '**/.git/**',
          '**/coverage/**',
          '**/.vite/**',
          '**/dist/**',
          '**/.dist/**',
          '**/dist-ssr/**',
          '**/out/**',
          '**/vendor/**',
          '**/.logs/**',
        ],
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
    // `nativeRuntimeModulesPlugin()` is listed FIRST, ahead of even `canonicalBareSpecifierResolvePlugin()`
    // — it fixes a real module-identity bug of THIS package's own making (not `@deno/vite-plugin`'s):
    // without it, `@zanix/space`/`@zanix/server` get resolved and transformed like any other project
    // dependency, ending up as a SECOND, independent copy from the one the native `zanix space dev`
    // process already imported to run `defineSpaceApp`/`loadRoutes`/`bootstrapServers()` — silently
    // breaking every `@Page()` registration (see that file's own doc for the full mechanism, and why
    // it must run before ANY other resolver gets a chance to resolve these two specifiers into a
    // real, Vite-transformable file path).
    //
    // `canonicalBareSpecifierResolvePlugin()` is listed next, ahead of everything else it still
    // needs to precede — it fixes a real module-identity bug in `@deno/vite-plugin`'s own resolver
    // for bare specifiers (see its own doc), and must run before `deno()`'s own `resolveId` gets a
    // chance to. `deno()`'s own resolution stays the fallback for anything the canonical hook
    // deliberately leaves alone (relative/absolute/virtual/scheme-prefixed ids) — see that file's
    // own doc. Unlike the other three plugins here, this one's own `resolveId` hook DOES act on the
    // `client` environment too (not just `ssr`) — see that file's own "The `client` environment has
    // the identical asymmetry" section for the real, confirmed Preact HMR regression this closes.
    //
    // `cjsInteropFallbackPlugin()`/`dynamicImportInteropFallbackPlugin()` are listed before
    // `deno()` so their `transform` hooks always run, regardless of which of the two resolution
    // paths described in their own docs a given file arrives through; `deno({ onLoad })` — composed
    // below from both fixes' own `onLoad` integration — is the primary integration point for the
    // common path. `denoOnLoadDynamicImportInterop()` runs second, only when
    // `denoOnLoadCjsInterop()` declines (a CJS-shaped file's own bundle text never itself contains
    // an unanalyzable dynamic import worth rewriting) — see `dynamic-import-interop.ts`'s own doc
    // for the real, separate `zanix space dev` blocker this closes: a genuinely dynamic
    // `import(specifier)` (a variable, never a string literal) that Vite's own transform leaves
    // untouched, bypassing `noExternal`/CJS interop/every other fix here entirely.
    //
    // All five fix real, confirmed `zanix space dev` blockers — see `native-runtime-modules.ts`'s,
    // `ssr-module-evaluator.ts`'s, `bare-specifier-resolve.ts`'s, `cjs-interop.ts`'s, and
    // `dynamic-import-interop.ts`'s own docs. `nativeRuntimeModulesPlugin()`/
    // `cjsInteropFallbackPlugin()`/`dynamicImportInteropFallbackPlugin()`/`deno({ onLoad })` stay
    // `ssr`-only in effect (all inherently SSR-shaped concerns; `onLoad` only ever fires for
    // `deno()`'s own SSR-side module loading) — `canonicalBareSpecifierResolvePlugin()` is the one
    // exception, per its own doc above.
    plugins: [
      nativeRuntimeModulesPlugin(),
      canonicalBareSpecifierResolvePlugin(),
      cjsInteropFallbackPlugin(),
      dynamicImportInteropFallbackPlugin(),
      deno({
        onLoad: async (ctx) => {
          const cjsResult = await denoOnLoadCjsInterop(options.root)(ctx)
          return cjsResult ?? denoOnLoadDynamicImportInterop()(ctx)
        },
      }),
      ...(options.plugins ?? []),
      ssrHotUpdatePlugin(options),
    ],
  })

  const clientEnvironment = server.environments.client

  // Relays Vite's OWN internal `environment.hot.send({ type: 'full-reload' })` calls (the dep
  // optimizer's own recovery signal for a mid-session re-optimize, among other real Vite-internal
  // triggers) into `options.onFullReloadNeeded` — see that option's own doc for the full mechanism
  // and the real incident this closes. `clientEnvironment.hot` is always a real, plain object here
  // (even with zero real network clients ever connected — this engine never binds a real listener,
  // `Deno.serve()` is the only one, see this function's own doc), and its `send` is an ordinary
  // method safe to wrap: confirmed against `vite@8.2.2`'s own source that with no real client
  // connected, `send` for an `'error'`/`'full-reload'` payload just buffers it and returns — no
  // I/O, no throw. Wrapping it here, once, catches every one of Vite's own internal call sites
  // uniformly, without needing a custom `HotChannel` (which this `middlewareMode: true` engine has
  // no clean way to plug in anyway, given it never constructs a real dev environment factory).
  const originalHotSend = clientEnvironment.hot.send.bind(clientEnvironment.hot)
  clientEnvironment.hot.send = (payload: HotPayload) => {
    if (payload.type === 'full-reload') options.onFullReloadNeeded?.()
    return originalHotSend(payload)
  }

  // Waits for the client environment's dep-optimizer to finish its INITIAL discovery scan before
  // this engine is considered ready — `scanProcessing` (not publicly typed on `DevEnvironment`,
  // confirmed against `vite@8.2.2`'s own source, `createDepsOptimizer` in
  // `dist/node/chunks/node.js`) is the promise Vite itself awaits internally at the exact same
  // point (`optimizedDepsPlugin`'s own `load` hook already correctly awaits a PER-DEPENDENCY
  // `info.processing` once that dependency is REGISTERED — confirmed via a real 8-second-wait
  // repro — but a dependency this engine pre-declares via `optimizeDeps.include`
  // (`preact`/`@prefresh/core`/`@prefresh/utils`, ...) is only actually REGISTERED in the
  // optimizer's own metadata once this scan itself finishes). Without this, a request landing
  // DURING the scan for a dependency the scan hasn't registered yet doesn't hit the
  // correctly-waiting per-dependency path at all — it can instead resolve through a DIFFERENT,
  // unoptimized fallback (e.g. `/@fs/` absolute path) than what every LATER request for the same
  // specifier resolves to once the scan completes, silently producing TWO DIFFERENT module
  // instances of the same package for the same page load. Confirmed live as the real cause of a
  // Preact-only bug: `@prefresh/core`'s own re-render bookkeeping (a module-level `WeakMap`) is
  // only correct if every Comet resolves `@prefresh/core` to the exact same instance — a Comet
  // hydrated during this exact window got a different one, and its FIRST Fast-Refresh update
  // afterward silently did nothing (`flushUpdates()` ran with zero error, but the edited
  // component was never found in the OTHER instance's own `WeakMap`). This wait only ever affects
  // a genuinely fresh dev-server boot's own first moment — already-warm requests never see
  // `scanProcessing` set at all, so this is a no-op the rest of a dev session.
  await clientEnvironment.depsOptimizer?.scanProcessing

  // Never `server.ssrLoadModule()` — see this function's own doc for why (Vite's own default
  // evaluator can't parse native decorator syntax). `evalDir` holds only this engine's own
  // generated `.ts` files (`RealImportEvaluator`'s own doc), removed on `close()` below.
  const evalDir = await Deno.makeTempDir({ prefix: 'zanix-space-dev-ssr-' })
  const runner = createServerModuleRunner(server.environments.ssr, {
    evaluator: new RealImportEvaluator(evalDir),
  })

  // Strips a dep-optimizer version query (`?v=<hash>` or `&v=<hash>`) from an otherwise-untouched
  // url — same pattern Vite's own `DEP_VERSION_RE` (`/[?&](v=[\w.-]+)\b/`,
  // `dist/node/chunks/node.js`) matches, reimplemented here since that regex isn't exported from
  // Vite's public API either. See `transformRequestRetryingOptimizeDepsRace`'s own doc for why this
  // needs to be a QUERY EDIT, not a bare retry.
  function stripDepVersionQuery(url: string): string {
    const [path, query] = url.split('?')
    if (!query) return url
    const remaining = query.split('&').filter((param) => !param.startsWith('v='))
    return remaining.length ? `${path}?${remaining.join('&')}` : path
  }

  // `clientEnvironment.transformRequest(url)`, retried ONCE if it rejects with
  // `ERR_OUTDATED_OPTIMIZED_DEP`/`ERR_OPTIMIZE_DEPS_PROCESSING_ERROR` — neither exported from
  // Vite's public API (confirmed against `vite@8.2.2`'s own source, `optimizedDepsPlugin` in
  // `dist/node/chunks/node.js`, matched here by their known-stable string value, same technique
  // `transformClientAsset` below already uses for `ERR_LOAD_URL`): both mean a SECOND wave of
  // dependency discovery invalidated what this request had already resolved against — a real,
  // confirmed-live scenario for a Comet whose dependency chain is wide enough to trigger it (e.g.
  // `@zanix/space-ui`'s components pulling in `preact/jsx-runtime` on top of the renderer's own
  // already-declared `optimizeDeps`). Vite's own real dev server answers this with a 504 and
  // relies on its own `/@vite/client` WebSocket pushing a `full-reload` event so the browser
  // re-requests the comet's own importing module, which re-embeds a FRESH `?v=` hash for this
  // dependency — this engine's hand-written `/@vite/client` replacement (`dev-vite-hot-client.ts`)
  // never opens that socket at all (see its own doc), so that signal never reaches the browser:
  // confirmed live as a permanent 500 breaking Comet hydration on first load, fixed only by a
  // manual reload. A bare retry of the SAME url does NOT recover here — `ERR_OUTDATED_OPTIMIZED_DEP`
  // means the specific `?v=<hash>` this request asked for is now stale by definition (confirmed
  // live: retrying unchanged reproduced the identical error every time, forever, since the stale
  // hash never becomes valid again); the fix instead strips the version query
  // ({@linkcode stripDepVersionQuery}) before retrying, which skips Vite's own hash-mismatch check
  // entirely (`optimizedDepsPlugin`'s `load` hook only compares hashes when a `v=` query is
  // present) and serves whatever the CURRENT pre-bundle contains — the same content a fresh,
  // never-cached request would get. Recursion, not a loop, so this never trips `no-await-in-loop`
  // for what is structurally a single bounded retry, not a batch of awaits that should have been
  // parallelized. Never masks a REAL error: anything else, and a second failure of this same kind,
  // still propagates unchanged.
  async function transformRequestRetryingOptimizeDepsRace(
    unwrappedUrl: string,
    alreadyRetried = false,
  ): ReturnType<typeof clientEnvironment.transformRequest> {
    try {
      return await clientEnvironment.transformRequest(unwrappedUrl)
    } catch (error) {
      const code = (error as { code?: string }).code
      if (
        !alreadyRetried &&
        (code === 'ERR_OUTDATED_OPTIMIZED_DEP' ||
          code === 'ERR_OPTIMIZE_DEPS_PROCESSING_ERROR')
      ) {
        return transformRequestRetryingOptimizeDepsRace(
          stripDepVersionQuery(unwrappedUrl),
          true,
        )
      }
      throw error
    }
  }

  return {
    ssrLoadModule: (id) => runner.import(id),
    async transformClientAsset(url) {
      // See `unwrapViteId`'s own doc — must happen before EVERY use of `url` below, not just
      // `transformRequest`'s: Vite's own module graph stores/looks entries up by the same
      // unwrapped id `doTransform` itself uses internally, so `getModuleByUrl` needs it too, or it
      // silently misses (returning `undefined`, falling through to the wrong content type) for
      // exactly the same class of request this whole function exists to fix.
      const unwrappedUrl = unwrapViteId(url)

      let result: Awaited<
        ReturnType<typeof clientEnvironment.transformRequest>
      >
      try {
        result = await transformRequestRetryingOptimizeDepsRace(unwrappedUrl)
      } catch (error) {
        // A missing file doesn't return a falsy result — it REJECTS, with `code: 'ERR_LOAD_URL'`
        // (confirmed against `vite@8.2.1`'s own real error, not assumed from a generic-sounding
        // message). Translated to `null` here so this is the one, sole place a caller needs to
        // handle "not found" — every other rejection (a real syntax error, for instance) still
        // propagates unchanged, matching this method's own documented contract.
        const code = (error as { code?: string }).code
        if (code === 'ERR_LOAD_URL') return null
        // A SECOND, structurally different "not found" shape reaches here for at least some
        // requests (confirmed live: `/sw.js` against a real project reproduces this every time,
        // `/does-not-exist.css` reproduces the `ERR_LOAD_URL` shape above instead — both are a
        // genuinely missing file, not a syntax/transform error) — thrown by the
        // `@deno/vite-plugin`/`@jsr/deno__loader` bridge (the WASM loader Deno uses to read real
        // files off disk), as a plain `Error` with no `.code` and no `.cause` (confirmed empirically:
        // `constructor.name`/`name` are both `"Error"`, `Object.getOwnPropertyNames` is only
        // `["stack", "message"]`, `cause` is `undefined`, and it is not a `TypeError`) — the message
        // text is the only signal that exists to identify it. That makes this match strictly more
        // fragile than the structured `.code` check above: if `@jsr/deno__loader` ever reworks this
        // message's wording, this stops matching silently, with no compile-time or type-level way to
        // catch the drift. Accepted trade-off — no structured field is available to key off instead.
        if (/^Import '.+' failed, not found\.$/.test((error as Error).message ?? '')) {
          return null
        }
        throw error
      }
      if (!result) return null

      const mod = await clientEnvironment.moduleGraph.getModuleByUrl(
        unwrappedUrl,
      )

      // Dev-mode counterpart to `cometPlugin`'s own build-time `'server-only'` enforcement — see
      // `findDevChainToComet`'s own doc for why this can't just reuse that function directly.
      // Checked AFTER a successful transform (never before): only a URL that actually resolved to
      // a real file can meaningfully be checked at all, and this must run before the result below
      // ever reaches a caller — a real, checked `Comet`'s client entry must never be told this
      // content is servable. `realFilePathOf` (not raw `mod?.file`) is what makes this reach a
      // real `@zanix/space`-style dependency import too, not just a project-local file — see its
      // own doc for why `mod.file` alone would silently miss the common case entirely.
      if (mod) {
        const modPath = realFilePathOf(mod)
        if (modPath && await isServerOnlyFile(modPath)) {
          const chain = await findDevChainToComet(mod)
          throw new Error(formatServerOnlyViolation(chain))
        }
      }

      return {
        code: result.code,
        contentType: contentTypeFor(mod?.type),
        etag: result.etag,
      }
    },
    close: async () => {
      await server.close()
      await Deno.remove(evalDir, { recursive: true })
    },
  }
}
