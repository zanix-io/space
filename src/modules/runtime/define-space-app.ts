import { ProgramModule } from '@zanix/server'
import { defineZanixApp } from '@zanix/app'
import type { ZanixAppDefinition } from '@zanix/app'
import type { SpaceAppConfig } from 'typings/manifest.ts'
import { loadRoutes, setDefaultPageHeaders } from 'modules/router/mod.ts'
import { registerPwa, setPwaConfig } from 'modules/pwa/mod.ts'
import { setGlobalCssPaths } from 'modules/render/css-manifest.ts'
import { getDevImportModule, setDevRoutesReloader } from 'modules/dev/dev-engine-registry.ts'

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
 * Returning the manifest alone doesn't activate anything — pass it to `@zanix/app`'s
 * `activateApps()` (directly, or via `Zanix.start({ apps: {...} })` once that's wired) to actually
 * register routes/resources and run `setup`/`onStart`. Once activated, `setup(ctx)` runs
 * `loadRoutes(routesDir)` before any user-provided `setup` — this is what discovers and imports
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
  const { name, version, dependencies, routesDir, globalCss, headers, pwa, setup } = config

  if (headers !== undefined) setDefaultPageHeaders(headers)
  if (pwa !== undefined) setPwaConfig(pwa === false ? undefined : pwa)
  if (globalCss !== undefined) setGlobalCssPaths(globalCss)

  return defineZanixApp({
    name,
    version,
    dependencies,
    routes: { prefix: '' },
    setup: async (ctx) => {
      const resolvedRoutesDir = routesDir ?? './routes'
      await loadRoutes(resolvedRoutesDir, { importModule: getDevImportModule() })
      // Only registered in dev mode (see `setDevRoutesReloader`'s own doc) — a plain production
      // boot never sets an import override, so nothing would ever read this reloader back anyway.
      if (getDevImportModule()) {
        setDevRoutesReloader(() =>
          ProgramModule.defineApplication(
            name,
            () => loadRoutes(resolvedRoutesDir, { importModule: getDevImportModule() }),
          )
        )
      }
      // Route registration (like `loadRoutes()` above) only works inside this composition scope —
      // never called eagerly from `defineSpaceApp` itself, same reasoning `registerPwa`'s own doc
      // gives for why it must run here, not from the app's `main.ts` directly.
      if (pwa) registerPwa(pwa)
      await setup?.(ctx)
    },
  })
}
