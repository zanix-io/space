/**
 * Rebuilds a plain `Error` from a message/stack pair that crossed the server → client boundary as
 * two strings — the one piece of logic identical between `hydrate-error-boundaries.ts` (React) and
 * `hydrate-error-boundaries-preact.ts`: neither renderer's SSR pass ever serializes the ORIGINAL
 * thrown value itself (an arbitrary `unknown` an app's own code threw is not guaranteed
 * JSON-serializable, and React's own postponed-recovery `<template>` never carries anything BUT the
 * two strings this function takes), so both hydrators reconstruct the same kind of approximation
 * from the same two primitives, via the same rule — kept here once so the approximation's exact
 * shape can never drift between the two.
 *
 * No renderer import of any kind (not even a type) — this module is safe to import from BOTH
 * `hydrate-error-boundaries.ts` and `hydrate-error-boundaries-preact.ts`, which otherwise never
 * share a single line of implementation (see the client barrel parity test for why that separation
 * matters).
 *
 * @param message - The error's own `message` — `null` only for a boundary this package's own
 * marker attributes were never actually populated for (defensive; `hydrateErrorBoundaries` never
 * calls this without one). `Element.getAttribute`'s own contract, not `undefined`: both call sites
 * pass this straight through from a `getAttribute()` read (or a value derived from one).
 * @param stack - The error's own `stack`, if known. `null` when it isn't — same
 * `Element.getAttribute` contract as `message`. Left unset on the reconstructed `Error` otherwise,
 * same as any `Error` a stack trace was never captured for.
 */
export function reconstructError(message: string | null, stack: string | null): Error {
  const error = new Error(message ?? 'Unknown error')
  if (stack) error.stack = stack
  return error
}
