import { assert, assertFalse } from '@std/assert'
import { isConnectionSlow, shouldPrefetch } from 'modules/client/prefetch.ts'

function baseInput() {
  return {
    href: '/products',
    target: null,
    hasOptOut: false,
    isSameOrigin: true,
    isSameDocumentHashLink: false,
    connectionIsSlow: false,
  }
}

Deno.test('shouldPrefetch: prefetches a plain, same-origin internal link', () => {
  assert(shouldPrefetch(baseInput()))
})

Deno.test('shouldPrefetch: never prefetches a link with no href', () => {
  assertFalse(shouldPrefetch({ ...baseInput(), href: null }))
})

Deno.test('shouldPrefetch: respects the data-orbit-hard escape hatch', () => {
  assertFalse(shouldPrefetch({ ...baseInput(), hasOptOut: true }))
})

Deno.test('shouldPrefetch: never prefetches a cross-origin link', () => {
  assertFalse(shouldPrefetch({ ...baseInput(), isSameOrigin: false }))
})

Deno.test('shouldPrefetch: never prefetches target="_blank"', () => {
  assertFalse(shouldPrefetch({ ...baseInput(), target: '_blank' }))
})

Deno.test('shouldPrefetch: target="_self" is the same as no target at all', () => {
  assert(shouldPrefetch({ ...baseInput(), target: '_self' }))
})

Deno.test('shouldPrefetch: never prefetches a same-document hash-only link', () => {
  assertFalse(shouldPrefetch({ ...baseInput(), isSameDocumentHashLink: true }))
})

Deno.test('shouldPrefetch: never prefetches on a slow/metered connection', () => {
  assertFalse(shouldPrefetch({ ...baseInput(), connectionIsSlow: true }))
})

Deno.test(
  'isConnectionSlow: undefined connection (API unavailable) is never treated as slow',
  () => {
    assertFalse(isConnectionSlow(undefined))
  },
)

Deno.test('isConnectionSlow: an empty connection object is not slow', () => {
  assertFalse(isConnectionSlow({}))
})

Deno.test('isConnectionSlow: saveData alone is enough, regardless of effectiveType', () => {
  assert(isConnectionSlow({ saveData: true, effectiveType: '4g' }))
})

Deno.test('isConnectionSlow: effectiveType "slow-2g" is slow', () => {
  assert(isConnectionSlow({ effectiveType: 'slow-2g' }))
})

Deno.test('isConnectionSlow: effectiveType "2g" is slow', () => {
  assert(isConnectionSlow({ effectiveType: '2g' }))
})

Deno.test('isConnectionSlow: effectiveType "3g"/"4g" are not slow', () => {
  assertFalse(isConnectionSlow({ effectiveType: '3g' }))
  assertFalse(isConnectionSlow({ effectiveType: '4g' }))
})
