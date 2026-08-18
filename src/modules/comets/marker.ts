/**
 * The `data-*` attributes a Comet boundary carries in its rendered HTML — the wire protocol
 * between `defineComet` (writes them, server-side) and `hydrateComets` (reads them, client-side).
 * Kept as one shared source of truth so the two sides can never drift out of sync with each other.
 *
 * @module
 */

/** Identifies this Comet's own type — its own source `import.meta.url`, shared by every instance
 * of the same `defineComet`-wrapped component (not a per-render-instance id; hydration never
 * depends on it being unique). */
export const COMET_ID_ATTR = 'data-comet'
/** The `CometStrategy` this instance hydrates with. */
export const COMET_STRATEGY_ATTR = 'data-comet-strategy'
/** The media query `comet="media"` waits on, if any. */
export const COMET_MEDIA_ATTR = 'data-comet-media'
/** The client-importable module URL `hydrateComets` dynamically imports to hydrate this boundary —
 * resolved from the comet's own source location via `resolveCometModuleUrl`, never the raw source
 * path itself. */
export const COMET_MODULE_ATTR = 'data-comet-module'
/** Which export of that module is the component — `defineComet` computes this from the
 * component's own `.name`, never author-supplied. */
export const COMET_EXPORT_ATTR = 'data-comet-export'
/** This instance's own props, JSON-serialized — must be JSON-serializable, same constraint as
 * `renderToResponse`'s `initialState` option. When an app opts into
 * `defineSpaceApp({ serialization: { extendedTypes: true } })` this carries a versioned envelope
 * instead of bare JSON, so `Date`/`Map`/`Set` survive; see `serialization-codec.ts`. Read back in
 * THREE places, not two — both hydrate modules and `comet-persistence.ts`'s own
 * `reuseRetainedComets`. */
export const COMET_PROPS_ATTR = 'data-comet-props'
/** The author-supplied `persist` key (see `CometProps.persist`'s own doc) — present only when a
 * call site opted in. Read by `swapOutlet` (`orbit.ts`) to decide whether an outgoing boundary
 * should be retained instead of discarded, and to match it back up against an incoming one. */
export const COMET_PERSIST_ATTR = 'data-orbit-persist'
/** Set, transiently, on a boundary node the moment `comet-persistence.ts` splices a retained
 * instance back into a freshly-parsed fragment, in place of its own fresh placeholder — read once
 * by `hydrateComets`'s own boundary loop to skip a fresh `hydrateRoot`/`hydrate` call for a node
 * that was already updated via the retained instance's own renderer-native `.render()` call, then
 * immediately removed so it never lingers as real markup. Never present in server-rendered HTML;
 * a purely client-side, single-pass bookkeeping detail. */
export const COMET_REUSED_ATTR = 'data-orbit-reused'
