/**
 * The one constant Orbit's server-side (`SpacePageController`) and client-side (`initOrbit`,
 * `@zanix/space/client`) halves both need — kept in its own dependency-free module so importing it
 * never pulls server-only (`react-dom/server`) or client-only code into the wrong bundle.
 *
 * @module
 */

/** Sent by Orbit's client runtime on every intercepted navigation — a page's own `handleGet`
 * checks for this to decide whether to render the full document or just the fragment Orbit swaps
 * into the DOM. Never something an app author sets by hand.
 *
 * `X-Znx-`-prefixed, same as every other framework-owned header/cookie across the Zanix
 * ecosystem (`X-Znx-Authorization`, `X-Znx-Admin-Protocol`, ...) — keeps a request header this
 * package invents from colliding with a third-party proxy/CDN header of the same name. */
export const ORBIT_FRAGMENT_HEADER = 'X-Znx-Space-Navigate'

/**
 * Marks the DOM element Orbit swaps on navigation — everything *inside* the root layout (nested
 * layouts, `loading`/`error` boundaries, the page itself), but never the root layout's own markup
 * around it (a header/footer/nav there stays untouched, never re-fetched or re-rendered). Written
 * by every page's own composed tree, read by Orbit's client runtime to find its swap target.
 */
export const ORBIT_OUTLET_ATTR = 'data-space-outlet'
