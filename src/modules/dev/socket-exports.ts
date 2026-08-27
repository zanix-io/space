/**
 * The narrow slice of `modules/dev/mod.ts`'s own barrel that `.` (this package's root entry point)
 * actually re-exports — `SpaceDevSocket` and its real-time notification helpers — WITHOUT
 * `createSpaceDevEngine`/`spacePlugin` (both live in `../bundler/`, reached only through
 * `modules/dev/mod.ts`'s own full barrel). `spacePlugin`'s own unconditional `@vitejs/plugin-react`/
 * `@preact/preset-vite` dependency (real Fast Refresh for BOTH renderers, regardless of which one an
 * app actually installs) has no business being resolved merely because a production consumer
 * imports `SpaceDevSocket` from `.` — before this file existed, it was, purely as a side effect of
 * `SpaceDevSocket` and `spacePlugin` sharing one barrel file. `./dev` (`modules/dev/mod.ts` itself)
 * still re-exports everything, unchanged, for `zanix space dev`'s own real needs — this file exists
 * only so `.` can reach this one subset of it without the rest.
 *
 * `vite`/`@deno/vite-plugin` remain reachable from here regardless: `SsrModuleChangedEvent` (below)
 * is `broadcastSsrModuleChanged`'s own parameter type, defined in `../bundler/dev-engine.ts`, whose
 * own real value imports resolve like any other file's the moment its type is referenced — the same
 * `import type` reachability rule that applies everywhere else in this package.
 *
 * @module
 */
export {
  broadcastSsrModuleChanged,
  SPACE_DEV_SOCKET_ROUTE,
  SpaceDevSocket,
} from './space-dev-socket.ts'
export { ZanixWebSocket } from '@zanix/server'
export type { SocketPrototype } from '@zanix/server'
export type { SsrModuleChangedEvent } from '../bundler/dev-engine.ts'
