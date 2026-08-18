import type { ImportedModule } from 'modules/router/load-routes.ts'

/** The shape `loadRoutes`'s own `LoadRoutesOptions.importModule` accepts — see its own doc. */
export type DevImportModule = (filePath: string) => Promise<ImportedModule>

let importModule: DevImportModule | undefined
let routesReloader: (() => Promise<void>) | undefined

/**
 * Set once by a dev-server orchestrator (`zanix space dev`) before `activateApps()` runs — never by
 * a page author, and never set in a production build. Same pattern as `setDevClientEnabled`/
 * `setPwaConfig`: a module-level value read at a fixed point in the production code path, rather
 * than threading a parameter through it.
 *
 * This exists because `defineSpaceApp`'s own `loadRoutes()` call runs inside `@zanix/app`'s
 * `ProgramModule.defineApplication` scope (see `loadRoutes`'s own doc for why that scoping is
 * required) — a dev-server orchestrator has no way to reach into that call directly, since it never
 * calls `loadRoutes` itself. Registering the override here, ahead of time, is what lets that single,
 * correctly-scoped call use a `SpaceDevEngine`'s `ssrLoadModule` instead of native `import()`,
 * without `defineSpaceApp` gaining a dev-only parameter of its own.
 */
export function setDevImportModule(value: DevImportModule | undefined): void {
  importModule = value
}

/** Read by `defineSpaceApp`'s own `setup()` to decide which `loadRoutes` import strategy to use. */
export function getDevImportModule(): DevImportModule | undefined {
  return importModule
}

/**
 * Registered by `defineSpaceApp`'s own `setup()`, only while {@link getDevImportModule} is set
 * (dev mode) — a closure that re-enters this exact app's own `ProgramModule.defineApplication`
 * scope and re-runs `loadRoutes` for its own `routesDir`, using whatever import override is
 * registered at CALL time (not capture time), so a later `setDevImportModule` swap is still
 * honored. `ProgramModule.defineApplication` is a stateless ambient-context wrapper (see its own
 * doc — ownership is resolved fresh on every `RouteContainer.defineRoute` call, nothing is
 * persisted about "an Application was already defined"), so calling it again here, well after this
 * app's own `activateApps()` call already returned, is safe and produces no observable effect
 * beyond correctly attributing whatever `loadRoutes` registers during this one call.
 *
 * This is what lets a dev-server orchestrator (`zanix space dev`) react to a file change with a
 * single, generic `await getDevRoutesReloader()?.()` — it never needs to know this app's own name
 * or `routesDir` itself; both stay entirely inside `defineSpaceApp`'s own closure.
 */
export function setDevRoutesReloader(
  value: (() => Promise<void>) | undefined,
): void {
  routesReloader = value
}

/** Read by a dev-server orchestrator (`zanix space dev`) on every file change it decides is
 * SSR-relevant — `undefined` outside dev mode (nothing was ever registered). */
export function getDevRoutesReloader(): (() => Promise<void>) | undefined {
  return routesReloader
}
