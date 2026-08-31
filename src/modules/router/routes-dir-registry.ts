/**
 * The configured `routesDir` — `defineSpaceApp({ routesDir })`'s own value, captured EAGERLY (same
 * timing as `active-renderer.ts`'s own `setActiveRenderer`), not just readable from inside
 * `setup()`. `zanix space build` imports a project's `space.app.ts` to learn what it declared but
 * never calls `activateApps()` (so `setup()` never runs there) — a value only readable from inside
 * `setup()` would be invisible to the build/dev orchestrators that need it before discovering any
 * page (`discoverPages`, sitemap derivation, document validation).
 *
 * Always has a concrete value, defaulting to `'./routes'` — the same default `defineSpaceApp`'s own
 * `setup()` and `buildSpaceClient()` already apply when a project omits `routesDir` entirely, now
 * expressed once here instead of independently at each call site.
 *
 * @module
 */

let currentRoutesDir: string | string[] = './routes'

/** Set once, eagerly, by `defineSpaceApp({ routesDir })` — never called directly by application
 * code. */
export function setRoutesDir(dirs: string | string[]): void {
  currentRoutesDir = dirs
}

/** The currently configured `routesDir`, defaulting to `'./routes'` when a project never declared
 * it — the same value `defineSpaceApp`'s own `setup()` passes to `loadRoutes()`. Read by
 * `@zanix/cli`'s `zanix space build`/`zanix space dev` to locate a project's pages without either
 * command guessing at (or hardcoding) a path of its own. */
export function getRoutesDir(): string | string[] {
  return currentRoutesDir
}
