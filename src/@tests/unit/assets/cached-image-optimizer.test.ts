import { assertEquals } from '@std/assert'
import { createCachedImageOptimizer } from 'modules/assets/cached-image-optimizer.ts'
import { createInMemoryTransformCacheStore } from 'modules/assets/transform-cache-store.ts'
import { hashSourceBytes } from 'modules/assets/transform-cache.ts'
import type { OptimizedAssetEntry } from 'modules/assets/image-optimize.ts'
import type { OptimizeImageAssetFn } from 'modules/assets/cached-image-optimizer.ts'

/** A fake `optimizeImageAsset` — never touches real `sharp`. `calls` counts real invocations. */
function createFakeOptimize() {
  const calls = { count: 0 }
  const optimize: OptimizeImageAssetFn = (relativePath, source) => {
    calls.count++
    const entries: OptimizedAssetEntry[] = [
      { relativePath, bytes: new Uint8Array([...source, 0xaa]) },
      { relativePath: `${relativePath}.webp`, bytes: new Uint8Array([...source, 0xbb]) },
    ]
    return Promise.resolve(entries)
  }
  return { optimize, calls }
}

Deno.test(
  'cachedOptimizeImageAsset: same source + same policy -> the second call makes ZERO real optimize calls',
  async () => {
    const { optimize, calls } = createFakeOptimize()
    const cached = createCachedImageOptimizer(optimize, createInMemoryTransformCacheStore())
    const source = new Uint8Array([1, 2, 3, 4])

    const first = await cached('img/hero.jpg', source, { breakpoints: ['msm'] })
    const second = await cached('img/hero.jpg', source, { breakpoints: ['msm'] })

    assertEquals(calls.count, 1, 'the real optimizer must be called exactly once')
    assertEquals(second, first)
  },
)

Deno.test('cachedOptimizeImageAsset: a changed SOURCE reprocesses', async () => {
  const { optimize, calls } = createFakeOptimize()
  const cached = createCachedImageOptimizer(optimize, createInMemoryTransformCacheStore())

  await cached('img/hero.jpg', new Uint8Array([1, 2, 3]), { breakpoints: ['msm'] })
  assertEquals(calls.count, 1)
  await cached('img/hero.jpg', new Uint8Array([9, 9, 9]), { breakpoints: ['msm'] })
  assertEquals(calls.count, 2, 'a changed source must trigger a real reprocess')
})

Deno.test('cachedOptimizeImageAsset: a changed POLICY VERSION reprocesses', async () => {
  const { optimize, calls } = createFakeOptimize()
  const store = createInMemoryTransformCacheStore()
  const source = new Uint8Array([1, 2, 3])

  const cachedV1 = createCachedImageOptimizer(optimize, store, 'v1')
  await cachedV1('img/hero.jpg', source, { breakpoints: ['msm'] })
  assertEquals(calls.count, 1)

  const cachedV2 = createCachedImageOptimizer(optimize, store, 'v2')
  await cachedV2('img/hero.jpg', source, { breakpoints: ['msm'] })
  assertEquals(calls.count, 2, 'a policy version bump must trigger a real reprocess')
})

Deno.test('cachedOptimizeImageAsset: a changed BREAKPOINT set reprocesses', async () => {
  const { optimize, calls } = createFakeOptimize()
  const cached = createCachedImageOptimizer(optimize, createInMemoryTransformCacheStore())
  const source = new Uint8Array([1, 2, 3])

  await cached('img/hero.jpg', source, { breakpoints: ['msm'] })
  assertEquals(calls.count, 1)
  await cached('img/hero.jpg', source, { breakpoints: ['msm', 'dlg'] })
  assertEquals(calls.count, 2, 'a different breakpoint set must trigger a real reprocess')
})

Deno.test('cachedOptimizeImageAsset: a changed FORMAT set reprocesses', async () => {
  const { optimize, calls } = createFakeOptimize()
  const cached = createCachedImageOptimizer(optimize, createInMemoryTransformCacheStore())
  const source = new Uint8Array([1, 2, 3])

  await cached('img/hero.jpg', source, { formats: ['webp'] })
  assertEquals(calls.count, 1)
  await cached('img/hero.jpg', source, { formats: ['avif'] })
  assertEquals(calls.count, 2, 'a different format set must trigger a real reprocess')
})

Deno.test('cachedOptimizeImageAsset: a changed QUALITY reprocesses', async () => {
  const { optimize, calls } = createFakeOptimize()
  const cached = createCachedImageOptimizer(optimize, createInMemoryTransformCacheStore())
  const source = new Uint8Array([1, 2, 3])

  await cached('img/hero.jpg', source, { quality: { msm: 80 } })
  assertEquals(calls.count, 1)
  await cached('img/hero.jpg', source, { quality: { msm: 60 } })
  assertEquals(calls.count, 2, 'a different quality must trigger a real reprocess')
})

Deno.test('cachedOptimizeImageAsset: a changed WIDTH reprocesses', async () => {
  const { optimize, calls } = createFakeOptimize()
  const cached = createCachedImageOptimizer(optimize, createInMemoryTransformCacheStore())
  const source = new Uint8Array([1, 2, 3])

  await cached('img/hero.jpg', source, { width: { msm: 800 } })
  assertEquals(calls.count, 1)
  await cached('img/hero.jpg', source, { width: { msm: 400 } })
  assertEquals(calls.count, 2, 'a different width must trigger a real reprocess')
})

Deno.test(
  'cachedOptimizeImageAsset: breakpoint/format ORDER never matters (deterministic transformId)',
  async () => {
    const { optimize, calls } = createFakeOptimize()
    const cached = createCachedImageOptimizer(optimize, createInMemoryTransformCacheStore())
    const source = new Uint8Array([1, 2, 3])

    await cached('img/hero.jpg', source, { breakpoints: ['msm', 'dlg'], formats: ['webp', 'avif'] })
    assertEquals(calls.count, 1)
    await cached('img/hero.jpg', source, { breakpoints: ['dlg', 'msm'], formats: ['avif', 'webp'] })
    assertEquals(calls.count, 1, 'the same sets in a different order must still be a cache hit')
  },
)

Deno.test(
  'cachedOptimizeImageAsset: the bare `true` shape and an empty-options-object are the SAME transform',
  async () => {
    const { optimize, calls } = createFakeOptimize()
    const cached = createCachedImageOptimizer(optimize, createInMemoryTransformCacheStore())
    const source = new Uint8Array([1, 2, 3])

    await cached('img/hero.jpg', source, true)
    assertEquals(calls.count, 1)
    await cached('img/hero.jpg', source, {})
    assertEquals(
      calls.count,
      1,
      '`true` and `{}` both mean "no breakpoints/formats" — same transform',
    )
  },
)

Deno.test(
  'cachedOptimizeImageAsset: a corrupt/incompatible cache entry (an output missing from the store) recomputes safely',
  async () => {
    const { optimize, calls } = createFakeOptimize()
    const store = createInMemoryTransformCacheStore()
    const cached = createCachedImageOptimizer(optimize, store)
    const source = new Uint8Array([1, 2, 3])

    await cached('img/hero.jpg', source, { breakpoints: ['msm'] })
    assertEquals(calls.count, 1)

    // Simulate the index claiming an output that was never actually persisted to the byte store.
    const sourceHash = await hashSourceBytes(source)
    const key = `${sourceHash}:image:bp[msm]:fmt[]:v1`
    await store.setEntry(key, {
      status: 'optimized',
      bytesWritten: 1,
      outputs: ['img/hero.jpg', 'img/hero.msm.jpg', 'a-phantom-output-never-stored.jpg'],
    })

    await cached('img/hero.jpg', source, { breakpoints: ['msm'] })
    assertEquals(calls.count, 2, 'a missing output must abandon the hit and recompute for real')
  },
)

Deno.test(
  'cachedOptimizeImageAsset: an unsupported source format (still one real entry) is cached like any other result',
  async () => {
    const calls = { count: 0 }
    const optimize: OptimizeImageAssetFn = (relativePath, source) => {
      calls.count++
      return Promise.resolve([{ relativePath, bytes: source }])
    }
    const cached = createCachedImageOptimizer(optimize, createInMemoryTransformCacheStore())
    const source = new Uint8Array([1, 2, 3])

    const first = await cached('img/anim.gif', source, { breakpoints: ['msm'] })
    const second = await cached('img/anim.gif', source, { breakpoints: ['msm'] })
    assertEquals(calls.count, 1)
    assertEquals(second, first)
  },
)
