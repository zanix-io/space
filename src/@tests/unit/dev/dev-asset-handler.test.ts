import { assert, assertEquals, assertFalse } from '@std/assert'
import { createDevAssetHandler, looksLikeDevAssetRequest } from 'modules/dev/mod.ts'
import type { SpaceDevEngine } from 'modules/bundler/dev-engine.ts'

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

/** Only `transformClientAsset` is ever needed — {@linkcode createDevAssetHandler}'s own type only
 * asks for that one method (`Pick<SpaceDevEngine, 'transformClientAsset'>`). */
function fakeEngine(
  transformClientAsset: SpaceDevEngine['transformClientAsset'],
): Pick<SpaceDevEngine, 'transformClientAsset'> {
  return { transformClientAsset }
}

Deno.test(
  'createDevAssetHandler: a request that never looks like a dev asset is passed through (null), ' +
    'regardless of Sec-Fetch-Dest',
  async () => {
    const handler = createDevAssetHandler(
      fakeEngine(() => Promise.reject(new Error('must never be called'))),
    )
    const response = await handler(
      new Request('https://example.com/products/1', { headers: { 'sec-fetch-dest': 'document' } }),
    )
    assertEquals(response, null)
  },
)

Deno.test(
  'createDevAssetHandler: a resolved asset responds 200 with its own content-type and etag',
  async () => {
    const handler = createDevAssetHandler(
      fakeEngine(() =>
        Promise.resolve({
          code: 'export default {}',
          contentType: 'application/javascript',
          etag: 'abc',
        })
      ),
    )
    const response = await handler(new Request('https://example.com/comets/counter.tsx'))
    assert(response)
    assertEquals(response.status, 200)
    assertEquals(response.headers.get('content-type'), 'application/javascript')
    assertEquals(response.headers.get('etag'), 'abc')
    assertEquals(await response.text(), 'export default {}')
  },
)

Deno.test(
  'createDevAssetHandler: a transform error responds 500 with the error message as plain text',
  async () => {
    const handler = createDevAssetHandler(
      fakeEngine(() => Promise.reject(new Error('Unexpected token'))),
    )
    const response = await handler(new Request('https://example.com/comets/broken.tsx'))
    assert(response)
    assertEquals(response.status, 500)
    assertEquals(await response.text(), 'Unexpected token')
  },
)

Deno.test(
  'createDevAssetHandler: an unresolved asset with no Sec-Fetch-Dest at all still responds a ' +
    'plain 404 — unchanged from before this fallback existed',
  async () => {
    const handler = createDevAssetHandler(fakeEngine(() => Promise.resolve(null)))
    const response = await handler(new Request('https://example.com/comets/missing.tsx'))
    assert(response)
    assertEquals(response.status, 404)
  },
)

for (const dest of ['script', 'style']) {
  Deno.test(
    `createDevAssetHandler: an unresolved asset requested as a real stylesheet/script ` +
      `(Sec-Fetch-Dest: ${dest}) still responds a plain 404 — a genuinely broken asset reference ` +
      'must never render a full HTML document in its place',
    async () => {
      const handler = createDevAssetHandler(fakeEngine(() => Promise.resolve(null)))
      const response = await handler(
        new Request('https://example.com/comets/missing.tsx', {
          headers: { 'sec-fetch-dest': dest },
        }),
      )
      assert(response)
      assertEquals(response.status, 404)
    },
  )
}

Deno.test(
  'createDevAssetHandler: an unresolved asset requested as a real document navigation ' +
    '(Sec-Fetch-Dest: document) falls through (null) to the real route table instead of a bare ' +
    '404 — the real fix: a person who typed/clicked their way to a URL ' +
    "looksLikeDevAssetRequest misclassified as an asset (e.g. /page.tsx) sees this app's own " +
    'not-found.tsx, like any other unmatched route',
  async () => {
    const handler = createDevAssetHandler(fakeEngine(() => Promise.resolve(null)))
    const response = await handler(
      new Request('https://example.com/page.tsx', { headers: { 'sec-fetch-dest': 'document' } }),
    )
    assertEquals(response, null)
  },
)
