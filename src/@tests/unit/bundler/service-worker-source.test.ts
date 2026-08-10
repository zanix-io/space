import { assert, assertStringIncludes } from '@std/assert'
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
  const source = buildServiceWorkerSource({ precacheUrls: [], offlineFallback: null })

  assertStringIncludes(source, 'const OFFLINE_FALLBACK = null')
  new Function(source)
})

Deno.test('buildServiceWorkerSource: registers install/activate/fetch listeners', () => {
  const source = buildServiceWorkerSource({ precacheUrls: [], offlineFallback: null })

  assertStringIncludes(source, "self.addEventListener('install'")
  assertStringIncludes(source, "self.addEventListener('activate'")
  assertStringIncludes(source, "self.addEventListener('fetch'")
  assert(source.includes('self.skipWaiting()'))
  assert(source.includes('self.clients.claim()'))
})
