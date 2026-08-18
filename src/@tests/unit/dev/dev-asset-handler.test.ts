import { assert, assertFalse } from '@std/assert'
import { looksLikeDevAssetRequest } from 'modules/dev/mod.ts'

Deno.test('looksLikeDevAssetRequest: recognizes real source-file extensions', () => {
  assert(looksLikeDevAssetRequest('/comets/counter.tsx'))
  assert(looksLikeDevAssetRequest('/comets/helper.ts'))
  assert(looksLikeDevAssetRequest('/comets/styles.css'))
  assert(looksLikeDevAssetRequest('/some/nested/path/component.jsx'))
})

Deno.test("looksLikeDevAssetRequest: recognizes Vite's own special request paths", () => {
  assert(looksLikeDevAssetRequest('/@vite/client'))
  assert(
    looksLikeDevAssetRequest(
      '/@fs/Users/someone/.cache/deno/npm/vite/dist/client/env.mjs',
    ),
  )
  assert(looksLikeDevAssetRequest('/.vite/deps/react.js'))
  assert(looksLikeDevAssetRequest('/@id/virtual:something'))
})

Deno.test('looksLikeDevAssetRequest: recognizes /@react-refresh', () => {
  assert(looksLikeDevAssetRequest('/@react-refresh'))
})

Deno.test('looksLikeDevAssetRequest: /@react-refresh is an exact match, never a prefix', () => {
  assertFalse(looksLikeDevAssetRequest('/@react-refresh-something-else'))
})

Deno.test('looksLikeDevAssetRequest: a plain page route never matches', () => {
  assertFalse(looksLikeDevAssetRequest('/'))
  assertFalse(looksLikeDevAssetRequest('/products/1'))
  assertFalse(looksLikeDevAssetRequest('/about'))
})
