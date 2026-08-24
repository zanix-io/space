/// <reference lib="dom" />

/**
 * Which `hydrateComets` implementation Orbit re-hydrates a swapped outlet with.
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
 * implementation — so each barrel pulls exactly one hydrator and nothing else. That is also what
 * makes `clientBarrelGuardPlugin`'s build-time check meaningful: with this in place, React's
 * hydrate module appearing in a Preact client graph can only mean the app imported the wrong
 * barrel.
 *
 * Registration is a module-load side effect of each `hydrate-comets*.ts`, the same shape
 * `render-page-preact.ts` uses for the server-side element factory and for
 * `options.errorBoundaries`.
 *
 * @module
 */

/** The shape both `hydrateComets` implementations already share, verified identical. */
export type CometHydrator = (root?: ParentNode) => void

let hydrator: CometHydrator | undefined

/**
 * Registers the active renderer's `hydrateComets`. Called once, at module load, by whichever of
 * `hydrate-comets.ts` / `hydrate-comets-preact.ts` an app's client barrel pulled in — never by
 * app code.
 *
 * @param implementation - That renderer's own `hydrateComets`.
 */
export function setCometHydrator(implementation: CometHydrator): void {
  hydrator = implementation
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
export function getCometHydrator(): CometHydrator | undefined {
  return hydrator
}
