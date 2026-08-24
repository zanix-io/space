import { assert, assertEquals } from '@std/assert'
import { resolveSegmentData } from 'modules/router/segment-loader.ts'
import type { ResolvedSegment } from 'modules/router/page-tree-registry.ts'
import { mockPageContext } from 'modules/testing/mod.ts'

Deno.test(
  'resolveSegmentData: a segment with no loader resolves to undefined at its own index — never ' +
    'throws, never skipped (the array stays index-aligned with segments)',
  async () => {
    const segments: ResolvedSegment[] = [{}, {}]

    const data = await resolveSegmentData(segments, mockPageContext())

    assertEquals(data, [undefined, undefined])
  },
)

Deno.test(
  "resolveSegmentData: each segment's own loader receives the SAME ctx and its own resolved " +
    "value lands at its own index, root-first — matching segments' own storage order",
  async () => {
    const segments: ResolvedSegment[] = [
      { loader: () => 'root-data' },
      { loader: (ctx) => `nested-data:${ctx.params.id}` },
    ]
    const ctx = mockPageContext({ params: { id: 'p-1' } })

    const data = await resolveSegmentData(segments, ctx)

    assertEquals(data, ['root-data', 'nested-data:p-1'])
  },
)

Deno.test(
  'resolveSegmentData: every loader resolves in PARALLEL, never sequentially — two 40ms loaders ' +
    'settle in well under their combined 80ms, the exact "no waterfalls" property a single ' +
    'page-level loader already had, extended per segment',
  async () => {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    const segments: ResolvedSegment[] = [
      {
        loader: async () => {
          await delay(40)
          return 'a'
        },
      },
      {
        loader: async () => {
          await delay(40)
          return 'b'
        },
      },
      {
        loader: async () => {
          await delay(40)
          return 'c'
        },
      },
    ]

    const start = performance.now()
    const data = await resolveSegmentData(segments, mockPageContext())
    const elapsed = performance.now() - start

    assertEquals(data, ['a', 'b', 'c'])
    assert(elapsed < 80, `expected well under 120ms (3×40ms sequential), took ${elapsed}ms`)
  },
)

Deno.test(
  'resolveSegmentData: a segment loader that throws rejects the whole call — uncaught, exactly ' +
    "like a page's own loader throwing, no per-segment isolation",
  async () => {
    const segments: ResolvedSegment[] = [
      {
        loader: () => {
          throw new Error('fixture-loader-boom')
        },
      },
    ]

    let threw = false
    try {
      await resolveSegmentData(segments, mockPageContext())
    } catch (error) {
      threw = true
      assertEquals((error as Error).message, 'fixture-loader-boom')
    }
    assert(threw, 'expected resolveSegmentData to reject')
  },
)
