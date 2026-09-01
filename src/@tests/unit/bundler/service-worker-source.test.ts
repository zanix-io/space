import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { buildServiceWorkerSource } from 'modules/bundler/service-worker-source.ts'

Deno.test('buildServiceWorkerSource: produces syntactically valid JavaScript', () => {
  const source = buildServiceWorkerSource({
    precacheUrls: ['/assets/app-hash123.css'],
    offlineFallback: '/offline',
  })

  // `new Function` parses `source` as a function body — throws SyntaxError on malformed JS,
  // without needing a real ServiceWorkerGlobalScope (`self`/`caches`) to actually run it.
  new Function(source)
})

Deno.test(
  'buildServiceWorkerSource: embeds the precache URLs and offline fallback verbatim',
  () => {
    const source = buildServiceWorkerSource({
      precacheUrls: ['/assets/app-hash123.css', '/assets/vendor-hash456.css'],
      offlineFallback: '/offline',
    })

    assertStringIncludes(
      source,
      JSON.stringify(['/assets/app-hash123.css', '/assets/vendor-hash456.css']),
    )
    assertStringIncludes(source, JSON.stringify('/offline'))
  },
)

Deno.test('buildServiceWorkerSource: null offline fallback is embedded as literal null', () => {
  const source = buildServiceWorkerSource({
    precacheUrls: [],
    offlineFallback: null,
  })

  assertStringIncludes(source, 'const OFFLINE_FALLBACK = null')
  new Function(source)
})

Deno.test('buildServiceWorkerSource: registers install/activate/fetch listeners', () => {
  const source = buildServiceWorkerSource({
    precacheUrls: [],
    offlineFallback: null,
  })

  assertStringIncludes(source, "self.addEventListener('install'")
  assertStringIncludes(source, "self.addEventListener('activate'")
  assertStringIncludes(source, "self.addEventListener('fetch'")
  assert(source.includes('self.skipWaiting()'))
  assert(source.includes('self.clients.claim()'))
})

/**
 * A minimal fake `ServiceWorkerGlobalScope` — just enough of `self`/`caches`/`fetch` for the
 * generated source (evaluated via `new Function`, the same technique the tests above already use
 * to parse it) to actually run its real `install`/`fetch` listeners, not merely parse as valid JS.
 * `self.addEventListener` records handlers by event type; the fake `Cache` is a plain `Map` keyed
 * by request URL, mirroring the real Cache Storage API's `addAll`/`match`/`put` surface closely
 * enough for this fetch-handler behavior (nothing else the generated source calls is exercised).
 */
function runServiceWorker(
  source: string,
  networkFetch: (request: Request) => Promise<Response>,
) {
  const listeners = new Map<string, (event: unknown) => void>()
  const store = new Map<string, Response>()

  // Real Cache Storage resolves a relative `addAll`/`match` URL against the service worker's own
  // location before keying its store — mirrored here against a fixed base so a relative
  // `precacheUrls` entry (as `pwaPlugin` always emits) and an absolute `request.url` (as a real
  // `fetch` event always carries) key the same store entry, same as the real API.
  const resolve = (input: Request | string) =>
    new URL(typeof input === 'string' ? input : input.url, 'https://example.test').href

  const fakeSelf = {
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      listeners.set(type, handler)
    },
    skipWaiting: () => {},
    clients: { claim: () => {} },
  }
  const fakeCache = {
    addAll: (urls: string[]) => {
      for (const url of urls) store.set(resolve(url), new Response(`precached:${url}`))
      return Promise.resolve()
    },
    match: (request: Request | string) => Promise.resolve(store.get(resolve(request))),
    put: (request: Request | string, response: Response) => {
      store.set(resolve(request), response)
      return Promise.resolve()
    },
  }
  const fakeCaches = {
    open: () => Promise.resolve(fakeCache),
    match: (request: Request | string) => fakeCache.match(request),
  }

  // deno-lint-ignore no-explicit-any
  const factory = new Function('self', 'caches', 'fetch', source) as (...args: any[]) => void
  factory(fakeSelf, fakeCaches, networkFetch)

  return {
    store,
    install: async () => {
      const handler = listeners.get('install')
      if (!handler) throw new Error('install listener was never registered')
      let waitUntil: Promise<unknown> = Promise.resolve()
      handler({ waitUntil: (p: Promise<unknown>) => (waitUntil = p) })
      await waitUntil
    },
    dispatchFetch: async (request: Request): Promise<Response> => {
      const handler = listeners.get('fetch')
      if (!handler) throw new Error('fetch listener was never registered')
      let responded: Promise<Response> | undefined
      handler({
        request,
        mode: request.mode,
        respondWith: (p: Promise<Response>) => (responded = p),
      })
      if (!responded) throw new Error('fetch handler never called event.respondWith')
      return await responded
    },
  }
}

/**
 * `install` only ever precaches CSS (plus `offlineFallback`) — never the JS bundles Vite emits
 * (`client-entry-*.js` and any chunk), since `precacheUrls` is scanned only from `.css` chunks (see
 * `pwaPlugin`'s own comment for why). This verifies the fetch handler's own fallback path covers
 * that gap: a same-origin asset not precached at install still gets written to the same cache the
 * first time it's actually fetched, so the app's own hydration bundle survives a later fully
 * offline visit — masked in a normal browser session by the browser's own disk cache, which is why
 * this test drives the fake `caches`/`fetch` harness directly instead of relying on that.
 */
Deno.test(
  'buildServiceWorkerSource: fetch handler caches a non-precached asset (e.g. the JS hydration bundle) after serving it from the network once',
  async () => {
    const source = buildServiceWorkerSource({
      precacheUrls: ['/assets/app-hash123.css'],
      offlineFallback: null,
    })

    let networkFetchCount = 0
    const sw = runServiceWorker(source, (request) => {
      networkFetchCount++
      assertEquals(request.url, 'https://example.test/assets/client-entry-abc123.js')
      return Promise.resolve(new Response('js-bundle-content', { status: 200 }))
    })
    await sw.install()

    const request = new Request('https://example.test/assets/client-entry-abc123.js')
    const response = await sw.dispatchFetch(request)

    assertEquals(await response.text(), 'js-bundle-content')
    assertEquals(networkFetchCount, 1)

    // The real bug: the JS bundle was served but never written to Cache Storage, so a later
    // offline fetch for the exact same URL had nothing to fall back to.
    const cached = await sw.store.get(request.url)
    assert(cached, 'expected the JS bundle to be cached after being served from the network')
    assertEquals(await cached.clone().text(), 'js-bundle-content')
  },
)

Deno.test(
  'buildServiceWorkerSource: fetch handler does not cache a non-ok network response',
  async () => {
    const source = buildServiceWorkerSource({ precacheUrls: [], offlineFallback: null })

    const sw = runServiceWorker(
      source,
      () => Promise.resolve(new Response('not found', { status: 404 })),
    )
    await sw.install()

    const request = new Request('https://example.test/assets/missing-chunk.js')
    const response = await sw.dispatchFetch(request)

    assertEquals(response.status, 404)
    assertEquals(sw.store.has(request.url), false)
  },
)

Deno.test(
  'buildServiceWorkerSource: fetch handler still serves an already-precached asset from cache without touching the network',
  async () => {
    const source = buildServiceWorkerSource({
      precacheUrls: ['/assets/app-hash123.css'],
      offlineFallback: null,
    })

    let networkFetchCount = 0
    const sw = runServiceWorker(source, () => {
      networkFetchCount++
      return Promise.resolve(new Response('network-should-not-be-called'))
    })
    await sw.install()

    const response = await sw.dispatchFetch(
      new Request('https://example.test/assets/app-hash123.css'),
    )

    assertEquals(await response.text(), 'precached:/assets/app-hash123.css')
    assertEquals(networkFetchCount, 0)
  },
)
