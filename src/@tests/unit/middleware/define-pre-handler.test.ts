import { assertEquals, assertStrictEquals } from '@std/assert'
import { definePreHandler } from 'modules/middleware/define-pre-handler.ts'
import { getUserPreHandler, resetUserPreHandler } from 'modules/middleware/pre-handler-registry.ts'

// `definePreHandler` itself is never called anywhere else in this suite — every existing test
// exercises `pre-handler-registry.ts`'s `setUserPreHandler` directly instead. Without this file,
// `definePreHandler` could stop delegating (or delegate with the wrong argument) with nothing here
// to catch it.
Deno.test('definePreHandler: registers the exact same function reference via setUserPreHandler', () => {
  resetUserPreHandler()
  const preHandler = () => null

  definePreHandler(preHandler)

  assertStrictEquals(getUserPreHandler(), preHandler)
  resetUserPreHandler()
})

Deno.test('definePreHandler: calling it again replaces the previously registered preHandler', () => {
  resetUserPreHandler()
  const first = () => null
  const second = () => null

  definePreHandler(first)
  definePreHandler(second)

  assertStrictEquals(getUserPreHandler(), second)
  assertEquals(getUserPreHandler() === first, false)
  resetUserPreHandler()
})
