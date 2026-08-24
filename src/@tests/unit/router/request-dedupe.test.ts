import { assert, assertEquals, assertStrictEquals } from '@std/assert'
import { createDedupeCache } from 'modules/router/request-dedupe.ts'

Deno.test(
  'createDedupeCache: two calls with the SAME key run the fetcher only ONCE, both callers get ' +
    'the same resolved value',
  async () => {
    let calls = 0
    const dedupe = createDedupeCache()
    const fetcher = () => {
      calls++
      return Promise.resolve('value')
    }

    const [a, b] = await Promise.all([
      dedupe('user', fetcher),
      dedupe('user', fetcher),
    ])

    assertEquals(a, 'value')
    assertEquals(b, 'value')
    assertEquals(calls, 1)
  },
)

Deno.test('createDedupeCache: different keys each run their own fetcher', async () => {
  const dedupe = createDedupeCache()

  const a = await dedupe('a', () => Promise.resolve('value-a'))
  const b = await dedupe('b', () => Promise.resolve('value-b'))

  assertEquals(a, 'value-a')
  assertEquals(b, 'value-b')
})

Deno.test(
  'createDedupeCache: a rejection is cached too — a second call for the same key gets the ' +
    'identical rejection instead of retrying the fetcher',
  async () => {
    let calls = 0
    const dedupe = createDedupeCache()
    const fetcher = () => {
      calls++
      return Promise.reject(new Error('boom'))
    }

    let firstError: unknown
    let secondError: unknown
    try {
      await dedupe('key', fetcher)
    } catch (error) {
      firstError = error
    }
    try {
      await dedupe('key', fetcher)
    } catch (error) {
      secondError = error
    }

    assert(firstError instanceof Error && firstError.message === 'boom')
    assertStrictEquals(firstError, secondError)
    assertEquals(calls, 1)
  },
)

Deno.test(
  'createDedupeCache: two SEPARATE caches never share state — calling it twice (as ' +
    '`toPageContext` does, once per request) starts a brand new, empty cache each time',
  async () => {
    let calls = 0
    const fetcher = () => {
      calls++
      return Promise.resolve('value')
    }

    await createDedupeCache()('key', fetcher)
    await createDedupeCache()('key', fetcher)

    assertEquals(calls, 2)
  },
)
