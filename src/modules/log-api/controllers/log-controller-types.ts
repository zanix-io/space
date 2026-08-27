/**
 * Pure data-shape types for `createLogApiController` — `LogApiControllerOptions`/
 * `LogApiRateLimitOptions` — deliberately split from `log.controller.ts` itself, which
 * unconditionally value-imports `@zanix/server`'s own decorators, `@zanix/logger`, and
 * `./rtos/log.rto.ts` (a real, decorator-using class) to build the real controller. References only
 * `@zanix/server`'s own `MiddlewareGuard` type, so a consumer that only needs to type an options
 * object — e.g. `typings/manifest.ts`'s own `SpaceAppConfig.logApi` — never resolves any of that
 * merely by reading this file. This matters specifically because `SpaceAppConfig` is reachable from
 * the root `.` entry point's own barrel, the same barrel every Comet imports (for `defineComet`):
 * an `import type` of `LogApiControllerOptions` still forces resolving the real value imports of
 * whichever file declares it, so keeping the declaration here — never in `log.controller.ts`
 * itself — is what keeps `@zanix/logger` and `@zanix/utils`'s own `WorkerManager` out of every
 * `@zanix/space` app's CLIENT bundle, and Vite's own `worker-import-meta-url` plugin off a worker
 * pattern that has no business being reachable from browser code at all.
 * Re-exported unchanged from `log.controller.ts`, so switching that import site between "the real
 * file" and "this types file" is never a breaking change in either direction.
 *
 * @module
 */

import type { MiddlewareGuard } from '@zanix/server'

/**
 * Overrides for this endpoint's own default `rateLimitGuard` — every field optional, falling back
 * to the current defaults (`LOG_API_RATE_LIMIT_ANONYMOUS_LIMIT`/`LOG_API_RATE_LIMIT_WINDOW_SECONDS`/
 * `trustProxyHeader: true`) when omitted. See `log.controller.ts`'s own doc for the full contract.
 */
export interface LogApiRateLimitOptions {
  /** Requests-per-window budget for a single anonymous caller. @default 30 */
  anonymousLimit?: number
  /** Window length, in seconds, {@linkcode anonymousLimit} is counted over. @default 60 */
  windowSeconds?: number
  /** `true` keys each anonymous caller's own bucket off its resolved client IP+User-Agent (only
   * safe behind a trusted proxy that overwrites IP headers); `false` shares ONE bucket across
   * every anonymous caller instead. @default true */
  trustProxyHeader?: boolean
}

/** Options for `createLogApiController`. See `log.controller.ts`'s own doc for the full contract
 * behind each field. */
export interface LogApiControllerOptions {
  /** Route prefix, e.g. `'api'` (default) for `POST /api/log`. */
  prefix?: string
  /** Overrides the default `rateLimitGuard`'s own `anonymousLimit`/`windowSeconds`/
   * `trustProxyHeader` — see {@linkcode LogApiRateLimitOptions}'s own doc. */
  rateLimit?: LogApiRateLimitOptions
  /** Extra guards, run AFTER this endpoint's own default `rateLimitGuard` — APPENDED, never
   * replacing it. */
  guards?: MiddlewareGuard[]
}
