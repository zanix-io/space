/**
 * `@zanix/space/client` — the entry point safe to import from client (browser-bundled) code.
 *
 * Kept deliberately separate from the root `.` entry point, which transitively imports
 * `react-dom/server` (via the render module) — importing anything from `.` in a client entry
 * would pull server-only code into the client bundle. Everything re-exported here has zero
 * server-only dependencies, verified per-module as each one is added, not assumed.
 *
 * @module
 */
export { readInitialState } from '../render/read-initial-state.ts'
export { hydrateComets } from './hydrate-comets.ts'
export { hydrateErrorBoundaries } from './hydrate-error-boundaries.ts'
export { scheduleCometHydration } from './schedule-comet-hydration.ts'
export type { CometSchedulingDeps } from './schedule-comet-hydration.ts'
export { extractFragmentTitle, initOrbit, navigate, shouldInterceptNavigation } from './orbit.ts'
export type { NavigateOptions } from './orbit.ts'
export { getActiveCspNonce } from './active-nonce.ts'
export { isConnectionSlow, shouldPrefetch } from './prefetch.ts'
export type { ConnectionInfo, PrefetchOptions } from './prefetch.ts'
export { isCometPersisted } from './comet-persistence.ts'
