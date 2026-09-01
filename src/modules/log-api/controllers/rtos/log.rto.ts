import { BaseRTO, Expose, IsEnum } from '@zanix/validator'
import type { LoggerMethods } from '@zanix/logger'

/** Every real value {@linkcode LoggerMethods} accepts — kept in sync with `@zanix/utils`'s own
 * type by hand (that package exports it as a `type`, not a runtime array/enum object `@IsEnum`
 * could read directly). */
export const LOGGER_METHODS: LoggerMethods[] = ['info', 'error', 'high', 'warn', 'debug', 'success']

/**
 * Body validation for `POST /api/log` — the browser relay endpoint `createClientLogger`'s own
 * `fetcher` posts to (see `modules/client/client-logger.ts`). Mirrors `@zanix/utils`'s own
 * documented relay contract exactly: `const { level, ...data } = await request.json()`, then
 * `logger.ingest(level, data.origin, data.message, data)` — `level` because that's the real
 * severity field `DefaultFormattedLog` (what the browser's own `Logger` actually serializes)
 * carries; `Logger#ingest`'s own first parameter happens to be named `type`, but that's just its
 * local name, not the wire field. `data.origin` normally doesn't exist at all — this endpoint's
 * only real caller, `client-logger.ts`'s own `postLog`, deliberately never tags it (see that
 * module's own doc for why: it's always a browser client, so `Logger#ingest`'s own `'client'`
 * default already covers it) — a caller relaying from somewhere else entirely (not this package's
 * own client) can still send an explicit `origin` to override that default; `log.controller.ts`'s
 * `ingest` handler is what actually extracts it, this RTO only captures it as part of
 * {@linkcode data} like every other field.
 *
 * Only `level` is validated — it's the one field the relay itself depends on (an invalid value
 * would reach `Logger#ingest` and fail there, less clearly, if let through). Everything else
 * (`message`, `origin`, plus whatever extra fields a given `BaseFormattedLog` carries) is opaque,
 * arbitrary data as far as this endpoint is concerned — `@zanix/utils`'s own client `Logger`
 * already formatted and redacted it once client-side, and the SERVER's own `Logger#ingest` redacts/
 * formats it again on arrival, so this RTO doesn't re-validate its shape, only captures it as-is
 * under {@linkcode data}.
 */
export class LogIngestRTO extends BaseRTO {
  /** Splits the raw request body into `level` (validated below) and `data` (everything else,
   * captured as-is) — see this class's own top doc for why the split happens here, in the
   * constructor, rather than via per-field validation decorators alone.
   * @param payload - The raw, parsed request body `@zanix/server` hands this RTO's constructor. */
  public constructor(payload: { level?: LoggerMethods } & Record<string, unknown>) {
    super()
    const { level, ...data } = payload ?? {}
    this.level = level as LoggerMethods
    this.data = data
  }

  /** The severity the browser origin itself logged at — must be a real {@linkcode LoggerMethods}
   * value. */
  @IsEnum(LOGGER_METHODS, { expose: true })
  accessor level!: LoggerMethods

  /** Everything from the request body EXCEPT `level` — `message` plus any other field a given
   * `BaseFormattedLog` carried, plus an `origin` field ONLY if the caller explicitly sent one
   * (this package's own `client-logger.ts` deliberately doesn't — see this class's own top doc).
   * Captured, not validated (see this class's own top doc for why) — assigned directly in the
   * constructor, so `@Expose()` is what includes it in the resolved RTO instance without running
   * it through this package's normal per-field validation pipeline.
   *
   * `{ optional: true }` is REQUIRED here, not cosmetic: `@zanix/validator`'s own `@Expose()`
   * "must be defined" check is keyed off the RAW request body's OWN `data` property
   * (`plainPayload.data`), which never exists as a literal top-level key on the wire — `data` here
   * is this constructor's own COMPUTED rest-spread of "everything except `level`", not a field
   * with a matching name in the payload. Without `optional: true`, every real request — even a
   * well-formed one — fails `classValidation` with `"The 'data' property must be defined."`,
   * regardless of what the constructor actually assigns afterward (the constructor's own explicit
   * `this.data = data` still runs correctly through the real setter; only the framework's own
   * eager, payload-key-based required-check misfires). This is also semantically correct on its
   * own terms: a body carrying only `{ level }` with no extra fields is still valid, and should
   * resolve to `data: {}`. */
  @Expose({ optional: true })
  accessor data!: Record<string, unknown>
}
