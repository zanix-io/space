import { assert, assertEquals } from '@std/assert'
import logger from 'modules/client/client-logger.ts'

/**
 * `client-logger.ts`'s only real logic beyond `createClientLogger(fetcher)` itself is `postLog`
 * (private, never exported) — this covers it indirectly through the shared `logger` instance's
 * own public methods, the only way any real caller (`hydrate-comets.ts`, ...) ever reaches it.
 * `globalThis.fetch` is stubbed rather than hitting the network — this project has no running
 * server for `/api/log` in a unit test, and doesn't need one to prove this module's own contract:
 * that a log call reaches `fetch('/api/log', ...)` with the documented shape, and that a failed
 * request never becomes an unhandled rejection or a thrown error.
 */

function stubFetch(
  impl: (url: string, init: RequestInit) => Promise<Response>,
): { calls: { url: string; init: RequestInit }[]; restore: () => void } {
  const original = globalThis.fetch
  const calls: { url: string; init: RequestInit }[] = []
  globalThis.fetch = ((url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    return impl(String(url), init)
  }) as typeof fetch
  return { calls, restore: () => (globalThis.fetch = original) }
}

Deno.test(
  'client-logger: logging POSTs one already-formatted entry to /api/log, synchronously',
  () => {
    const stub = stubFetch(() => Promise.resolve(new Response(null, { status: 204 })))
    try {
      logger.warn('something happened', { extra: 1 })

      // `saveDataFetcherFunction` calls `fetcher(...)` synchronously (evaluated as an argument to
      // `Promise.resolve(...)`, before any `await`) — no need to wait for anything here.
      assertEquals(stub.calls.length, 1)
      assertEquals(stub.calls[0].url, '/api/log')
      assertEquals(stub.calls[0].init.method, 'POST')
      assertEquals(
        (stub.calls[0].init.headers as Record<string, string>)['content-type'],
        'application/json',
      )

      const body = JSON.parse(String(stub.calls[0].init.body))
      assertEquals(body.level, 'warn')
      assertEquals(body.message, 'something happened')
      assertEquals(
        'origin' in body,
        false,
        "postLog must not tag origin itself — Logger#ingest's own 'client' default covers it",
      )
    } finally {
      stub.restore()
    }
  },
)

Deno.test(
  'client-logger: a failed fetch is swallowed — never becomes an unhandled rejection or a ' +
    'thrown error out of the logging call itself',
  async () => {
    const stub = stubFetch(() => Promise.reject(new Error('network down')))
    try {
      // Must not throw synchronously...
      const result = logger.error('boom')
      // ...and if a promise came back, it must not reject either.
      if (result instanceof Promise) await result
      assertEquals(stub.calls.length, 1)
    } finally {
      stub.restore()
    }
  },
)

Deno.test('client-logger: the shared instance exposes the full Logger API surface', () => {
  assert(typeof logger.debug === 'function')
  assert(typeof logger.info === 'function')
  assert(typeof logger.warn === 'function')
  assert(typeof logger.error === 'function')
  assert(typeof logger.high === 'function')
  assert(typeof logger.success === 'function')
})
