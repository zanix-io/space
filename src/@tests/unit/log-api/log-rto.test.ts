import { assertEquals, assertRejects } from '@std/assert'
import { classValidation } from '@zanix/validator'
import { HttpError } from '@zanix/errors'
import { LogIngestRTO } from 'modules/log-api/controllers/rtos/log.rto.ts'

/**
 * Runs `LogIngestRTO` through `@zanix/validator`'s own real `classValidation` entry point — the
 * SAME mechanism `@zanix/server`'s real request pipeline uses internally (`requestValidationPipe`
 * -> `classValidation(rto.Body, payload.body, {ctx})`) — rather than constructing the RTO directly
 * (`controller.test.ts`'s own unit tests do that instead, to unit-test `ingest`'s own relay logic
 * in isolation). This is the ONLY way to exercise the real per-field validation decorators
 * (`@IsEnum`/`@Expose`) at all: a direct `new LogIngestRTO(...)` never runs them (see
 * `defineSetter`'s own `this.constructor.prototype.validate` guard in `@zanix/utils`) — confirmed
 * load-bearing, not incidental: whether `data`'s own `@Expose()` correctly carries
 * `{ optional: true }` (see that accessor's own doc) decides whether every well-formed real HTTP
 * request succeeds or fails with a 400, and a test that only ever constructs the RTO directly can
 * never see that.
 */

Deno.test(
  'LogIngestRTO: a well-formed body (level + extra fields) validates, level and data both exposed',
  async () => {
    const rto = await classValidation(LogIngestRTO, { level: 'warn', message: 'hello', extra: 1 })
    assertEquals(rto.level, 'warn')
    assertEquals(rto.data, { message: 'hello', extra: 1 })
  },
)

Deno.test(
  'LogIngestRTO: a body with ONLY level (no extra fields) still validates — data resolves to {}, ' +
    'never a false "must be defined" rejection',
  async () => {
    const rto = await classValidation(LogIngestRTO, { level: 'info' })
    assertEquals(rto.level, 'info')
    assertEquals(rto.data, {})
  },
)

Deno.test(
  'LogIngestRTO: an invalid level (not a real LoggerMethods value) is rejected with a 400 ' +
    'BAD_REQUEST HttpError, never silently let through',
  async () => {
    const error = await assertRejects(
      () => classValidation(LogIngestRTO, { level: 'not-a-real-level', message: 'hi' }),
      HttpError,
    )
    assertEquals(error.status?.value, 400)
    assertEquals(error.status?.code, 'BAD_REQUEST')
  },
)

Deno.test(
  'LogIngestRTO: a missing level is rejected with a 400 BAD_REQUEST HttpError',
  async () => {
    const error = await assertRejects(
      () => classValidation(LogIngestRTO, { message: 'no level at all' }),
      HttpError,
    )
    assertEquals(error.status?.value, 400)
    assertEquals(error.status?.code, 'BAD_REQUEST')
  },
)
