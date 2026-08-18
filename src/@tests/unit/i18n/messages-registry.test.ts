import { assertEquals } from '@std/assert'
import { getMessagesDir, resetMessagesDir, setMessagesDir } from 'modules/i18n/messages-registry.ts'

Deno.test('messages-registry: never configured resolves to undefined', () => {
  resetMessagesDir()
  assertEquals(getMessagesDir(), undefined)
})

Deno.test('messages-registry: a single string is stored and read back as-is', () => {
  resetMessagesDir()
  setMessagesDir('./messages')
  assertEquals(getMessagesDir(), './messages')
})

Deno.test('messages-registry: an array is stored and read back as-is', () => {
  resetMessagesDir()
  setMessagesDir(['./messages-override', './messages'])
  assertEquals(getMessagesDir(), ['./messages-override', './messages'])
})

Deno.test('messages-registry: reset clears back to undefined', () => {
  setMessagesDir('./messages')
  resetMessagesDir()
  assertEquals(getMessagesDir(), undefined)
})
