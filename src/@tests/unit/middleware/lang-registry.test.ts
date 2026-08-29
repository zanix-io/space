import { assertEquals } from '@std/assert'
import { getLangRegistration, setLangRegistration } from 'modules/middleware/lang-registry.ts'

Deno.test('getLangRegistration: undefined until langPreHandler registers one', () => {
  setLangRegistration(undefined)
  assertEquals(getLangRegistration(), undefined)
})

Deno.test('setLangRegistration/getLangRegistration: round-trips exactly', () => {
  setLangRegistration({ availableLangs: ['en', 'es'], paramName: 'lang' })
  try {
    assertEquals(getLangRegistration(), { availableLangs: ['en', 'es'], paramName: 'lang' })
  } finally {
    setLangRegistration(undefined)
  }
})
