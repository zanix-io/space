import { assert, assertEquals, assertMatch, assertThrows } from '@std/assert'
import { InternalError } from '@zanix/errors'
import { renderToReadableStream } from 'react-dom/server'
import { renderToResponse, useRequestCache } from '../../../../mod-react.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'

console.error = () => {}

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

    assertEquals(
      calls,
      1,
      'the fetcher must run once for the whole request, not once per reader',
    )
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

    assert(reported instanceof InternalError)
    assertMatch(
      reported.message,
      /useRequestCache.*renderToResponse/,
    )
    assertEquals(reported.code, 'SPACE_RENDER_REQUEST_CACHE_OUTSIDE_TREE')
  },
)

Deno.test(
  'useRequestCache: renderer=preact fails synchronously, before the fetcher or the cache are ever touched',
  () => {
    setActiveRenderer('preact')
    let fetcherCalled = false
    // A plain, direct call (not through any renderer) — this guard has to fire before React's own
    // `useContext` is ever reached (see `request-cache.tsx`'s own doc for why: calling it during a
    // Preact render throws React's own confusing "Invalid hook call" instead), so it must behave
    // identically whether or not a real component is involved.
    function Reader() {
      return useRequestCache('key', () => {
        fetcherCalled = true
        return Promise.resolve('value')
      })
    }
    try {
      const thrown = assertThrows(() => Reader(), InternalError)
      assertMatch(thrown.message, /--renderer=preact/)
      assertMatch(thrown.message, /Suspense/)
      assertEquals(thrown.code, 'SPACE_RENDER_REQUEST_CACHE_UNAVAILABLE_PREACT')
      assertEquals(
        fetcherCalled,
        false,
        'the fetcher must never run once the guard rejects the call',
      )
    } finally {
      // Real singleton, shared with every other test in this suite — never leave it on 'preact'.
      setActiveRenderer('react')
    }
  },
)

Deno.test(
  'useRequestCache: renderer=react (default) is unaffected by the preact guard — zero regression',
  async () => {
    // No `setActiveRenderer` call here at all — this is the framework's own default, unchanged,
    // exercised the same way the very first test in this file already does.
    let calls = 0
    function Reader() {
      const value = useRequestCache('regression-key', () => {
        calls++
        return Promise.resolve('still-works')
      })
      return <span>{value}</span>
    }

    const html = stripHydrationComments(
      await (await renderToResponse(<Reader />)).text(),
    )
    assertEquals(calls, 1)
    assert(html.includes('still-works'))
  },
)
