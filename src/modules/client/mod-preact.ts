/**
 * `@zanix/space/client/preact` — the Preact-core counterpart to `@zanix/space/client`, for an app
 * created with `--renderer=preact`.
 *
 * Same shape as `@zanix/space/client`'s own barrel, and re-exports the exact same
 * `readInitialState`/`scheduleCometHydration`/Orbit/prefetch functions (already renderer-agnostic,
 * unchanged — see this package's own decision spike) — the only different export is `hydrateComets`
 * itself, which mounts via Preact core (`hydrate`/`render` from `'preact'`) instead of React
 * (`hydrateRoot`/`createRoot` from `react-dom/client'`). An app's client entry imports from this
 * module OR from `@zanix/space/client`, never both — `--renderer` selects one for the whole
 * project, not per file.
 *
 * @module
 */
export { readInitialState } from '../render/read-initial-state.ts'
export { hydrateComets } from './hydrate-comets-preact.ts'
export { scheduleCometHydration } from './schedule-comet-hydration.ts'
export type { CometSchedulingDeps } from './schedule-comet-hydration.ts'
export { extractFragmentTitle, initOrbit, shouldInterceptNavigation } from './orbit.ts'
// `prefetch.ts` is DOM-only and imports neither renderer (its whole dependency set is
// `orbit-protocol.ts` + `link-info.ts`, both plain data/DOM helpers) — it was simply missed here
// when the React barrel gained it, which left `initOrbit({ prefetch })`'s own option type
// (`PrefetchOptions`) unnameable from a `--renderer=preact` app even though the runtime it
// configures is the exact same module. Kept deliberately in sync with `mod.ts`'s own export list;
// `client-barrel-parity.test.ts` fails if the two drift again.
export { isConnectionSlow, shouldPrefetch } from './prefetch.ts'
export type { ConnectionInfo, PrefetchOptions } from './prefetch.ts'
