import { assertEquals } from '@std/assert'
import { getLangRegistration, setLangRegistration } from 'modules/middleware/lang-registry.ts'

Deno.test('getLangRegistration: undefined until langPreHandler registers one', () => {
  setLangRegistration(undefined)
  assertEquals(getLangRegistration(), undefined)
})

Deno.test('setLangRegistration/getLangRegistration: round-trips exactly', () => {
  const registration = {
    availableLangs: ['en', 'es'],
    paramName: 'lang',
    defaultLang: 'en',
    cookieName: 'X-Znx-Lang',
  }
  setLangRegistration(registration)
  try {
    assertEquals(getLangRegistration(), registration)
  } finally {
    setLangRegistration(undefined)
  }
})
