/**
 * Log Application/HTTP API — `POST /api/log`, the backend relay for a browser client's own
 * `@zanix/logger/client` logger (see `modules/client/client-logger.ts`).
 *
 * Always registered as part of `defineSpaceApp`'s own `setup(ctx)` — see that module's own doc for
 * why registration itself isn't an opt-in `SpaceAppConfig` field the way `modules/assets-api/`'s own
 * `assetsApi` option is. This route DOES have a real, author-facing configuration surface though —
 * `SpaceAppConfig.logApi.guards` for appending extra guards after this endpoint's own mandatory
 * default `rateLimitGuard`, and `SpaceAppConfig.logApi.rateLimit` for overriding that default
 * guard's own `anonymousLimit`/`windowSeconds`/`trustProxyHeader` outright (see
 * `createLogApiController`'s own doc for the full contract, and why these are two DIFFERENT knobs —
 * one tightens, the other changes the floor itself); there just isn't a way to turn the route
 * itself off. Not re-exported from the package's root `mod.ts` (same as `modules/assets-api/`) — an
 * app configures it declaratively through `defineSpaceApp({ logApi })`, it never needs to import
 * anything from this module directly.
 *
 * @module
 */
export { createLogApiController } from './controllers/log.controller.ts'
export type {
  LogApiControllerInstance,
  LogApiControllerOptions,
  LogApiRateLimitOptions,
} from './controllers/log.controller.ts'
export { LOGGER_METHODS, LogIngestRTO } from './controllers/rtos/log.rto.ts'
