/**
 * The HTTP surface for the Log API — a single relay route, `POST /api/log`, that lets a browser
 * client's own `@zanix/logger/client` (`createClientLogger`, wired in
 * `modules/client/client-logger.ts`) persist through the SAME backend the server's own `@zanix/logger`
 * instance is already configured with, per `@zanix/utils`'s own documented `Logger#ingest` contract
 * (`docs/logger.md` §7). Never touches storage/redaction/formatting directly — `Logger#ingest`
 * already runs the server's own full pipeline (redact, print, persist) on the relayed data.
 *
 * Deliberately no full auth (`@AuthTokenValidation`/session requirement) — a genuinely public,
 * unauthenticated route, the same category `modules/seo/sitemap.ts`/`modules/seo/robots.ts` already
 * establish (`ZanixSsrController`, no guard at all): the whole point of this endpoint is accepting a
 * POST from any anonymous browser tab that ever loaded this app's client bundle, which by definition
 * has no auth context to gate on. This still differs from `modules/assets-api/controllers/
 * assets.controller.ts`'s own deny-by-default posture (ITS routes do expensive, abusable work —
 * spawning `ffmpeg`, consuming storage — that must stay off until an integrator opts in): this
 * endpoint's own mitigations are real but different in kind — `@zanix/server`'s own global 1 MiB
 * body-size cap (applies to every request, no code needed here) plus a default, mandatory
 * `rateLimitGuard` (see {@linkcode createLogApiController}'s own doc below) bound its worst case
 * (log spam/storage write amplification from one anonymous origin) without requiring a session.
 * `rateLimitGuard`'s own anonymous mode doesn't authenticate anyone — it only bounds anonymous
 * traffic — so this route is still genuinely anonymous, not "now authenticated" in any sense.
 *
 * `ZanixController`, not `ZanixSsrController` — this is a genuine JSON REST endpoint (a validated
 * body in, a small JSON ack out), the same shape `assets.controller.ts` uses, not a byte/text
 * route.
 *
 * `@zanix/auth` (`rateLimitGuard`) is reached through a DELIBERATELY non-literal, fully-qualified
 * `jsr:` `import()` specifier, INSIDE {@linkcode resolveDefaultGuard} — never a top-level `import`,
 * and never `typeof import('@zanix/auth')` for its type either (see {@link AuthExports}'s own
 * doc). Confirmed real, not theoretical: `@zanix/auth`'s own real dependency on `@zanix/datamaster`
 * (for THIS guard's Redis-backed rate-limit counters) used to drag `mongoose`/`mongodb`/`bson`/
 * `redis`/`@redis/*` into the module graph of every `@zanix/space` app's build, whether or not it
 * ever used the Log API's rate limiting — same root cause `zanix-io/app`'s own `activateApps` had
 * (a bare alias declared in `deno.jsonc`'s own `imports` is, on its own, enough to trigger
 * `nodeModulesDir: "auto"`-style npm-install materialization, independent of whether reachable code
 * ever imports it) — see `deno.jsonc`'s own doc comment at the spot `@zanix/auth` used to be
 * declared. The real guard is constructed on its first genuine invocation (a real `POST /api/log`
 * request), memoized per `createLogApiController` call, never at controller-construction time —
 * `createLogApiController` itself stays fully synchronous either way.
 *
 * @module
 */

import type { GuardResponse, HandlerContext, MiddlewareGuard } from '@zanix/server'
import { Controller, Guard, Post, ZanixController } from '@zanix/server'
import { InternalError } from '@zanix/errors'
import logger from '@zanix/logger'
import { LogIngestRTO } from './rtos/log.rto.ts'
import type { LogApiControllerOptions, LogApiRateLimitOptions } from './log-controller-types.ts'

export type { LogApiControllerOptions, LogApiRateLimitOptions }

/** Fully-qualified, deliberately non-literal `jsr:` specifier for `@zanix/auth` — see
 * {@linkcode resolveDefaultGuard}'s own doc for why this package is reached this way instead of a
 * normal top-level `import`. Kept in sync with `deno.jsonc`'s own doc comment at the spot
 * `@zanix/auth` used to be declared. */
const AUTH_SPECIFIER = 'jsr:@zanix/auth@^0.8.0'

/** Narrow, hand-declared shape for exactly the one `@zanix/auth` export this module calls —
 * deliberately NOT `typeof import('@zanix/auth')`, which would force resolving that package's
 * entire export surface (and its own real `@zanix/datamaster` dependency, which itself pulls
 * `mongoose`/`redis`) for type-checking alone, even though `rateLimitGuard` is the only thing
 * used here. */
interface AuthExports {
  rateLimitGuard: (
    options?: {
      app?: string
      windowSeconds?: number
      anonymousLimit?: number | false
      trustProxyHeader?: boolean
      trustedHeaders?: string[]
    },
  ) => MiddlewareGuard
}

/**
 * The rate-limit window this endpoint's own default guard counts requests over. Kept small and
 * local to this module (not the shared `RATE_LIMIT_WINDOW_SECONDS` env var default some OTHER
 * `rateLimitGuard` usage in this process might rely on) — nothing here overrides that env var, this
 * just documents the window the constant below is actually budgeted against.
 */
const LOG_API_RATE_LIMIT_WINDOW_SECONDS = 60

/**
 * A single anonymous browser tab's own budget for `POST /api/log` calls per
 * {@linkcode LOG_API_RATE_LIMIT_WINDOW_SECONDS}-second window — deliberately conservative ("poco
 * límite" — a low limit is the explicit product decision here), grounded in what a genuinely human,
 * one-tab caller actually needs: page-load telemetry plus the occasional warn/error burst a normal
 * session produces, comfortably under a couple of requests per second even during a bad UI bug. 30
 * requests/minute is generous enough that a real human session never notices it, while still capping
 * a runaway client-side retry loop (or a deliberately abusive caller) well short of meaningful
 * storage write amplification — an order of magnitude below `rateLimitGuard`'s own general-purpose
 * default (100/window), which is sized for a broader mix of anonymous API traffic this endpoint
 * doesn't have.
 */
const LOG_API_RATE_LIMIT_ANONYMOUS_LIMIT = 30

/**
 * The instance shape {@link createLogApiController} builds.
 */
export interface LogApiControllerInstance extends ZanixController {
  /** `POST /api/log` — relays one already-formatted browser log entry into the server's own
   * `Logger#ingest`. */
  ingest(ctx: HandlerContext<{ body: LogIngestRTO }>): Promise<Record<string, unknown>>
}

/**
 * `rateLimitGuard` needs a real `'cache'` core provider registered in this process (see
 * `checkRateLimit`, `@zanix/auth/src/utils/sessions/rate-limit.ts`) — in this ecosystem that's
 * normally provided by `import '@zanix/datamaster/core'` (or any other package that registers the
 * `'cache'` slot) somewhere in the HOST APPLICATION's own bootstrap, exactly the same expectation
 * `@zanix/admin`'s own hub composition already documents for `rateLimitGuard`/`AuthTokenValidation`
 * ("the session/auth infra ... need" `@zanix/datamaster/core`'s "zero-config connector/provider
 * wiring"). `@zanix/space` deliberately never imports `@zanix/datamaster` itself (see
 * `modules/assets-api/mod.ts`'s own doc, enforced by a real dependency-boundary test) — so THIS
 * package cannot register that provider on an app's behalf without violating that boundary for
 * every app, not just ones using this route.
 *
 * Confirmed empirically: with no `'cache'` provider registered, `rateLimitGuard(...)` itself
 * throws a real `InternalError` (`meta.slot === 'cache'`, `meta.kind === 'provider'`) the moment a
 * request reaches it. Since this guard is now MANDATORY on every `@zanix/space` app's `/api/log`
 * (see this module's own top-level doc), a hard failure here would silently turn every relayed
 * browser log into a `500` for any app that hasn't separately wired a cache provider — a strictly
 * worse regression than "no rate limiting" and a direct violation of this route's own "always
 * works, no infrastructure to compose" contract. This wrapper narrowly catches ONLY that specific
 * missing-provider condition (never a different, genuine bug inside the real rate-limit check) and
 * fails OPEN — logs a `warn` once per occurrence and lets the request through unthrottled — so
 * `/api/log` keeps working exactly as it did before this default existed for an app that hasn't
 * registered a cache provider, while an app that HAS one (any real production app composing
 * `@zanix/datamaster/core`, directly or via another package that does) gets the real, enforced
 * limit with zero extra configuration, matching this option's own "mandatory by default" intent.
 */
async function runDefaultRateLimitGuard(
  guard: MiddlewareGuard,
  context: Parameters<MiddlewareGuard>[0],
  args: unknown[],
): Promise<GuardResponse> {
  try {
    return await guard(context, ...args)
  } catch (error) {
    const isMissingCacheProvider = error instanceof InternalError &&
      error.meta?.kind === 'provider' &&
      error.meta?.slot === 'cache'
    if (!isMissingCacheProvider) throw error

    logger.warn(
      "POST /api/log's default rateLimitGuard could not run — no 'cache' core provider is " +
        "registered in this process (import '@zanix/datamaster/core', or any other package that " +
        "registers the cache slot, in this app's own bootstrap to enable it). Falling back to " +
        'unthrottled for this request rather than failing the whole relay.',
      { cause: error },
    )
    return {}
  }
}

/**
 * Builds (once, lazily, memoized) the real `rateLimitGuard` this endpoint's default guard wraps —
 * never at `combineGuards`-call time, only on this guard's first genuine invocation (a real
 * `POST /api/log` request reaching it). Promise-memoized, not value-memoized, so two concurrent
 * first requests racing before the import settles still resolve to the exact same guard instance,
 * never construct/import twice — same reasoning `ResourceRegistry.resolve()` already documents for
 * the identical shape of race in `@zanix/app`. Scoped to ONE {@link combineGuards} call (a plain
 * closure variable, never module-level) so two `createLogApiController()` instances with different
 * `rateLimit` overrides never share a memoized guard built from the wrong options.
 */
function createDefaultGuardResolver(
  rateLimitOptions: LogApiRateLimitOptions | undefined,
): () => Promise<MiddlewareGuard> {
  const {
    windowSeconds = LOG_API_RATE_LIMIT_WINDOW_SECONDS,
    anonymousLimit = LOG_API_RATE_LIMIT_ANONYMOUS_LIMIT,
    // Explicit `true` default, not left to `rateLimitGuard`'s own throw-if-undecided behavior:
    // this is a genuinely public, browser-facing route, so a per-caller (IP+User-Agent hashed)
    // bucket is what "reasonable for a human" actually requires — `false` would put every
    // anonymous visitor on ONE shared bucket process-wide, which a single busy (or misbehaving)
    // tab could exhaust for every other real user. The trade-off `auth-network-security` warns
    // about for `ipAllowlistGuard` (a spoofed proxy header bypassing a SECURITY control) doesn't
    // carry the same weight here — worst case for a spoofed/absent proxy is an evadable THROTTLE
    // on a low-value relay endpoint, not an authorization bypass — but see
    // `LogApiRateLimitOptions.trustProxyHeader`'s own doc for why an app that knows it ISN'T
    // behind a trusted proxy can still opt out of this default explicitly.
    trustProxyHeader = true,
  } = rateLimitOptions ?? {}

  let guardPromise: Promise<MiddlewareGuard> | undefined
  return () => {
    if (!guardPromise) {
      guardPromise = import(AUTH_SPECIFIER).then(({ rateLimitGuard }: AuthExports) =>
        rateLimitGuard({ windowSeconds, anonymousLimit, trustProxyHeader })
      )
    }
    return guardPromise
  }
}

/** Combines this endpoint's own mandatory default guard with any integrator-provided extras from
 * {@linkcode LogApiControllerOptions.guards} — runs each in order, short-circuiting on the first
 * denial. See that option's own doc for why the default is never dropped, unlike
 * `createAssetsController`'s own `combineGuards`.
 * @param rateLimitOptions - See {@link LogApiRateLimitOptions} — every field falls back to this
 * endpoint's own current default when omitted. */
function combineGuards(
  extraGuards: MiddlewareGuard[] | undefined,
  rateLimitOptions: LogApiRateLimitOptions | undefined,
): MiddlewareGuard {
  const resolveDefaultGuard = createDefaultGuardResolver(rateLimitOptions)
  const list: MiddlewareGuard[] = [
    async (context, ...args) =>
      await runDefaultRateLimitGuard(await resolveDefaultGuard(), context, args),
    ...(extraGuards ?? []),
  ]
  return async (context, ...args) => {
    for (const guard of list) {
      // deno-lint-ignore no-await-in-loop
      const result = await guard(context, ...args)
      if (result.response) return result
    }
    return {}
  }
}

/**
 * Builds the Log API's own controller. A factory rather than a plain class — same reasoning
 * `createAssetsController`'s own doc gives (`@Controller`'s `prefix` is decorator-time config) —
 * and for consistency with this package's own `createXController()` registration convention
 * (`define-space-app.ts` calls this the same way it calls `createAssetsController`).
 */
export function createLogApiController(
  options: LogApiControllerOptions = {},
): new (context: HandlerContext) => LogApiControllerInstance {
  // Empty, not `'api'` — the REST server itself already applies a default `/api` globalPrefix
  // (`@zanix/server`'s own `bootstrapServers`, `defaultPrefix: 'api'` for the `rest` type), the
  // exact same server-level prefix `createAssetsController`'s own `prefix = 'assets'` default
  // already composes with to land on `/api/assets/...` — a bare `'api'` default here stacked a
  // SECOND one on top, landing on `/api/api/log` instead of the documented, intended `/api/log`.
  // Confirmed live: `client-logger.ts`'s own `postLog()` fetches `/api/log` unconditionally, and a
  // real dev/production server registered `/api/api/log` — completely unreachable, a real,
  // confirmed regression present since this controller's own default was written.
  const { prefix = '', guards, rateLimit } = options
  const guard = combineGuards(guards, rateLimit)

  @Controller({ prefix })
  class _LogApiController extends ZanixController {
    @Post('log', { Body: LogIngestRTO })
    @Guard(guard)
    public ingest(
      ctx: HandlerContext<{ body: LogIngestRTO }>,
    ): Promise<Record<string, unknown>> {
      const { level, data } = ctx.payload.body
      // `data.origin` is opaque, unvalidated data (see `LogIngestRTO`'s own doc for why) — if a
      // caller sends a non-string value, or omits `origin` altogether (the real-world default:
      // `client-logger.ts`'s own `postLog` doesn't tag it either, deliberately, since THIS route's
      // only real caller is always a browser client), passing `undefined` through lets
      // `Logger#ingest`'s own `origin` parameter apply its documented `'client'` default — the
      // one place that default actually lives, not duplicated here.
      const origin = typeof data.origin === 'string' ? data.origin : undefined
      // `Logger#ingest`'s own signature borrows `LoggerData`'s default (`'info'`) shape, whose
      // first element is a required `string` — `data.message` is `unknown` at this RTO's own
      // boundary (see `LogIngestRTO`'s doc for why `data` is captured, not validated), so this
      // cast reflects the documented `@zanix/utils` relay contract as-is: an origin that sent a
      // non-string (or missing) `message` gets `String(...)`'d rather than rejected outright —
      // this endpoint's job is relaying, not re-validating what the client's own `Logger` already
      // formatted. Synchronous work only (`Logger#ingest` never returns a `Promise`) — no `async`
      // keyword, just an explicit `Promise.resolve` to match this interface's own signature (kept
      // `Promise`-returning for symmetry with `AssetsControllerInstance`'s own handler shapes).
      logger.ingest(level, origin, String(data.message ?? ''), data)
      return Promise.resolve({ ok: true })
    }
  }

  return _LogApiController
}
