import { assertEquals } from '@std/assert'
import { sanitizeThemeTokens, serializeThemeStyle } from 'modules/theme/theme-style.ts'

Deno.test('serializeThemeStyle: a single valid token serializes into a :root rule', () => {
  const style = serializeThemeStyle({ '--space-color-primary': '#16a34a' })
  assertEquals(style, ':root{--space-color-primary:#16a34a}')
})

Deno.test('serializeThemeStyle: multiple valid tokens join with ;', () => {
  const style = serializeThemeStyle({
    '--space-color-primary': '#16a34a',
    '--space-color-secondary': '#0ea5e9',
  })
  assertEquals(style, ':root{--space-color-primary:#16a34a;--space-color-secondary:#0ea5e9}')
})

Deno.test(
  'serializeThemeStyle: undefined for an empty tokens object — no <style> is warranted',
  () => {
    assertEquals(serializeThemeStyle({}), undefined)
  },
)

Deno.test(
  'serializeThemeStyle: undefined when every entry is invalid — nothing survives sanitization',
  () => {
    assertEquals(serializeThemeStyle({ 'not-a-token': 'red' }), undefined)
  },
)

Deno.test('serializeThemeStyle: legitimate CSS value shapes survive unchanged', () => {
  const style = serializeThemeStyle({
    '--space-shadow': '0 4px 12px rgba(0,0,0,.1)',
    '--space-font': "'Avenir', sans-serif",
    '--space-gap': 'calc(1rem + 2px)',
  })
  assertEquals(
    style,
    ":root{--space-shadow:0 4px 12px rgba(0,0,0,.1);--space-font:'Avenir', sans-serif;" +
      '--space-gap:calc(1rem + 2px)}',
  )
})

Deno.test('sanitizeThemeTokens: drops a name that is not a real custom-property name', () => {
  const safe = sanitizeThemeTokens({
    '--space-color-primary': 'red',
    'color-primary': 'red', // missing the leading --
    '--': 'red', // no identifier after --
    '--1invalid': 'red', // starts with a digit
  })
  assertEquals(safe, { '--space-color-primary': 'red' })
})

Deno.test('sanitizeThemeTokens: drops a value containing ; — declaration-smuggling attempt', () => {
  const safe = sanitizeThemeTokens({
    '--space-color-primary': "red;background:url('https://evil.example/x')",
  })
  assertEquals(safe, {})
})

Deno.test('sanitizeThemeTokens: drops a value containing { or } — rule-smuggling attempt', () => {
  const safe = sanitizeThemeTokens({
    '--a': 'red}body{display:none',
    '--b': 'red{',
  })
  assertEquals(safe, {})
})

Deno.test(
  'sanitizeThemeTokens: drops a value containing < or ` — style-element breakout attempt',
  () => {
    const safe = sanitizeThemeTokens({
      '--a': 'red</style><script>alert(1)</script>',
      '--b': 'url(`javascript:alert(1)`)',
    })
    assertEquals(safe, {})
  },
)

Deno.test('sanitizeThemeTokens: drops a value containing a newline', () => {
  const safe = sanitizeThemeTokens({ '--a': 'red\nbody{display:none}' })
  assertEquals(safe, {})
})

Deno.test('sanitizeThemeTokens: a mix of safe and unsafe entries keeps only the safe ones', () => {
  const safe = sanitizeThemeTokens({
    '--space-color-primary': '#16a34a',
    '--space-evil': 'red;}body{display:none',
    'not-a-token': 'red',
  })
  assertEquals(safe, { '--space-color-primary': '#16a34a' })
})

Deno.test('sanitizeThemeTokens: a non-string value is dropped, never coerced', () => {
  const safe = sanitizeThemeTokens(
    // deno-lint-ignore no-explicit-any
    { '--space-color-primary': 42 as any },
  )
  assertEquals(safe, {})
})
