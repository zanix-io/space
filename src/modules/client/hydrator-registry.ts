/**
 * Which `hydrateComets`/`hydrateErrorBoundaries` implementation Orbit re-hydrates a swapped outlet
 * with.
 *
 * This registry keeps `orbit.ts` genuinely renderer-agnostic. `orbit.ts` is re-exported by BOTH
 * client barrels, including `@zanix/space/client/preact` — if it imported `hydrateComets` directly
 * from `hydrate-comets.ts` (React's implementation), a Preact app would re-hydrate every Comet in a
 * swapped region with React's `hydrateRoot` after every client-side navigation, and pull React's
 * hydrate module into its client graph to do it. Same class of risk as `defineComet` building
 * elements for the wrong renderer: one shared module hardcoding one renderer, with the other
 * renderer silently getting the wrong code path.
 *
 * The registry keeps `orbit.ts` genuinely renderer-free — it imports this module, never either
 * implementation — so each barrel pulls exactly one pair of hydrators and nothing else. That is
 * also what makes `clientBarrelGuardPlugin`'s build-time check meaningful: with this in place,
 * React's hydrate module appearing in a Preact client graph can only mean the app imported the
 * wrong barrel.
 *
 * `hydrateErrorBoundaries` needs this SAME after-swap call for a real reason, not just symmetry
 * with `hydrateComets`: `retryOutlet` (this module's own sibling) re-fetches and swaps a fresh
 * fragment via `swapOutlet` — if that retry ALSO fails, the freshly swapped-in markup carries its
 * OWN new postponed-recovery marker (React) or its OWN new caught-error marker (Preact), and
 * without this call it would sit there un-recovered FOREVER: `hydrateErrorBoundaries()` otherwise
 * only ever runs once, from the client entry, at the very first page load — a real, confirmed
 * regression (a persistently-failing segment's retry silently going blank/inert on its second
 * failure) fixed by registering it here too.
 *
 * Registration is a module-load side effect of each `hydrate-comets*.ts`/
 * `hydrate-error-boundaries*.ts`, the same shape `render-page-preact.ts` uses for the server-side
 * element factory and for `options.errorBoundaries`.
 *
 * @module
 */

/** The shape every hydrator registered here shares, verified identical across both renderers'
 * implementations of each. */
export type SwapHydrator = (root?: ParentNode) => void

let cometHydrator: SwapHydrator | undefined
let errorBoundaryHydrator: SwapHydrator | undefined

/**
 * Registers the active renderer's `hydrateComets`. Called once, at module load, by whichever
 * renderer-specific implementation (`hydrate-comets.ts` for React, its Preact counterpart for the
 * other barrel) an app's client barrel pulled in — never by app code.
 *
 * @param implementation - That renderer's own `hydrateComets`.
 */
export function setCometHydrator(implementation: SwapHydrator): void {
  cometHydrator = implementation
}

/**
 * The registered `hydrateComets`, for Orbit to call after a swap.
 *
 * @returns The active renderer's hydrator, or `undefined` if no barrel was ever imported — in
 * which case Orbit skips re-hydration rather than throwing. That is the correct behaviour, not a
 * silent failure: an app can legitimately use `initOrbit()` on a page with no Comets at all, and
 * both barrels export `initOrbit` and `hydrateComets` together, so any app that has Comets has
 * necessarily registered one.
 */
export function getCometHydrator(): SwapHydrator | undefined {
  return cometHydrator
}

/**
 * Registers the active renderer's `hydrateErrorBoundaries`. Called once, at module load, by
 * whichever renderer-specific implementation (`hydrate-error-boundaries.ts` for React, its Preact
 * counterpart for the other barrel) an app's client barrel pulled in — never by app code. See this
 * module's own doc for why Orbit needs this, not only `setCometHydrator`.
 *
 * @param implementation - That renderer's own `hydrateErrorBoundaries`.
 */
export function setErrorBoundaryHydrator(implementation: SwapHydrator): void {
  errorBoundaryHydrator = implementation
}

/**
 * The registered `hydrateErrorBoundaries`, for Orbit to call after a swap — same `undefined`-safe
 * reasoning as {@linkcode getCometHydrator}.
 */
export function getErrorBoundaryHydrator(): SwapHydrator | undefined {
  return errorBoundaryHydrator
}
