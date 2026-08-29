import { assertEquals } from '@std/assert'
import {
  getUserPreHandler,
  resetUserPreHandler,
  setUserPreHandler,
} from 'modules/middleware/pre-handler-registry.ts'

Deno.test('getUserPreHandler: undefined when no preHandler was ever registered', () => {
  resetUserPreHandler()
  assertEquals(getUserPreHandler(), undefined)
})

Deno.test('setUserPreHandler/getUserPreHandler: round-trips the exact same function', () => {
  resetUserPreHandler()
  const preHandler = () => null

  setUserPreHandler(preHandler)

  assertEquals(getUserPreHandler(), preHandler)
  resetUserPreHandler()
})

Deno.test('resetUserPreHandler: clears a previously registered preHandler back to undefined', () => {
  setUserPreHandler(() => null)
  resetUserPreHandler()

  assertEquals(getUserPreHandler(), undefined)
})

Deno.test('setUserPreHandler: passing undefined explicitly clears it, same as reset', () => {
  setUserPreHandler(() => null)
  setUserPreHandler(undefined)

  assertEquals(getUserPreHandler(), undefined)
})
