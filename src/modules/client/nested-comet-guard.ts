import { COMET_ID_ATTR } from '../comets/marker.ts'

/**
 * Whether `boundary` sits inside ANOTHER Comet boundary — i.e. an app composed one `defineComet`
 * component directly inside another's own rendered content. Shared, renderer-agnostic (pure DOM
 * traversal, no React/Preact API), reused by both `hydrateComets` implementations — one per
 * renderer, each its own file — same reasoning `marker.ts` itself is already shared unmodified
 * between the two.
 *
 * A nested boundary must never get its OWN, independent `hydrateRoot`/`hydrate` call: the OUTER
 * boundary's own hydration already reaches it — `Component` (whatever `defineComet` wraps) is a
 * plain, statically-imported function, never lazy-loaded until `hydrateComets`'s own dynamic
 * `import()` runs, so if the outer Comet's own rendered tree includes an inner `<InnerComet/>`,
 * hydrating the OUTER already mounts the INNER's real content too, transitively, as part of the
 * SAME tree. A second, independent `hydrateRoot`/`hydrate` call on that same, already-hydrated DOM
 * node is a real, reproduced conflict — confirmed directly: React throws a hydration-mismatch
 * error, and Preact fights its own already-live reconciliation state on the node. Skipping it here
 * is the fix, not a workaround for something React/Preact themselves are expected to tolerate.
 *
 * One accepted, documented consequence: a nested Comet's own `comet` strategy (`'visible'`,
 * `'media'`, ...) is never independently honored — it hydrates whenever its OUTER ancestor does,
 * same as any other part of that ancestor's own rendered tree. Composing Comets this way is
 * unusual enough (this package's own catalog never does it) that this is a reasonable limitation,
 * not a regression from a real, previously-working case.
 *
 * @param boundary - A Comet boundary about to be scheduled for hydration.
 */
export function isNestedComet(boundary: Element): boolean {
  const ancestor = boundary.parentElement?.closest(`[${COMET_ID_ATTR}]`)
  return ancestor !== null && ancestor !== undefined
}
