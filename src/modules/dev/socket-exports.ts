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
 * `SsrModuleChangedEvent` (below) is `broadcastSsrModuleChanged`'s own parameter type, sourced from
 * `../bundler/dev-engine-types.ts` — a dedicated, dependency-free file split out of
 * `../bundler/dev-engine.ts` specifically so resolving this type never also resolves that file's
 * own real `vite`/`@deno/vite-plugin` value imports (see that file's own doc for the full
 * reasoning; this used to be a real, confirmed leak from `.` before the split).
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
export type { SsrModuleChangedEvent } from '../bundler/dev-engine-types.ts'
