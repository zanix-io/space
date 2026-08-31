import type { PreHandler } from '@zanix/server'
import { setUserPreHandler } from './pre-handler-registry.ts'

/**
 * Registers this app's own `preHandler` — e.g. {@linkcode langPreHandler} — a sibling of
 * {@linkcode defineMiddleware}, with the exact same timing requirement: call this from a module
 * `space.app.ts` itself imports (directly, or transitively through anything `loadRoutes()`
 * reaches), never ONLY from `mod.ts`. `zanix space dev` never imports `mod.ts` at all (only
 * `space.app.ts`) — a `preHandler` declared solely in `mod.ts`'s own `bootstrapRemoteApp({
 * server: { ssr: { preHandler } } })` call is invisible to `zanix space dev`, which boots its own
 * SSR server with its own dev-only `preHandler` (Vite hot-client / dev-asset handling) and no way
 * to reach into a literal passed only to a different entry point's own bootstrap call.
 *
 * `preHandler` is deliberately NOT a `SpaceAppConfig` field (unlike `assetsDir`/`messagesDir`) —
 * see that type's own module doc: population/language identification, and request-pipeline
 * behavior generally, is opted into via this package's own registration functions
 * (`defineMiddleware`/`definePreHandler`), never declared as manifest data. A `preHandler` is
 * executable behavior, not the kind of static, introspectable config `zanix space build` can read
 * without running app code — the same reason `defineMiddleware`'s guards were never a manifest
 * field either.
 *
 * Single-slot, same as the underlying `@zanix/server` `preHandler` option itself
 * (`WebServerManager.create()` only ever accepts one function) — calling this more than once
 * replaces the previous registration rather than composing with it. Compose multiple concerns
 * yourself the same way `@zanix/cli`'s own dev server already does: `(req, info) => a(req, info)
 * ?? b(req, info)`.
 *
 * @example
 * ```ts
 * // space.app.ts (or any module it imports)
 * import { definePreHandler, langPreHandler } from '@zanix/space'
 *
 * definePreHandler(langPreHandler({ availableLangs: ['en', 'es'], defaultLang: 'en' }))
 * ```
 *
 * ```ts
 * // mod.ts — production
 * import { getUserPreHandler } from '@zanix/space'
 *
 * await bootstrapRemoteApp(spaceApp, {
 *   server: { ssr: { preHandler: getUserPreHandler() } },
 * })
 * ```
 */
export function definePreHandler(preHandler: PreHandler): void {
  setUserPreHandler(preHandler)
}
