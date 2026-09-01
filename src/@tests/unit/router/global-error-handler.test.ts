import { assertEquals } from '@std/assert'
import { globalErrorHandler } from 'modules/router/global-error-handler.ts'
import type { OnErrorHandler } from 'modules/router/not-found-handler.ts'

const NEVER_HANDLES = (() => undefined) as unknown as OnErrorHandler

Deno.test(
  'globalErrorHandler: the first handler that returns a real Response wins, later ones never run',
  async () => {
    let secondHandlerCalls = 0
    const first = ((_error: unknown) => new Response('first')) as unknown as OnErrorHandler
    const second = ((_error: unknown) => {
      secondHandlerCalls++
      return new Response('second')
    }) as unknown as OnErrorHandler

    const combined = globalErrorHandler(first, second)
    const response = await combined(new Error('boom'))

    assertEquals(await (response as Response).text(), 'first')
    assertEquals(secondHandlerCalls, 0)
  },
)

Deno.test(
  'globalErrorHandler: a handler returning undefined is skipped, the next one still runs',
  async () => {
    const combined = globalErrorHandler(
      NEVER_HANDLES,
      ((_error: unknown) => new Response('recovered')) as unknown as OnErrorHandler,
    )
    const response = await combined(new Error('boom'))

    assertEquals(await (response as Response).text(), 'recovered')
  },
)

Deno.test(
  'globalErrorHandler: undefined when every handler declines, matching a single OnErrorHandler\'s own "fall through" contract',
  async () => {
    const combined = globalErrorHandler(NEVER_HANDLES, NEVER_HANDLES)
    const response = await combined(new Error('boom'))

    assertEquals(response, undefined)
  },
)

Deno.test(
  'globalErrorHandler: every handler receives the SAME raw error, unmodified',
  async () => {
    const originalError = new Error('the real one')
    const seen: unknown[] = []
    const record = ((error: unknown) => {
      seen.push(error)
      return undefined
    }) as unknown as OnErrorHandler

    await globalErrorHandler(record, record)(originalError)

    assertEquals(seen, [originalError, originalError])
  },
)
