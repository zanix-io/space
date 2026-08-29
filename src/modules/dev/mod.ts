/**
 * Dev-server module — the public, stable boundary between `@zanix/space`'s own dev-mode internals
 * (the Vite-backed engine, the real-time notification channel, the browser-asset transform
 * pipeline) and an external consumer like `@zanix/cli`'s `zanix space dev` command. This BARREL
 * (`modules/dev/mod.ts`) is never imported by `modules/render/`/`modules/router/` (the production
 * request path) — `SpaceDevSocket`'s own `@Socket` decorator runs a real, process-wide
 * route-registration side effect at import time, which a production render path must never trigger
 * just by existing. A handful of individually audited, side-effect-free files under this same
 * directory ARE imported directly by `modules/render/`/`modules/router/`/`modules/runtime/` (never
 * through this barrel) — `dev-client-registry.ts`, `dev-client-script.ts`, `dev-css-hrefs.ts`,
 * `dev-engine-registry.ts`, `dev-fast-refresh-preamble.ts` — each confirmed to carry no
 * decorator/registration side effect of its own before being relied on there.
 *
 * `dev-vite-hot-client.ts` joins the individually-audited, side-effect-free list above as of
 * real Fast Refresh/Prefresh delivery: it's imported directly by
 * `render-to-response-preact.ts` for its own exported string-builder, and is otherwise only ever
 * reached by a dev-server orchestrator wanting `createViteHotClientHandler`'s own
 * `(req) => Response | null` — same composition role as `createDevAssetHandler`, tried before it.
 * Despite the earlier, renderer-specific name this module had before being corrected, it is NOT
 * Preact-only — see that module's own doc for the real transform evidence that React's own
 * `oxc.jsx`-based refresh transform needs `/@vite/client` exactly as much as Preact's `@prefresh/vite`
 * does.
 *
 * `createSpaceDevEngine`/`spacePlugin` are re-exported from their own individual files
 * (`../bundler/dev-engine.ts`/`../bundler/space-plugin.ts`), NEVER via `../bundler/mod.ts` (the
 * `./vite` entry point) — that barrel also re-exports `cssPlugin`, whose own top-level `import
 * tailwindcss from '@tailwindcss/vite'` eagerly pulls in a native Lightning CSS binding that fails
 * to resolve under Deno (confirmed via `deno info --json`: importing `../bundler/mod.ts` reaches
 * `@tailwindcss/vite`/`@vanilla-extract/vite-plugin`/`lightningcss`; importing this file does not).
 * `spacePlugin`'s own `@vitejs/plugin-react` dependency (real React Fast Refresh for the `client`
 * environment) stays inside this boundary — confirmed via the same timed-import check that it pulls
 * in none of those heavy packages either; it composes Rolldown's own native `oxc.jsx` transform
 * rather than a separate Babel toolchain, so it carries no native binary of its own.
 * An external package like `@zanix/cli` can only ever reach this package through its own declared
 * `exports` map (`.`, `./vite`, `./client`, `./testing`, `./dev`) — unlike this same package's own
 * test suite, it has no business (and no supported way) reaching into a non-exported internal file
 * path, so this boundary being genuinely safe to import, on its own, is what makes `./dev` usable
 * as `zanix space dev`'s one dependency on `@zanix/space` for the engine itself.
 *
 * @module
 */
export {
  broadcastClientCssChanged,
  broadcastClientModuleChanged,
  /** Notifies every connected dev client that Vite's own dependency optimizer needs a full
   * reload — relays a real Vite-internal signal this engine would otherwise never bind. */
  broadcastFullReloadNeeded,
  /** Notifies every connected dev client of an `ssr`-environment module change. */
  broadcastSsrModuleChanged,
  /** Reserved WebSocket route `SpaceDevSocket` registers — never collides with a real page
   * route. */
  SPACE_DEV_SOCKET_ROUTE,
  /** The dev-time WebSocket channel real-time notifications (CSS/module changes) travel over. */
  SpaceDevSocket,
} from './space-dev-socket.ts'
export {
  /** `@zanix/server`'s own base WebSocket class `SpaceDevSocket` extends. */
  ZanixWebSocket,
} from '@zanix/server'
export type {
  /** `@zanix/server`'s own shape for a `@Socket`-decorated class instance. */
  SocketPrototype,
} from '@zanix/server'
export { buildDevClientScript } from './dev-client-script.ts'
export type {
  /** Options for {@linkcode buildDevClientScript}. */
  DevClientScriptOptions,
} from './dev-client-script.ts'
export { buildFastRefreshPreambleScript } from './dev-fast-refresh-preamble.ts'
export {
  buildViteHotClientScript,
  createViteHotClientHandler,
  looksLikeViteHotClientRequest,
  VITE_CLIENT_REQUEST_PATH,
} from './dev-vite-hot-client.ts'
export { isDevClientEnabled, setDevClientEnabled } from './dev-client-registry.ts'
export { createDevAssetHandler, looksLikeDevAssetRequest } from './dev-asset-handler.ts'
// Re-exported here (not just from the main barrel) so `zanix space dev`'s own orchestrator can
// read a consumer's `definePreHandler(...)` registration alongside its other dev-only imports —
// see `getUserPreHandler`'s own doc for why this is what makes dev/prod `preHandler` parity work.
export { getUserPreHandler } from '../middleware/pre-handler-registry.ts'
// Same reasoning as `getUserPreHandler` above, for `defineBootstrapSpaceAppConfig` instead — see
// `getBootstrapSpaceAppConfig`'s own doc for why `zanix space dev` needs this reachable here too,
// not only from the main barrel a production `mod.ts` imports.
export { getBootstrapSpaceAppConfig } from '../runtime/bootstrap-config-registry.ts'
export type { BootstrapRemoteAppOptions } from '@zanix/app/runtime'
export { resolveDevCssHrefs } from './dev-css-hrefs.ts'
export {
  getDevImportModule,
  getDevRoutesReloader,
  setDevImportModule,
  setDevRoutesReloader,
} from './dev-engine-registry.ts'
export type { DevImportModule } from './dev-engine-registry.ts'
export {
  /** Builds the Vite-backed dev engine `zanix space dev` runs on. */
  createSpaceDevEngine,
} from '../bundler/dev-engine.ts'
export type {
  /** What {@linkcode createSpaceDevEngine} returns. */
  SpaceDevEngine,
  /** Options for {@linkcode createSpaceDevEngine}. */
  SpaceDevEngineOptions,
  /** Reported once per file change that affects the `ssr` environment's module graph. */
  SsrModuleChangedEvent,
  /** The browser-ready counterpart of what `ssrLoadModule` produces for the server side. */
  TransformedAsset,
} from '../bundler/dev-engine.ts'
export {
  /** Wires this app's CSS/Comet/React-Compiler pipeline into Vite. */
  spacePlugin,
} from '../bundler/space-plugin.ts'
export type {
  /** Options for {@linkcode spacePlugin}. */
  SpacePluginOptions,
} from '../bundler/space-plugin.ts'
export {
  /** Wires the default, zero-config client entry (`hydrateComets()`/`initOrbit()`, correctly
   * `nonce`'d) into a dev session — needed here since `render-page-react.tsx`/
   * `render-page-preact.ts` always request its own virtual id in dev, unless
   * `SpaceAppConfig.clientEntry` configured a real override. */
  clientEntryPlugin,
} from '../bundler/client-entry-plugin.ts'
export type {
  /** Options for {@linkcode clientEntryPlugin}. */
  ClientEntryPluginOptions,
} from '../bundler/client-entry-plugin.ts'
export {
  /** Reads back which renderer this app was configured for. */
  getActiveRenderer,
} from '../router/active-renderer.ts'
export type {
  /** Which renderer implementation an app installed — `'react'` or `'preact'`. */
  RendererKind,
} from '../router/active-renderer.ts'
// Re-exported for `zanix space dev`'s render probe, which reads the ACTIVE renderer here and hands
// it to the probe. The probe deliberately does not import the registry itself: that edge made
