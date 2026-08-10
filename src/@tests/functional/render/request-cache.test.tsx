import { assert, assertEquals, assertMatch } from '@std/assert'
import { renderToReadableStream } from 'react-dom/server'
import { renderToResponse, useRequestCache } from 'modules/render/mod.ts'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'

Deno.test(
  'useRequestCache: same key across components resolves via a single fetcher call',
  async () => {
    let calls = 0
    const fetcher = () => {
      calls++
      return Promise.resolve('value')
    }

    function Reader({ id }: { id: string }) {
      const value = useRequestCache('shared-key', fetcher)
      return (
        <span>
          {id}:{value}
        </span>
      )
    }

    const response = await renderToResponse(
      <>
        <Reader id='a' />
        <Reader id='b' />
      </>,
    )
    const html = stripHydrationComments(await response.text())

    assertEquals(calls, 1, 'the fetcher must run once for the whole request, not once per reader')
    assert(html.includes('a:value'))
    assert(html.includes('b:value'))
  },
)

Deno.test('useRequestCache: different keys each get their own fetcher call', async () => {
  const seen: string[] = []
  function Reader({ id }: { id: string }) {
    const value = useRequestCache(`key-${id}`, () => {
      seen.push(id)
      return Promise.resolve(id)
    })
    return <span>{value}</span>
  }

  await (await renderToResponse(
    <>
      <Reader id='a' />
      <Reader id='b' />
    </>,
  )).text()

  assertEquals(seen.toSorted(), ['a', 'b'])
})

Deno.test(
  'useRequestCache: throws when rendered without a RequestCacheProvider ancestor',
  async () => {
    function Reader() {
      useRequestCache('key', () => Promise.resolve('value'))
      return null
    }

    let reported: unknown
    try {
      // No RequestCacheProvider ancestor here (unlike renderToResponse, which always adds one) —
      // the missing-provider error has no Suspense boundary to be recoverable under, so it breaks
      // the shell and rejects this call's own promise, in addition to reaching `onError` below.
      await renderToReadableStream(<Reader />, {
        onError: (error) => {
          reported = error
        },
      })
    } catch {
      // Expected — see comment above; the assertions below are what this test actually verifies.
    }

    assert(reported instanceof Error)
    assertMatch((reported as Error).message, /useRequestCache.*renderToResponse/)
  },
)
