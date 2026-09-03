import { assert, assertEquals, assertRejects } from '@std/assert'
import {
  getPrefetchedFragment,
  resetPrefetchState,
  schedulePrefetch,
  setPrefetchTtlForTesting,
} from 'modules/client/prefetch.ts'
import { ORBIT_FRAGMENT_HEADER } from 'modules/router/orbit-protocol.ts'

// A plain `Deno.serve()`, deliberately — the prefetch cache (`schedulePrefetch`/
// `getPrefetchedFragment`) is a generic fetch-caching mechanism with zero dependency on
// `@zanix/space`'s own SSR pipeline; a real HTTP server is what it actually talks to, but which
// server framework serves it is irrelevant to what's under test here.

Deno.test(
  'schedulePrefetch: two calls for the SAME href, back to back, dedup to exactly one real request',
  async () => {
    resetPrefetchState()
    let requestCount = 0
    const server = Deno.serve({ port: 0, onListen: () => {} }, (req) => {
      requestCount++
      return new Response(`fragment for ${new URL(req.url).pathname}`)
    })
    try {
      const href = `http://localhost:${server.addr.port}/dedup`
      schedulePrefetch(href)
      schedulePrefetch(href) // same href, still fresh — must NOT trigger a second fetch

      const fragment = await getPrefetchedFragment(href)
      assertEquals(fragment, { html: 'fragment for /dedup', cspHeader: null })
      assertEquals(requestCount, 1)
    } finally {
      await server.shutdown()
    }
  },
)

Deno.test(
  'schedulePrefetch: sends the same ORBIT_FRAGMENT_HEADER a real Orbit navigation sends',
  async () => {
    resetPrefetchState()
    let sawHeader: string | null = null
    const server = Deno.serve({ port: 0, onListen: () => {} }, (req) => {
      sawHeader = req.headers.get(ORBIT_FRAGMENT_HEADER)
      return new Response('ok')
    })
    try {
      const href = `http://localhost:${server.addr.port}/header-check`
      schedulePrefetch(href)
      await getPrefetchedFragment(href)
      assertEquals(sawHeader, '1')
    } finally {
      await server.shutdown()
    }
  },
)

Deno.test(
  'schedulePrefetch: a genuinely new href beyond the concurrency cap is dropped silently — ' +
    'never fetched, never cached',
  async () => {
    resetPrefetchState()
    let requestCount = 0
    const server = Deno.serve({ port: 0, onListen: () => {} }, () => {
      requestCount++
      return new Response('ok')
    })
    try {
      const base = `http://localhost:${server.addr.port}`
      // 5 distinct hrefs, all scheduled synchronously — the cap is 4, so the 5th must be dropped.
      for (let i = 0; i < 5; i++) {
        schedulePrefetch(`${base}/link-${i}`)
      }

      // Let every accepted fetch actually resolve before asserting.
      await Promise.all(
        Array.from({ length: 4 }, (_, i) => getPrefetchedFragment(`${base}/link-${i}`)),
      )

      assertEquals(requestCount, 4)
      assertEquals(getPrefetchedFragment(`${base}/link-4`), undefined)
    } finally {
      await server.shutdown()
    }
  },
)

Deno.test(
  'schedulePrefetch: an expired entry is never served — getPrefetchedFragment already returns ' +
    'undefined for it BEFORE any new schedulePrefetch call happens, purely from TTL elapsing',
  async () => {
    resetPrefetchState()
    setPrefetchTtlForTesting(30)
    const server = Deno.serve({ port: 0, onListen: () => {} }, () => new Response('ok'))
    try {
      const href = `http://localhost:${server.addr.port}/ttl-unserved`
      schedulePrefetch(href)
      await getPrefetchedFragment(href) // let the real fetch settle first
      assert(getPrefetchedFragment(href), 'expected the fresh entry to still be reusable')

      await new Promise((resolve) => setTimeout(resolve, 60)) // past the 30ms TTL

      assertEquals(
        getPrefetchedFragment(href),
        undefined,
        'an expired entry must never be served, even with no new schedulePrefetch call yet',
      )
    } finally {
      await server.shutdown()
      resetPrefetchState() // restores the real TTL for every later test in this suite
    }
  },
)

Deno.test(
  'schedulePrefetch: an expired entry is treated as stale — a new call for the SAME href ' +
    'triggers a real second request instead of staying deduped forever',
  async () => {
    resetPrefetchState()
    setPrefetchTtlForTesting(30)
    let requestCount = 0
    const server = Deno.serve({ port: 0, onListen: () => {} }, () => {
      requestCount++
      return new Response('ok')
    })
    try {
      const href = `http://localhost:${server.addr.port}/ttl`
      schedulePrefetch(href)
      await getPrefetchedFragment(href)
      assertEquals(requestCount, 1)

      await new Promise((resolve) => setTimeout(resolve, 60)) // past the 30ms TTL

      schedulePrefetch(href)
      await getPrefetchedFragment(href)
      assertEquals(requestCount, 2)
    } finally {
      await server.shutdown()
      resetPrefetchState() // restores the real TTL for every later test in this suite
    }
  },
)

Deno.test(
  'schedulePrefetch: a REJECTED entry is evicted IMMEDIATELY — never reusable, not even for ' +
    "the rest of its own TTL window — so a real click always gets swapOutlet's own normal " +
    'live fetch instead of a guaranteed replay of a failure that may have been transient',
  async () => {
    resetPrefetchState() // real (long) TTL — proves eviction is immediate, not TTL-driven at all
    let requestCount = 0
    const server = Deno.serve({ port: 0, onListen: () => {} }, () => {
      requestCount++
      // Fails the first request, succeeds every one after — proves the SECOND attempt is a real,
      // independent fetch, not just the first rejected promise resurfacing.
      return requestCount === 1
        ? new Response('nope', { status: 500 })
        : new Response('fragment for real this time')
    })
    try {
      const href = `http://localhost:${server.addr.port}/rejected-eviction`
      schedulePrefetch(href)
      const firstPrefetched = getPrefetchedFragment(href)
      assert(firstPrefetched, 'expected schedulePrefetch to have populated the cache')
      await assertRejects(() => firstPrefetched)
      assertEquals(requestCount, 1)

      // No wait at all — still well within the real, un-shortened TTL.
      assertEquals(
        getPrefetchedFragment(href),
        undefined,
        'a failed prefetch must be evicted immediately, not linger as "fresh" until its own TTL',
      )

      // Exactly what swapOutlet itself would do next: getPrefetchedFragment returned undefined,
      // so a real click falls through to its own normal fetch — simulated here directly.
      schedulePrefetch(href)
      const fragment = await getPrefetchedFragment(href)
      assertEquals(fragment, { html: 'fragment for real this time', cspHeader: null })
      assertEquals(requestCount, 2)
    } finally {
      await server.shutdown()
    }
  },
)

Deno.test(
  'schedulePrefetch: a fetch that rejects for a reason OTHER than the response (e.g. a network ' +
    'error) is evicted the exact same way — eviction is keyed on rejection, not on status code',
  async () => {
    resetPrefetchState()
    // No server at all — every request to this port fails at the network level, not with a
    // real HTTP response, exercising the `fetch()` promise's own rejection path directly.
    const href = 'http://localhost:1/network-error'
    schedulePrefetch(href)
    const prefetched = getPrefetchedFragment(href)
    assert(prefetched, 'expected schedulePrefetch to have populated the cache')
    await assertRejects(() => prefetched)
    assertEquals(getPrefetchedFragment(href), undefined)
  },
)

Deno.test(
  'getPrefetchedFragment: a failed prefetch (non-2xx response) rejects, never throws ' +
    'synchronously — the same degrade swapOutlet already handles for an uncached fetch',
  async () => {
    resetPrefetchState()
    const server = Deno.serve(
      { port: 0, onListen: () => {} },
      () => new Response('nope', { status: 500 }),
    )
    try {
      const href = `http://localhost:${server.addr.port}/failing`
      schedulePrefetch(href)
      const prefetched = getPrefetchedFragment(href)
      assert(prefetched, 'expected schedulePrefetch to have populated the cache')
      await assertRejects(() => prefetched)
    } finally {
      await server.shutdown()
    }
  },
)

Deno.test('getPrefetchedFragment: undefined for an href that was never scheduled', () => {
  resetPrefetchState()
  assertEquals(getPrefetchedFragment('http://localhost:9/never-scheduled'), undefined)
})
