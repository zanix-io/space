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
  broadcastSsrModuleChanged,
  SPACE_DEV_SOCKET_ROUTE,
  SpaceDevSocket,
} from './space-dev-socket.ts'
export { ZanixWebSocket } from '@zanix/server'
export type { SocketPrototype } from '@zanix/server'
export { buildDevClientScript } from './dev-client-script.ts'
export type { DevClientScriptOptions } from './dev-client-script.ts'
export { buildFastRefreshPreambleScript } from './dev-fast-refresh-preamble.ts'
export { isDevClientEnabled, setDevClientEnabled } from './dev-client-registry.ts'
export { createDevAssetHandler, looksLikeDevAssetRequest } from './dev-asset-handler.ts'
export { resolveDevCssHrefs } from './dev-css-hrefs.ts'
export {
  getDevImportModule,
  getDevRoutesReloader,
  setDevImportModule,
  setDevRoutesReloader,
} from './dev-engine-registry.ts'
export type { DevImportModule } from './dev-engine-registry.ts'
export { createSpaceDevEngine } from '../bundler/dev-engine.ts'
export type {
  SpaceDevEngine,
  SpaceDevEngineOptions,
  SsrModuleChangedEvent,
  TransformedAsset,
} from '../bundler/dev-engine.ts'
export { spacePlugin } from '../bundler/space-plugin.ts'
export type { SpacePluginOptions } from '../bundler/space-plugin.ts'
