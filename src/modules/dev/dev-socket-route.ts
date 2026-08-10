/**
 * Reserved WebSocket route for `SpaceDevSocket` — chosen to never collide with a real page route,
 * which (unanchored `'ssr'`, the default) resolve at bare paths like `/products/1`.
 *
 * Deliberately its own file, with no other export: `@Socket`-decorated classes register a route
 * as a side effect of being imported at all — anything that only needs this string (like
 * `dev-client-script.ts`, generating a browser-side connection URL) must never accidentally pull
 * `SpaceDevSocket` itself in and register a socket route in every process that touches it,
 * regardless of whether a dev-server is actually running.
 */
export const SPACE_DEV_SOCKET_ROUTE = '__zanix_space_dev__'
