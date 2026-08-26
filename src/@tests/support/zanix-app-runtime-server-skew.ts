/**
 * `ignore` flag for every test that combines `@zanix/app/runtime`'s `activateApps`/
 * `deactivateApps` with this package's own `@zanix/server`-decorated routes/controllers and a real
 * `bootstrapServers()`/`webServerManager` call (or with more than one `activateApps` cycle in the
 * same process).
 *
 * Root cause, confirmed 2026-08-26 by reproducing `define-space-app-log-api-guards.test.tsx`'s
 * first test IN ISOLATION (fails with "the server should have been started" on its own, so this is
 * not cross-test leakage): the published `@zanix/app@0.2.0`'s `runtime.ts`/`app-container.ts`
 * still imports `jsr:@zanix/server@^3.0.0` internally — `registerApp` opens its
 * `ProgramModule.defineApplication` scope against THAT v3 module instance. This package's own
 * `deno.jsonc` pins the main `@zanix/server` alias (and every `@zanix/utils`-derived one) to
 * `^4.0.0`, so every route/controller this package decorates (`log.controller.ts`,
 * `page-decorator.ts`, the assets-api controllers, ...) registers into the COMPLETELY SEPARATE
 * v4 `ProgramModule`/`RouteContainer`/webserver registry. Two concrete symptoms follow from the
 * same split:
 * - `bootstrapServers()` (v4) never finds the Application `activateApps` (v3) just created, so it
 *   returns no server id (`assert(serverId, ...)` fails).
 * - `deactivateApps()` (v3) cannot clear routes that were actually registered in the v4
 *   `RouteContainer`, so a second `activateApps` cycle in the same process (or a second
 *   `Deno.test` in the same file) collides with the first's leftover registration
 *   (`InternalError: Route path "..." is already defined`).
 *
 * There is no published fix today: `@zanix/app`'s only released versions (`0.1.0`, `0.2.0`) both
 * depend on `@zanix/server@^3.0.0`; a checkout already migrated to `@zanix/server@^4.0.0` exists
 * but is unreleased. This is the same blocker class already documented for `@zanix/admin`'s and
 * `@zanix/app`'s own dependents ("blocked on `@zanix/app@0.2.0`").
 *
 * Un-ignore every test importing this flag, and delete this file, once a published `@zanix/app`
 * version's `/runtime` subpath depends on `@zanix/server@^4.0.0`.
 */
export const ZANIX_APP_RUNTIME_SERVER_SKEW_BLOCKED = true
