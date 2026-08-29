import type { BootstrapRemoteAppOptions } from '@zanix/app/runtime'
import { setUserBootstrapConfig } from './bootstrap-config-registry.ts'

/**
 * Registers this app's own `bootstrapRemoteApp`/`bootstrapServers` options — a sibling of
 * {@linkcode definePreHandler}, with the exact same timing requirement: call this from a module
 * `space.app.ts` itself imports (directly, or transitively), never ONLY from `mod.ts`. `zanix
 * space dev` never imports `mod.ts` at all (only `space.app.ts`) — an option declared solely in
 * `mod.ts`'s own `bootstrapRemoteApp(spaceApp, { server: {...} })` call is invisible to `zanix
 * space dev`, which builds its own `bootstrapServers` call instead and reads
 * {@linkcode getBootstrapSpaceAppConfig} the same way a production `mod.ts` does, merging it
 * alongside the dev-only wiring (Vite hot-client/asset handling) it must keep exclusive control
 * over for `ssr`/`socket`.
 *
 * Purely additive over what {@linkcode getBootstrapSpaceAppConfig} already defaults on its own
 * (`server.ssr`/`server.rest`, both `{}`) — most apps never need this at all. Reach for it when an
 * app needs something beyond those defaults: a custom `rest` config, `remoteInstances` to announce
 * to the Control Plane, `uses`/`resources` bindings, or a non-default `ssr`/`socket` port.
 *
 * Single-slot, same as {@linkcode definePreHandler} — calling this more than once replaces the
 * previous registration rather than composing with it.
 *
 * @example
 * ```ts
 * // space.app.ts (or any module it imports)
 * import { defineBootstrapSpaceAppConfig } from '@zanix/space'
 *
 * defineBootstrapSpaceAppConfig({
 *   remoteInstances: { endpoint: 'http://my-space:8000' },
 * })
 * ```
 *
 * ```ts
 * // mod.ts — production
 * import { getBootstrapSpaceAppConfig } from '@zanix/space'
 *
 * await bootstrapRemoteApp(spaceApp, getBootstrapSpaceAppConfig())
 * ```
 */
export function defineBootstrapSpaceAppConfig(
  options: BootstrapRemoteAppOptions,
): void {
  setUserBootstrapConfig(options)
}
