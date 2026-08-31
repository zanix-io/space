import type { PreHandler } from '@zanix/server'

let userPreHandler: PreHandler | undefined

/** Set once by {@linkcode definePreHandler} — not called directly. */
export function setUserPreHandler(value: PreHandler | undefined): void {
  userPreHandler = value
}

/** Read by both `@zanix/cli`'s `zanix space dev` (composed AFTER its own dev-only preHandler —
 * Vite hot-client / dev-asset handling always wins first) and a production `mod.ts`'s own
 * `bootstrapServers`/`bootstrapRemoteApp` call, so a consumer's own `preHandler` (e.g.
 * `langPreHandler`) runs identically under both. `undefined` when `definePreHandler` was never
 * called — the common case, and a real "no preHandler" state, not an empty function. */
export function getUserPreHandler(): PreHandler | undefined {
  return userPreHandler
}

/** Test-only — clears the registered preHandler between tests. Not exported from this package's
 * public entry points. */
export function resetUserPreHandler(): void {
  userPreHandler = undefined
}
