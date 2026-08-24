import { assert, assertEquals } from '@std/assert'
import { ZanixController, ZanixSsrController } from '@zanix/server'
import { createLogApiController } from 'modules/log-api/controllers/log.controller.ts'
import { LogIngestRTO } from 'modules/log-api/controllers/rtos/log.rto.ts'
import { mockHandlerContext } from 'modules/testing/mock-handler-context.ts'

/**
 * `logger.ingest` itself is `@zanix/logger`'s own real, singleton default export (this endpoint
 * never accepts an injected service — see `createLogApiController`'s own doc for why) — spying on
 * it means temporarily installing a fake as `globalThis.logger`, the exact mechanism
 * `@zanix/logger`'s own default export (a `Proxy` reading `self.logger` at call time) documents
 * for overriding which instance is "current" — see that package's own `mod.ts` doc, point 6. Never
 * assigning `logger.ingest` directly: `@zanix/logger`'s default export has no `set` trap of its
 * own, so a direct property assignment would fall through to `Logger.prototype` itself instead of
 * this test's own fake, mutating shared state no `finally` block here could safely undo.
 */
function spyIngest(): {
  calls: Array<[type: unknown, origin: unknown, message: unknown, data: unknown]>
  restore: () => void
} {
  // deno-lint-ignore no-explicit-any
  const globals = globalThis as any
  const original = globals.logger
  const calls: Array<[unknown, unknown, unknown, unknown]> = []
  globals.logger = { ingest: (...args: unknown[]) => (calls.push(args as never), undefined) }
  return {
    calls,
    restore: () => {
      globals.logger = original
    },
  }
}

Deno.test(
  'createLogApiController: returns a class extending ZanixController, never ZanixSsrController',
  () => {
    const ControllerClass = createLogApiController({ prefix: 'api-log-shape-test' })
    assert(
      ControllerClass.prototype instanceof ZanixController,
      'a JSON REST relay endpoint — same base assets.controller.ts uses, not the SSR page/byte ' +
        'base',
    )
    assert(!(ControllerClass.prototype instanceof ZanixSsrController))
  },
)

Deno.test(
  'ingest: relays level/message/data into Logger#ingest exactly per the documented ' +
    '`@zanix/utils` relay contract, and acks with {ok: true}. Passes origin through as ' +
    "undefined when the body omits it — trusting Logger#ingest's OWN 'client' default, never " +
    'resolving that default itself',
  async () => {
    const ControllerClass = createLogApiController({ prefix: 'api-log-relay-test' })
    const body = new LogIngestRTO({ level: 'warn', message: 'hello', extra: 1 })
    const ctx = mockHandlerContext({ payload: { params: {}, search: {}, body } })
    const controller = new ControllerClass(ctx)
    const spy = spyIngest()

    try {
      const result = await controller.ingest(ctx)

      assertEquals(spy.calls.length, 1)
      const [type, origin, message, data] = spy.calls[0]
      assertEquals(type, 'warn')
      assertEquals(origin, undefined, "must not resolve 'client' itself — that's ingest's job")
      assertEquals(message, 'hello')
      assertEquals(data, { message: 'hello', extra: 1 })
      assertEquals(result, { ok: true })
    } finally {
      spy.restore()
    }
  },
)

Deno.test(
  'ingest: an explicit data.origin (e.g. from a non-browser relay) is forwarded as-is, never ' +
    "overridden by the 'client' default",
  async () => {
    const ControllerClass = createLogApiController({ prefix: 'api-log-origin-test' })
    const body = new LogIngestRTO({ level: 'error', message: 'boom', origin: 'mobile-app' })
    const ctx = mockHandlerContext({ payload: { params: {}, search: {}, body } })
    const controller = new ControllerClass(ctx)
    const spy = spyIngest()

    try {
      await controller.ingest(ctx)

      assertEquals(spy.calls.length, 1)
      const [, origin] = spy.calls[0]
      assertEquals(origin, 'mobile-app')
    } finally {
      spy.restore()
    }
  },
)

Deno.test(
  'ingest: a missing message still forwards — String(undefined ?? "") resolves to an empty ' +
    'string, never a thrown error or a literal "undefined"',
  async () => {
    const ControllerClass = createLogApiController({ prefix: 'api-log-no-message-test' })
    const body = new LogIngestRTO({ level: 'info', extra: true })
    const ctx = mockHandlerContext({ payload: { params: {}, search: {}, body } })
    const controller = new ControllerClass(ctx)
    const spy = spyIngest()

    try {
      await controller.ingest(ctx)

      assertEquals(spy.calls.length, 1)
      const [type, origin, message, data] = spy.calls[0]
      assertEquals(type, 'info')
      assertEquals(origin, undefined)
      assertEquals(message, '')
      assertEquals(data, { extra: true })
    } finally {
      spy.restore()
    }
  },
)
