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
 * `renderToResponse`'s `initialState` option. */
export const COMET_PROPS_ATTR = 'data-comet-props'
