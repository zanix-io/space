import { assertEquals } from '@std/assert'
import {
  buildTransformCacheKey,
  hashSourceBytes,
  isValidTransformCacheEntry,
} from 'modules/assets/transform-cache.ts'

// --- hashSourceBytes: real content identity ------------------------------------------------------

Deno.test('hashSourceBytes: identical bytes always hash to the same value', async () => {
  const a = await hashSourceBytes(new Uint8Array([1, 2, 3, 4]))
  const b = await hashSourceBytes(new Uint8Array([1, 2, 3, 4]))
  assertEquals(a, b)
})

Deno.test('hashSourceBytes: different bytes hash to different values', async () => {
  const a = await hashSourceBytes(new Uint8Array([1, 2, 3, 4]))
  const b = await hashSourceBytes(new Uint8Array([1, 2, 3, 5]))
  assertEquals(a === b, false)
})

Deno.test('hashSourceBytes: returns a lowercase hex SHA-256 (64 chars)', async () => {
  const hash = await hashSourceBytes(new Uint8Array([]))
  assertEquals(hash.length, 64)
  assertEquals(/^[0-9a-f]+$/.test(hash), true)
})

// --- buildTransformCacheKey: the exact sha256(source)+transformId+policyVersion identity --------

Deno.test(
  'buildTransformCacheKey: builds the sha256(source):transformId:policyVersion shape',
  () => {
    const key = buildTransformCacheKey({
      sourceHash: 'abc123',
      transformId: 'video:mlg:webm',
      policyVersion: 'v1',
    })
    assertEquals(key, 'abc123:video:mlg:webm:v1')
  },
)

Deno.test(
  'buildTransformCacheKey: a different transformId changes the key (breakpoint/format changed)',
  () => {
    const base = { sourceHash: 'abc123', policyVersion: 'v1' }
    const msm = buildTransformCacheKey({ ...base, transformId: 'video:msm:mp4' })
    const mlg = buildTransformCacheKey({ ...base, transformId: 'video:mlg:mp4' })
    assertEquals(msm === mlg, false)
  },
)

Deno.test(
  'buildTransformCacheKey: a different policyVersion changes the key (policy changed)',
  () => {
    const base = { sourceHash: 'abc123', transformId: 'video:mlg:webm' }
    const v1 = buildTransformCacheKey({ ...base, policyVersion: 'v1' })
    const v2 = buildTransformCacheKey({ ...base, policyVersion: 'v2' })
    assertEquals(v1 === v2, false)
  },
)

Deno.test('buildTransformCacheKey: a different sourceHash changes the key (source changed)', () => {
  const base = { transformId: 'video:mlg:webm', policyVersion: 'v1' }
  const a = buildTransformCacheKey({ ...base, sourceHash: 'aaa' })
  const b = buildTransformCacheKey({ ...base, sourceHash: 'bbb' })
  assertEquals(a === b, false)
})

// --- isValidTransformCacheEntry: the "corrupt/incompatible -> safe miss" shape check -------------

Deno.test('isValidTransformCacheEntry: a well-formed optimized entry is valid', () => {
  assertEquals(isValidTransformCacheEntry({ status: 'optimized', bytesWritten: 123 }), true)
})

Deno.test('isValidTransformCacheEntry: a well-formed never-worsened entry is valid', () => {
  assertEquals(isValidTransformCacheEntry({ status: 'never-worsened', bytesWritten: 0 }), true)
})

Deno.test('isValidTransformCacheEntry: a well-formed multi-output entry is valid', () => {
  assertEquals(
    isValidTransformCacheEntry({
      status: 'optimized',
      bytesWritten: 500,
      outputs: ['a.jpg', 'b.webp'],
    }),
    true,
  )
})

Deno.test('isValidTransformCacheEntry: null/non-object/array are invalid', () => {
  assertEquals(isValidTransformCacheEntry(null), false)
  assertEquals(isValidTransformCacheEntry(undefined), false)
  assertEquals(isValidTransformCacheEntry('a string'), false)
  assertEquals(isValidTransformCacheEntry(42), false)
  assertEquals(isValidTransformCacheEntry([]), false)
})

Deno.test('isValidTransformCacheEntry: an unrecognized status is invalid', () => {
  assertEquals(isValidTransformCacheEntry({ status: 'something-else', bytesWritten: 1 }), false)
})

Deno.test('isValidTransformCacheEntry: a missing/non-numeric bytesWritten is invalid', () => {
  assertEquals(isValidTransformCacheEntry({ status: 'optimized' }), false)
  assertEquals(isValidTransformCacheEntry({ status: 'optimized', bytesWritten: '123' }), false)
})

Deno.test('isValidTransformCacheEntry: a malformed outputs field is invalid', () => {
  assertEquals(
    isValidTransformCacheEntry({ status: 'optimized', bytesWritten: 1, outputs: 'not-an-array' }),
    false,
  )
  assertEquals(
    isValidTransformCacheEntry({ status: 'optimized', bytesWritten: 1, outputs: [1, 2] }),
    false,
  )
})

Deno.test(
  'isValidTransformCacheEntry: an old/foreign shape (e.g. a future schema) is invalid',
  () => {
    assertEquals(isValidTransformCacheEntry({ result: 'done', size: 123 }), false)
  },
)

Deno.test('isValidTransformCacheEntry: a well-formed entry with opaque meta is valid', () => {
  assertEquals(
    isValidTransformCacheEntry({
      status: 'optimized',
      bytesWritten: 123,
      meta: { sampleRateHz: 44100, channels: 1 },
    }),
    true,
  )
})

Deno.test('isValidTransformCacheEntry: a malformed meta field is invalid', () => {
  assertEquals(
    isValidTransformCacheEntry({ status: 'optimized', bytesWritten: 1, meta: 'not-an-object' }),
    false,
  )
  assertEquals(
    isValidTransformCacheEntry({ status: 'optimized', bytesWritten: 1, meta: [1, 2] }),
    false,
  )
  assertEquals(
    isValidTransformCacheEntry({ status: 'optimized', bytesWritten: 1, meta: null }),
    false,
  )
})
