import { ProgramModule } from '@zanix/server'
import { defineZanixApp } from '@zanix/app'
import type { ZanixAppDefinition } from '@zanix/app'
import type { SpaceAppConfig } from 'typings/manifest.ts'
import { loadRoutes, setDefaultPageHeaders } from 'modules/router/mod.ts'
import { setThemeResolver } from 'modules/theme/mod.ts'
import { setExtendedSerialization } from 'modules/render/serialization-registry.ts'
import { registerPwa, setPwaConfig } from 'modules/pwa/mod.ts'
import { addGlobalCssPaths } from 'modules/render/css-manifest.ts'
import { scanAssets } from 'modules/assets/scan-assets.ts'
import {
  setAssetsDirConfig,
  setMediaConfig,
  setOptimizeConfig,
  setResolvedAssets,
} from 'modules/assets/asset-registry.ts'
import { registerAssets } from 'modules/assets/register-assets.ts'
import { createAssetsController } from 'modules/assets-api/controllers/assets.controller.ts'
import { createLogApiController } from 'modules/log-api/controllers/log.controller.ts'
import { setMessagesDir } from 'modules/i18n/messages-registry.ts'
import { registerSitemap } from 'modules/seo/sitemap.ts'
import { registerRobots } from 'modules/seo/robots.ts'
import { getDevImportModule, setDevRoutesReloader } from 'modules/dev/dev-engine-registry.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { getInstalledRenderer } from 'modules/router/renderer-runtime.ts'
import { InternalError } from '@zanix/errors'
import { setValidationConfig } from 'modules/validation/config-registry.ts'

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
    messagesDir,
    globalCss,
    headers,
    theme,
    pwa,
    sitemap,
    robots,
    renderer,
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
  if (globalCss !== undefined) addGlobalCssPaths(globalCss)
  // Eager, same point as `headers`/`pwa`/`globalCss` above — unlike those, this doesn't drive any
  // side effect of its own here (the actual page-renderer swap still only happens inside `setup()`
  // below, right before `loadRoutes()`, unchanged). This call exists purely so an external
  // orchestrator (`zanix space dev`/`zanix space build`, via `getActiveRenderer()`) can read the
  // real declared renderer immediately after importing this module's own `space.app.ts`, without
  // waiting for `activateApps()` to run `setup()` — `zanix space build` never calls `activateApps()`
  // at all, so without this, it would have no way to ever learn `renderer` was set to `'preact'`.
  const declaredRenderer = renderer ?? 'react'
  setActiveRenderer(declaredRenderer)
  // Eager too, same reasoning/timing as `renderer` above — `assetsPlugin` (`@zanix/space/vite`,
  // wired through `buildSpaceClient`) needs to know WHICH directories to hash during
  // `zanix space build`, which never calls `activateApps()` (so never runs the `setup()` block
  // below, where `assetsDir` was previously ONLY readable). This is a separate concern from
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

      const resolvedRoutesDir = routesDir ?? './routes'
      await loadRoutes(resolvedRoutesDir, {
        importModule: getDevImportModule(),
      })
      // Only registered in dev mode (see `setDevRoutesReloader`'s own doc) — a plain production
      // boot never sets an import override, so nothing would ever read this reloader back anyway.
      if (getDevImportModule()) {
        setDevRoutesReloader(() =>
          ProgramModule.defineApplication(
            name,
            () =>
              loadRoutes(resolvedRoutesDir, {
                importModule: getDevImportModule(),
              }),
          )
        )
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
      }
      // `messagesDir` itself is now stored eagerly, above (same precedent as `assetsDir`'s own
      // path) — nothing left to do for it here. `loadMessages()` still resolves lazily, per
      // `(lang, population)` key, on first access; only WHEN the path string gets registered
      // changed, not how or when a catalog file is actually read.
      // Same "route registration only works inside this composition scope" reasoning as `pwa`/
      // `assetsDir` above. `robots` is registered with whether `sitemap` was ALSO declared, so its
      // own `Sitemap:` auto-append (`buildRobotsTxt`'s own doc) reflects this app's real state.
      if (sitemap !== undefined) registerSitemap(sitemap)
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
      createLogApiController(logApi)
      await setup?.(ctx)
    },
  })
}
