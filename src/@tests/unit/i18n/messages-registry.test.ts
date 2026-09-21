import { assertEquals } from '@std/assert'
import {
  getMessagesBuildDir,
  getMessagesDir,
  getMessageSources,
  resetMessagesBuildDir,
  resetMessagesDir,
  resetMessageSources,
  setMessagesBuildDir,
  setMessagesDir,
  setMessageSources,
} from 'modules/i18n/messages-registry.ts'

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

Deno.test('messages-registry: build dir never configured resolves to undefined', () => {
  resetMessagesBuildDir()
  assertEquals(getMessagesBuildDir(), undefined)
})

Deno.test('messages-registry: build dir is stored and read back as-is', () => {
  resetMessagesBuildDir()
  setMessagesBuildDir('./.dist/client')
  assertEquals(getMessagesBuildDir(), './.dist/client')
})

Deno.test('messages-registry: build dir reset clears back to undefined', () => {
  setMessagesBuildDir('./.dist/client')
  resetMessagesBuildDir()
  assertEquals(getMessagesBuildDir(), undefined)
})

Deno.test('messages-registry: no sources declared resolves to an empty list', () => {
  resetMessageSources()
  assertEquals(getMessageSources(), [])
})

Deno.test('messages-registry: sources are stored in declaration order and reset clears them', () => {
  const first = () => ({ 'a': 'a' })
  const second = () => undefined
  setMessageSources([first, second])
  assertEquals(getMessageSources(), [first, second])
  resetMessageSources()
  assertEquals(getMessageSources(), [])
})
