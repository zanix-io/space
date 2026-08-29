import type { BootstrapRemoteAppOptions } from '@zanix/app/runtime'

let userBootstrapConfig: BootstrapRemoteAppOptions | undefined

/** Set once by {@linkcode defineBootstrapSpaceAppConfig} — not called directly. */
export function setUserBootstrapConfig(
  value: BootstrapRemoteAppOptions | undefined,
): void {
  userBootstrapConfig = value
}

/**
 * Read by both a production `mod.ts`'s own `bootstrapRemoteApp(spaceApp,
 * getBootstrapSpaceAppConfig())` call and `zanix space dev`'s own orchestrator (`@zanix/cli`'s
 * `action.ts`), so a consumer's own bootstrap options (registered via
 * {@linkcode defineBootstrapSpaceAppConfig}) apply identically under both — same parity
 * `getUserPreHandler` already established for `preHandler`.
 *
 * Always returns `server.ssr`/`server.rest` — defaulted to `{}` when the registered config didn't
 * set them, never left absent. Every `defineSpaceApp` app needs both, unconditionally: `ssr` to
 * serve the pages it renders, `rest` because `defineSpaceApp` itself always registers `POST
 * /api/log` (see `define-space-app.ts`'s own doc on `createLogApiController`) — a `server` object
 * naming ANY type at all (which a real `mod.ts` always does, since it needs `ssr` at minimum)
 * excludes every unnamed type from being served, `rest` included, regardless of how many routes it
 * has (see `@zanix/server`'s own `bootstrapServers`/`shouldServeType` doc). A caller-registered
 * `server.ssr`/`server.rest` always wins over these bare defaults — this only ever fills a gap,
 * never overrides an explicit choice.
 *
 * Returns a real, defaulted object even when {@linkcode defineBootstrapSpaceAppConfig} was never
 * called — the common case, and exactly the state every `defineSpaceApp` app needs regardless of
 * whether it registers anything of its own.
 */
export function getBootstrapSpaceAppConfig(): BootstrapRemoteAppOptions {
  return {
    ...userBootstrapConfig,
    server: {
      ssr: {},
      rest: {},
      ...userBootstrapConfig?.server,
    },
  }
}

/** Test-only — clears the registered config between tests. Not exported from this package's
 * public entry points. */
export function resetUserBootstrapConfig(): void {
  userBootstrapConfig = undefined
}
