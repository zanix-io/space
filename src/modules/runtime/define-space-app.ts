import { ProgramModule } from '@zanix/server'
import { defineZanixApp } from '@zanix/app'
import type { ZanixAppDefinition } from '@zanix/app'
import type { SpaceAppConfig } from 'typings/manifest.ts'
import { loadRoutes, setDefaultPageHeaders } from 'modules/router/mod.ts'
import { setThemeResolver } from 'modules/theme/mod.ts'
import { setExtendedSerialization } from 'modules/render/serialization-registry.ts'
import { loadPwaBuildOutput, registerPwa, setPwaConfig } from 'modules/pwa/mod.ts'
import { addGlobalCssPaths, getCssManifest, loadCssManifest } from 'modules/render/css-manifest.ts'
import {
  getClientEntryManifest,
  loadClientEntryManifest,
  setClientEntry,
} from 'modules/render/client-entry.ts'
import { getCometManifest, loadCometManifest } from 'modules/comets/comet-manifest.ts'
import { scanAssets } from 'modules/assets/scan-assets.ts'
import {
  setAssetsDirConfig,
  setMediaConfig,
  setOptimizeConfig,
  setResolvedAssets,
} from 'modules/assets/asset-registry.ts'
import { registerAssets } from 'modules/assets/register-assets.ts'
import { loadAssetsBuildOutput, loadAssetsManifest } from 'modules/assets/assets-manifest.ts'
import { createAssetsController } from 'modules/assets-api/controllers/assets.controller.ts'
import { setMessagesBuildDir, setMessagesDir } from 'modules/i18n/messages-registry.ts'
import { registerSitemap, setSitemapDeclaration } from 'modules/seo/sitemap.ts'
import { getSitemapManifest, loadSitemapManifest } from 'modules/seo/sitemap-manifest.ts'
import { registerRobots } from 'modules/seo/robots.ts'
import { getDevImportModule, setDevRoutesReloader } from 'modules/dev/dev-engine-registry.ts'
import { isDevClientEnabled } from 'modules/dev/dev-client-registry.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { setErrorResponseFormat } from 'modules/router/error-response-format-registry.ts'
import { getRoutesDir, setRoutesDir } from 'modules/router/routes-dir-registry.ts'
import { getInstalledRenderer } from 'modules/router/renderer-runtime.ts'
import { InternalError } from '@zanix/errors'
import { setValidationConfig } from 'modules/validation/config-registry.ts'

/** Deliberately non-literal, kept OUTSIDE a normal top-level `import` — `log.controller.ts` value-
 * imports `@zanix/logger` (and, transitively, `@zanix/utils`'s own `WorkerManager`), whose real
 * `new Worker(new URL(...))` pattern Vite's own `worker-import-meta-url` plugin statically detects
 * and tries to bundle as a nested sub-build the moment the file is merely reachable — a real,
 * confirmed source of build failures. `defineComet` (`.`'s OWN barrel) is what every Comet
 * imports, so `.` is unavoidably part of every client bundle's own graph;
 * `createLogApiController` itself only ever actually RUNS server-side, inside the `async setup`
 * callback below, so resolving it there — via this non-literal specifier, not a top-level import —
 * keeps `log.controller.ts` out of that graph entirely. Single consumer (this file) — stays inline,
 * not promoted to a shared specifiers file, per this package's own established convention.
 *
 * Resolved via `import.meta.resolve()` (a real, absolute `file://`/`https://jsr.io/...` URL),
 * NOT a bare `modules/...` specifier — confirmed via a real, isolated reproduction (not assumed)
 * that a bare prefix-mapped specifier used inside a DYNAMIC `import()` is resolved against the
 * RUNNING PROCESS's own root import map, not against this package's own `deno.jsonc` `"modules/":
 * "./src/modules/"` scope, even though the exact same alias resolves this package's other,
 * statically-imported `modules/...` specifiers above correctly. For any real consumer (no
 * `modules/` alias of its own) this failed outright with "not a dependency and not in import map";
 * for a consumer that happens to declare an UNRELATED `modules/` alias of its own (e.g. `@zanix/cli`'s
 * own dev checkout, which aliases `modules/` to ITS OWN `./src/modules/`), it silently resolved to
 * that consumer's own tree instead — `Module not found ".../cli/src/modules/log-api/controllers/
 * log.controller.ts"` — since `defineSpaceApp`'s `logApi` registration is unconditional, this broke
 * every real `zanix space dev`/`build` invocation, not a corner case. `import.meta.resolve()`
 * computes the URL relative to THIS file's own location at call time — still a non-literal value
 * from Vite's own static-analysis point of view (nothing here for `es-module-lexer`/Rollup to
 * pattern-match as a static import target), so the worker-bundling concern above still holds,
 * without depending on any consumer's import map at all. */
const LOG_CONTROLLER_SPECIFIER = import.meta.resolve('../log-api/controllers/log.controller.ts')

// Re-exported (not just imported) because `defineSpaceApp` below returns it — see
// `typings/manifest.ts`'s own doc comment for why referenced public types must themselves be
// public. `ZANIX_APP_DEFINITION_BRAND` (a value, not a type) is re-exported alongside it because
// `ZanixAppDefinition`'s one field is a computed property keyed by that exact symbol.
export type { ZanixAppDefinition }
export { ZANIX_APP_DEFINITION_BRAND } from '@zanix/app'

/**
 * Authors a `@zanix/space` frontend app manifest — the standard way to declare one.
 *
 * Thin, honest wrapper over `@zanix/app`'s `defineZanixApp()`: a `@zanix/space` app IS a Zanix
 * App — it reuses the exact same composition/lifecycle mechanism as a backend app, embedded or
 * remote, rather than introducing a parallel one. Passes `routes: { prefix: '' }` — an explicit,
 * empty mount prefix, not `true` — because `true` would auto-namespace every route under
 * `/{name}/...`, which is the right default for a REST API's endpoints but wrong for a page: a
 * page must resolve at the site's real path (`/products/1`), never nested under the app's own
 * composition name.
 *
 * `config.renderer` (see {@linkcode SpaceAppConfig.renderer}'s own doc) is read into the active
 * renderer flag EAGERLY, as soon as this function itself runs — readable via `getActiveRenderer()`
 * immediately after importing this app's own `space.app.ts`, well before `activateApps()` ever
 * runs. This is what lets an external orchestrator that only imports the manifest (`zanix space
 * build`, which never calls `activateApps()` at all — see its own doc in `@zanix/cli`) still learn
 * which renderer a project declared.
 *
 * Returning the manifest alone doesn't activate anything — pass it to `@zanix/app`'s
 * `activateApps()` (directly, or via `Zanix.start({ apps: {...} })` once that's wired) to actually
 * register routes/resources and run `setup`/`onStart`. Once activated, `setup(ctx)` first re-applies
 * the active renderer for `'preact'` (redundant with the eager assignment above, kept so this step
 * stays correct on its own — a no-op either way for the default `'react'`) and swaps in the Preact
 * page renderer, then runs `loadRoutes(routesDir)` before any user-provided
 * `setup` — this is what discovers and imports
 * every page under `routesDir`, scoped to this app's own composition (see `loadRoutes`'s own doc
 * for why that scoping requires running inside `setup`, not from the app's `main.ts` directly).
 * This same `loadRoutes` call imports via `getDevImportModule()` (`modules/dev/dev-engine-registry.ts`)
 * when a dev-server orchestrator has registered one — `undefined` (always true in production, and in
 * any app that never runs under `zanix space dev`) falls through to plain native `import()`, unchanged.
 *
 * @param config - See {@linkcode SpaceAppConfig}. Only `name` is required.
 * @returns The app manifest — pass it to `@zanix/app`'s `activateApps()`.
 * @throws {InternalError} If `name` doesn't match `^[a-z][a-z0-9-]*$` — thrown by
 * `defineZanixApp`'s own normalization, not by this function.
 *
 * @example
 * ```ts
 * // space.app.ts
 * import { defineSpaceApp } from '@zanix/space'
 *
 * export default defineSpaceApp({ name: 'storefront' })
 * ```
 */
export function defineSpaceApp(config: SpaceAppConfig): ZanixAppDefinition {
  const {
    name,
    version,
    dependencies,
    routesDir,
    assetsDir,
    clientBuildDir,
    messagesDir,
    globalCss,
    clientEntry,
    headers,
    theme,
    pwa,
    sitemap,
    robots,
    renderer,
    errorResponse,
    serialization,
    validation,
    optimize,
    media,
    assetsApi,
    logApi,
    setup,
  } = config

  if (headers !== undefined) setDefaultPageHeaders(headers)
  // Same eager timing as `headers` above — `setThemeResolver` just sets a module-level registry
  // value, no route registration or other side effect that needs `setup()`'s own execution context
  // (unlike `sitemap`/`robots`, below, inside `setup()`).
  if (theme !== undefined) setThemeResolver(theme.resolve)

  // Same eager timing and same registry shape as `theme` above. Off is the default and costs
  // nothing — see `SpaceAppConfig.serialization`'s own doc for what enabling it changes.
  setExtendedSerialization(serialization?.extendedTypes)
  if (pwa !== undefined) setPwaConfig(pwa === false ? undefined : pwa)
  // Same eager timing as `theme`/`headers` above — `setErrorResponseFormat` just sets a
  // module-level registry value, read at request time by `loader-error-handler.ts`/
  // `not-found-handler.ts`, never at build/dev-orchestration time, so there is no
  // `zanix space build`-needs-this-early concern the way `renderer`/`routesDir` below have.
  setErrorResponseFormat(errorResponse)
  if (globalCss !== undefined) addGlobalCssPaths(globalCss)
  if (clientEntry !== undefined) setClientEntry(clientEntry)
  // Eager, same point as `headers`/`pwa`/`globalCss` above — unlike those, this doesn't drive any
  // side effect of its own here (the actual page-renderer swap still only happens inside `setup()`
  // below, right before `loadRoutes()`, unchanged). This call exists purely so an external
  // orchestrator (`zanix space dev`/`zanix space build`, via `getActiveRenderer()`) can read the
  // real declared renderer immediately after importing this module's own `space.app.ts`, without
  // waiting for `activateApps()` to run `setup()` — `zanix space build` never calls `activateApps()`
  // at all, so without this, it would have no way to ever learn `renderer` was set to `'preact'`.
  const declaredRenderer = renderer ?? 'react'
  setActiveRenderer(declaredRenderer)
  // Eager, same reasoning/timing as `renderer` immediately above — `zanix space build`/
  // `zanix space dev` both need to know where this project's pages actually live BEFORE
  // discovering any of them (document validation, sitemap derivation), and neither call
  // `activateApps()` (`zanix space build` never does; `zanix space dev` needs the value before
  // `setup()` runs too) — see `getRoutesDir()`'s own doc for why a value only readable from inside
  // `setup()` isn't good enough here.
  setRoutesDir(routesDir ?? './routes')
  // Eager too, same reasoning/timing as `renderer` above — `assetsPlugin` (`@zanix/space/vite`,
  // wired through `buildSpaceClient`) needs to know WHICH directories to hash during
  // `zanix space build`, which never calls `activateApps()` (so never runs the `setup()` block
  // below, the only OTHER place `assetsDir` is read). This is a separate concern from
  // `setResolvedAssets`/`registerAssets` inside `setup()` below — those still only run there, since
  // scanning the directory is real, async filesystem work with no reason to run twice.
  if (assetsDir !== undefined) setAssetsDirConfig(assetsDir)
  // Eager, same timing/reasoning as `assetsDir` immediately above — this is the config half of
  // the SAME feature (`assetsPlugin({ assetsDir, optimize })`), read back by `buildSpaceClient()`
  // via `getOptimizeConfig()`, without needing `activateApps()` to have run either.
  if (optimize !== undefined) setOptimizeConfig(optimize)
  // Eager, same timing/reasoning as `optimize` immediately above — the config half of
  // `mediaPlugin`'s own feature, read back by `buildSpaceClient()` via `getMediaConfig()`.
  if (media !== undefined) setMediaConfig(media)
  // Eager, same reasoning as `renderer`/`assetsDir` above: `zanix space build` imports this module
  // to learn what the app declared and never calls `activateApps()`, so a value only readable from
  // inside `setup()` would be invisible to the very command that needs it.
  if (validation !== undefined) setValidationConfig(validation)
  // Eager too, same reasoning/precedent as `assetsDir`'s own path (`setAssetsDirConfig`) above —
  // `zanix space build`'s own message-compilation step (`@zanix/cli`'s `writeCompiledMessagesTree`)
  // needs to read this back via `getMessagesDir()` without `activateApps()` ever running. This is
  // ONLY the path string being stored eagerly, same as `assetsDir`'s own split: `loadMessages()`'s
  // actual resolution stays exactly as lazy as before — per `(lang, population)` key, on first
  // access — nothing here changes when or how a catalog file is actually read.
  if (messagesDir !== undefined) setMessagesDir(messagesDir)
  // Eager, same reasoning/precedent as `validation`/`messagesDir` above — `zanix space build`/
  // `zanix space dev` both need to know whether `sitemap` resolves to `'auto'` or a literal array
  // BEFORE `setup()` ever runs, to derive `StaticAppInput.sitemapLocations` for the SEO004/SEO006
  // cross-checks. A function source is never captured here (only `'auto'`/an array pass the
  // `typeof sitemap !== 'function'` guard) — `getSitemapDeclaration()`'s own doc explains why that
  // case has to stay unreadable this early, unchanged from before `'auto'` existed.
  if (sitemap !== undefined && typeof sitemap !== 'function') setSitemapDeclaration(sitemap)
  // Eager, additive copy of `clientBuildDir` (below) into `messages-registry.ts`'s own value —
  // deliberately NOT a change to `clientBuildDir`'s own existing consumption inside `setup()`
  // further down (that block stays exactly as it was). `loadMessages()`'s own `resolve()` reads
  // this back via `getMessagesBuildDir()` to know where `zanix space build` compiled this app's
  // catalogs to (`{clientBuildDir}/messages/...`, never `messagesDir` itself — see
  // `writeCompiledMessagesTree`'s own doc in `@zanix/cli` for why compiling in place was a real
  // bug, not a feature). A project that sets `clientBuildDir` without `messagesDir` gets an inert
  // value here — `getMessagesBuildDir()` is only ever consulted when `messagesDir` is ALSO set.
  if (clientBuildDir !== undefined) setMessagesBuildDir(clientBuildDir)

  return defineZanixApp({
    name,
    version,
    dependencies,
    routes: { prefix: '' },
    setup: async (ctx) => {
      // The one place the project's DECLARED renderer meets the INSTALLED implementation. This is
      // a consistency check, never a second configuration: `renderer` above is the only place a
      // project states its choice, and importing `@zanix/space/react` or `@zanix/space/preact` is
      // the only place an implementation arrives. Neither can silently become the other, and a
      // mismatch is reported instead of rendering with the wrong renderer.
      //
      // There is deliberately no `await import()` of either renderer here: a dynamic import in the
      // core would still be a path from `@zanix/space` to a renderer, which is exactly what the
      // entry-point split exists to remove.
      const installed = getInstalledRenderer()
      if (installed !== declaredRenderer) {
        throw new InternalError(
          installed === undefined
            ? `This app declares renderer '${declaredRenderer}', but no renderer implementation is ` +
              'installed — `@zanix/space` ships none by design. Add ' +
              `\`import '@zanix/space/${declaredRenderer}'\` to this app's own main module.`
            : `This app declares renderer '${declaredRenderer}', but '${installed}' is installed: ` +
              `its main module imports \`@zanix/space/${installed}\`. A project uses ONE renderer ` +
              'for its whole build — change whichever of the two is wrong.',
          { meta: { declaredRenderer, installedRenderer: installed } },
        )
      }

      const resolvedRoutesDir = getRoutesDir()

      await loadRoutes(resolvedRoutesDir, {
        importModule: getDevImportModule(),
      })

      // Only registered in dev mode (see `setDevRoutesReloader`'s own doc) — a plain production
      // boot never sets an import override, so nothing would ever read this reloader back anyway.
      if (getDevImportModule()) {
        setDevRoutesReloader((onlyFilePaths) =>
          ProgramModule.defineApplication(
            name,
            () =>
              loadRoutes(resolvedRoutesDir, {
                importModule: getDevImportModule(),
                onlyFilePaths,
              }),
          )
        )
      }
      // `SpaceAppConfig.clientBuildDir`'s own doc: replaces a production `main.ts`'s own six
      // manual `loadXManifest`/`loadXBuildOutput` calls. Must run BEFORE `registerPwa(pwa)`
      // immediately below — `loadPwaBuildOutput` is what `registerPwa` reads its own build output
      // directory back from, at route-registration time, the exact ordering constraint that
      // already applied when a `main.ts` called these by hand (see `loadPwaBuildOutput`'s own doc
      // in `@zanix/space`).
      //
      // Gated on `!isDevClientEnabled()`, same dev/prod split `resolveCssHrefs`/
      // `resolveClientEntryUrl` already use — NOT because a missing manifest file would be an
      // error (each of the six already tolerates that fine), but because a stale one very much
      // isn't: `znx space dev` and a real `zanix space build` commonly point at the SAME
      // `clientBuildDir` on the SAME machine, and an earlier build's real output sitting on disk
      // is the common case during local development, not a rare one. Loading it under `dev` would
      // make every Comet resolve to that OLD build's own hashed chunk names instead of the current
      // source Vite is actually serving — confirmed as a real failure, not hypothetical: a stale
      // React-Compiler-transformed chunk from a previous build, loaded into a fresh dev session's
      // own React instance, threw `Cannot read properties of null (reading 'useMemoCache')` on
      // hydration, and separately, the browser 404's/fails outright trying to dynamically import
      // that old chunk's exact hashed filename, which dev's own module graph never serves.
      if (clientBuildDir !== undefined && !isDevClientEnabled()) {
        await loadCometManifest(`${clientBuildDir}/comets-manifest.json`)
        await loadClientEntryManifest(`${clientBuildDir}/client-entry-manifest.json`)
        await loadCssManifest(`${clientBuildDir}/css-manifest.json`)
        await loadAssetsManifest(`${clientBuildDir}/assets-manifest.json`)
        loadAssetsBuildOutput(clientBuildDir)
        loadPwaBuildOutput(clientBuildDir)
        await loadSitemapManifest(`${clientBuildDir}/sitemap-manifest.json`)
      }
      // Route registration (like `loadRoutes()` above) only works inside this composition scope —
      // never called eagerly from `defineSpaceApp` itself, same reasoning `registerPwa`'s own doc
      // gives for why it must run here, not from the app's `main.ts` directly.
      if (pwa) registerPwa(pwa)
      // Omitted entirely (the default) is a genuine no-op — no directory scanned, no route
      // registered, no state touched, at zero cost (see `SpaceAppConfig.assetsDir`'s own doc for
      // why this differs from `routesDir`'s own always-scanned default).
      if (assetsDir !== undefined) {
        setResolvedAssets(await scanAssets(assetsDir))
        registerAssets()
      } else if (
        getCometManifest() !== undefined || getCssManifest() !== undefined ||
        getClientEntryManifest() !== undefined
      ) {
        // At least one production manifest was loaded (`loadCometManifest`/`loadCssManifest`/
        // `loadClientEntryManifest` — dev never calls any of these), meaning a real `zanix space
        // build` ran and produced real, hashed JS/CSS this app needs to serve. But `assetsDir` is
        // what registers the ONLY route (`/assets/:path*`, above) capable of serving that build
        // output — omitted, every one of those built files 404s at its own hashed URL, even
        // though every manifest above loaded without error. A confirmed, real failure mode this
        // warning exists specifically to catch before it reaches production silently. Not a
        // blocking error: a reverse proxy/CDN placed in front of this server that already serves
        // `/assets/*` itself (intercepting the request before it ever reaches this app) is an
        // equally valid setup this package has no way to detect — genuinely nothing to fix in
        // that case.
        const { default: logger } = await import('@zanix/logger')
        logger.warn(
          'This app loaded a production build manifest (comet/CSS/client-entry), but ' +
            '`assetsDir` is not configured in `defineSpaceApp({ ... })` — the built JS/CSS this ' +
            'app needs to serve has no route to answer through, and every request for it will ' +
            '404. Fix: set `assetsDir` to any real directory (it can be empty; it only needs to ' +
            'exist) so the `/assets/:path*` route gets registered. If a reverse proxy or CDN in ' +
            'front of this server already serves `/assets/*` on its own, this does not apply to ' +
            'you — those requests never reach this app at all.',
        )
      }
      // `messagesDir` itself is now stored eagerly, above (same precedent as `assetsDir`'s own
      // path) — nothing left to do for it here. `loadMessages()` still resolves lazily, per
      // `(lang, population)` key, on first access; only WHEN the path string gets registered
      // changed, not how or when a catalog file is actually read.
      // Same "route registration only works inside this composition scope" reasoning as `pwa`/
      // `assetsDir` above. `robots` is registered with whether `sitemap` was ALSO declared, so its
      // own `Sitemap:` auto-append (`buildRobotsTxt`'s own doc) reflects this app's real state —
      // `'auto'` counts as declared here exactly like an array/function would, since it still
      // resolves to a real `/sitemap.xml` route below (or the same nothing-registered outcome, in
      // production, before this app's first real build — see the `'auto'` branch's own doc).
      if (sitemap === 'auto') {
        if (isDevClientEnabled()) {
          // Dynamic import, dev-only cost — `@zanix/space/vite`'s own dependency graph (Vite,
          // `discoverPages`'s real filesystem scan) has no business loading in production, where
          // this branch never runs at all. Recomputed on every request (never cached), same
          // "trust nothing on disk, always reflect current source" rule `clientBuildDir`'s own
          // manifest-loading above already follows for dev.
          registerSitemap(async () => {
            const { deriveAutoSitemapEntries, discoverPages } = await import('@zanix/space/vite')
            return deriveAutoSitemapEntries(await discoverPages(resolvedRoutesDir))
          })
        } else {
          // Production: `zanix space build` already derived these from the SAME static discovery
          // pass its own document validation runs, and `loadSitemapManifest` above already read
          // them back, if a real build ever ran. Registered as a plain array — the exact same
          // zero-per-request-cost path a hand-written literal `sitemap` already takes, never a
          // second caching mechanism. Nothing registered at all before a project's first real
          // build, same degradation every other `clientBuildDir`-fed manifest already has.
          const manifestEntries = getSitemapManifest()
          if (manifestEntries !== undefined) registerSitemap(manifestEntries)
        }
      } else if (sitemap !== undefined) {
        registerSitemap(sitemap)
      }
      if (robots !== undefined) registerRobots(robots, sitemap !== undefined)
      // Same "route registration only works inside this composition scope" reasoning as
      // `pwa`/`assetsDir`/`sitemap`/`robots` above. `createAssetsController` itself IS the
      // registration (its `@Controller`/`@Post`/`@Get` decorators apply the moment it's called) —
      // nothing further to do with its return value, same as `registerAssets()`'s own
      // fire-and-forget shape. `assetsApi.service` was built entirely outside this package (see
      // `SpaceAppConfig.assetsApi`'s own doc) — this line only activates HTTP routes over it.
      if (assetsApi !== undefined) createAssetsController(assetsApi)
      // Always on, unlike `assetsApi` immediately above — this is core observability plumbing
      // (the backend half of `modules/client/client-logger.ts`'s browser relay), not an optional
      // feature an app opts into. There is no infrastructure to compose (unlike `assetsApi`'s own
      // `service`, this route only ever calls the already-configured `@zanix/logger` default
      // instance), so there's no real "off" state worth offering — every `@zanix/space` app's
      // client bundle already imports a Comet-hydration module that logs through the shared
      // client logger (see that module's own doc), so `POST /api/log` needs to exist for every
      // app the same way its own routes/PWA icons do. `logApi` (unlike `assetsApi`) is never
      // `undefined`-checked here — `createLogApiController` itself defaults a missing/undefined
      // `logApi` to `{}`, which still registers its own mandatory default `rateLimitGuard`; there
      // is no "no config passed" state that means "no guard at all" for this endpoint.
      //
      // Registered exactly once per real Application, same as `createAssetsController` above — a
      // genuine second registration under the SAME application id is a real bug (two apps
      // colliding, or a caller re-running `setup()` on purpose) and must surface as the same
      // "duplicate route" `InternalError` `createAssetsController` would give, not be swallowed.
      // A test that needs to call `setup()` more than once gives each call its own
      // `ProgramModule.defineApplication(...)` scope (see `define-space-app.test.tsx`) instead of
      // relying on this line to tolerate a shared one.
      const { createLogApiController } = await import(LOG_CONTROLLER_SPECIFIER)
      createLogApiController(logApi)
      await setup?.(ctx)
    },
  })
}
