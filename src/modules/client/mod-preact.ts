/**
 * `@zanix/space/client/preact` — the Preact-core counterpart to `@zanix/space/client`, for an app
 * created with `--renderer=preact`.
 *
 * Same shape as `@zanix/space/client`'s own barrel, and re-exports the exact same
 * `readInitialState`/`scheduleCometHydration`/Orbit/prefetch functions (already renderer-agnostic)
 * — the only different export is `hydrateComets` itself, which mounts via Preact core
 * (`hydrate`/`render` from `'preact'`) instead of React
 * (`hydrateRoot`/`createRoot` from `react-dom/client'`). An app's client entry imports from this
 * module OR from `@zanix/space/client`, never both — `--renderer` selects one for the whole
 * project, not per file.
 *
 * @module
 */
export {
  /** Reads back the server-serialized `initialState` a page/Comet handed off, on the client. */
  readInitialState,
} from '../render/read-initial-state.ts'
/** Hydrates every Comet boundary in `root` via Preact core's `hydrate`/`render`. */
export { hydrateComets } from './hydrate-comets-preact.ts'
export {
  /** Runs a Comet's hydration according to its own `CometStrategy` (`load`/`idle`/`visible`/
   * `media`/`none`). */
  scheduleCometHydration,
} from './schedule-comet-hydration.ts'
export type {
  /** Overrides for the browser primitives {@linkcode scheduleCometHydration} defers to — lets
   * tests substitute deterministic fakes. */
  CometSchedulingDeps,
} from './schedule-comet-hydration.ts'
export {
  /** Pulls a fragment response's `<title>` back out and strips it from the body. */
  extractFragmentTitle,
  /** Turns on Orbit: intercepts same-origin `<a>` clicks and swaps just the page's own outlet. */
  initOrbit,
  /** Whether a given link click should be intercepted by Orbit instead of navigating normally. */
  shouldInterceptNavigation,
} from './orbit.ts'
// `prefetch.ts` is DOM-only and imports neither renderer (its whole dependency set is
// `orbit-protocol.ts` + `link-info.ts`, both plain data/DOM helpers) — it was simply missed here
// when the React barrel gained it, which left `initOrbit({ prefetch })`'s own option type
// (`PrefetchOptions`) unnameable from a `--renderer=preact` app even though the runtime it
// configures is the exact same module. Kept deliberately in sync with `mod.ts`'s own export list;
// `client-barrel-parity.test.ts` fails if the two drift again.
export {
  /** Whether the current connection is slow/metered enough that prefetch should never start. */
  isConnectionSlow,
  /** Whether a given link should be prefetched ahead of a click. */
  shouldPrefetch,
} from './prefetch.ts'
export type {
  /** The connection info `isConnectionSlow` reads — `navigator.connection`'s own shape, read
   * defensively since it's not implemented by every browser. */
  ConnectionInfo,
  /** `initOrbit({ prefetch })`'s own option shape — `onHover`/`onViewport` triggers. */
  PrefetchOptions,
} from './prefetch.ts'
