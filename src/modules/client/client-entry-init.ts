import { hydrateComets } from './hydrate-comets.ts'
import { hydrateErrorBoundaries } from './hydrate-error-boundaries.ts'
import { initOrbit } from './orbit.ts'
import type { PrefetchOptions } from './prefetch.ts'

/**
 * Runs this app's whole client-entry boot sequence in one call: `hydrateComets()`,
 * `hydrateErrorBoundaries()`, then `initOrbit(options)` — the exact three calls
 * `client-entry-plugin.ts`'s own auto-generated default entry makes (that generator now calls this
 * instead of repeating them inline, so there's only ever one real place the sequence is written).
 *
 * Exists for the one case a project still writes its own client-entry file by hand:
 * `defineSpaceApp({ clientEntry })` REPLACES the generated default entirely (see
 * `typings/manifest.ts`'s own doc — no partial opt-out), so an author adding a single line of their
 * own code (a service worker registration, an analytics init, ...) previously had to reproduce all
 * three calls first, then add their own line. `initClientEntry()` with no arguments is exactly
 * equivalent to that reproduction — `hydrateComets()`/`hydrateErrorBoundaries()`/`initOrbit()` stay
 * independently exported and independently callable for anyone who still wants them separate (e.g.
 * to interleave code between them).
 *
 * No `root` parameter, unlike `hydrateComets`/`hydrateErrorBoundaries` themselves: at true
 * client-entry time (the very first load) `root` is always the whole `document` in every real call
 * site — the only place either function is ever called with a scoped `root` is `orbit.ts`'s own
 * post-navigation re-hydration, which goes through `hydrator-registry.ts`, never through this
 * function. A caller who genuinely needs a scoped `root` is already outside this function's use
 * case and should call `hydrateComets`/`hydrateErrorBoundaries` directly instead.
 *
 * Call order between the three has no functional significance of its own — each of
 * `hydrateComets`/`hydrateErrorBoundaries` registers itself as the active hydrator at MODULE LOAD
 * time (`hydrator-registry.ts`), not at call time, so what matters is that importing this module's
 * own barrel pulls all three in; this function's body just mirrors the historical call order for
 * anyone diffing against the three-line form.
 *
 * @param options - Forwarded to {@linkcode initOrbit} — the only one of the three calls that takes
 * any.
 */
export function initClientEntry(options: { prefetch?: PrefetchOptions | false } = {}): void {
  hydrateComets()
  hydrateErrorBoundaries()
  initOrbit(options)
}
