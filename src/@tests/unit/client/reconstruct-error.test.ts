import { assert, assertEquals } from '@std/assert'
import { reconstructError } from 'modules/client/reconstruct-error.ts'

Deno.test('reconstructError: builds a real Error carrying the given message and stack', () => {
  const error = reconstructError('boom', 'Error: boom\n    at somewhere')
  assertEquals(error.message, 'boom')
  assertEquals(error.stack, 'Error: boom\n    at somewhere')
})

Deno.test('reconstructError: no stack given leaves the default Error stack untouched', () => {
  const error = reconstructError('boom', null)
  assertEquals(error.message, 'boom')
  // Never explicitly overwritten with `null`/empty — whatever `new Error('boom')` itself already
  // produced (its own real capture, starting with the message).
  assert(error.stack?.startsWith('Error: boom'), error.stack)
})

Deno.test('reconstructError: no message given falls back to a fixed placeholder, never "null"', () => {
  const error = reconstructError(null, null)
  assertEquals(error.message, 'Unknown error')
})

Deno.test('reconstructError: an empty stack string is treated the same as no stack at all', () => {
  const error = reconstructError('boom', '')
  assertEquals(error.message, 'boom')
  assert(error.stack?.startsWith('Error: boom'), error.stack)
})
