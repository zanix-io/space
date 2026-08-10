import { assert, assertEquals, assertFalse } from '@std/assert'
import { extractFragmentTitle, shouldInterceptNavigation } from 'modules/client/orbit.ts'

function baseInput() {
  return {
    href: '/products',
    target: null,
    hasOptOut: false,
    hasModifierKey: false,
    isSameOrigin: true,
  }
}

Deno.test('shouldInterceptNavigation: intercepts a plain, same-origin internal link', () => {
  assert(shouldInterceptNavigation(baseInput()))
})

Deno.test('shouldInterceptNavigation: never intercepts a link with no href', () => {
  assertFalse(shouldInterceptNavigation({ ...baseInput(), href: null }))
})

Deno.test('shouldInterceptNavigation: respects the data-orbit-hard escape hatch', () => {
  assertFalse(shouldInterceptNavigation({ ...baseInput(), hasOptOut: true }))
})

Deno.test('shouldInterceptNavigation: never intercepts a modified click', () => {
  assertFalse(shouldInterceptNavigation({ ...baseInput(), hasModifierKey: true }))
})

Deno.test('shouldInterceptNavigation: never intercepts a cross-origin link', () => {
  assertFalse(shouldInterceptNavigation({ ...baseInput(), isSameOrigin: false }))
})

Deno.test('shouldInterceptNavigation: never intercepts target="_blank"', () => {
  assertFalse(shouldInterceptNavigation({ ...baseInput(), target: '_blank' }))
})

Deno.test('shouldInterceptNavigation: target="_self" is the same as no target at all', () => {
  assert(shouldInterceptNavigation({ ...baseInput(), target: '_self' }))
})

Deno.test('extractFragmentTitle: pulls the title out and strips it from the body', () => {
  const html = '<title>Product — Store</title><h1>Product</h1>'
  const { title, body } = extractFragmentTitle(html)

  assertEquals(title, 'Product — Store')
  assertEquals(body, '<h1>Product</h1>')
})

Deno.test('extractFragmentTitle: undefined title when the fragment has none', () => {
  const html = '<h1>Product</h1>'
  const { title, body } = extractFragmentTitle(html)

  assertEquals(title, undefined)
  assertEquals(body, html)
})
