/** Options for {@linkcode buildServiceWorkerSource}. */
export interface ServiceWorkerSourceOptions {
  /** URLs to precache at `install` time — this app's real, hashed stylesheet(s), so the shell
   * still looks right even on a fully offline first paint. */
  precacheUrls: string[]
  /** A route to also precache and serve for a failed navigation once the network is genuinely
   * unreachable and nothing else is cached. `null` for no offline fallback at all. */
  offlineFallback: string | null
}

/**
 * Generates a small, dependency-free service worker's own source — no `workbox-strategies`/
 * `generateSW`/`injectManifest`, since this framework's own build already knows exactly which
 * assets are the real app shell (unlike a generic tool, which would have to guess or precache
 * everything). Cache-first for anything already precached (or seen once), network-first for
 * navigations (so a live deploy is never masked by a stale cached page), falling back to the
 * offline fallback route only once both the network and the cache have nothing.
 *
 * A pure function — no filesystem/network access of its own. `pwaPlugin` is the only caller,
 * writing the returned string as this app's real `sw.js` build output.
 */
export function buildServiceWorkerSource(
  options: ServiceWorkerSourceOptions,
): string {
  const { precacheUrls, offlineFallback } = options

  return `
const PRECACHE = 'zanix-space-precache'
const PRECACHE_URLS = ${JSON.stringify(precacheUrls)}
const OFFLINE_FALLBACK = ${JSON.stringify(offlineFallback)}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then((cache) => {
      const urls = OFFLINE_FALLBACK ? PRECACHE_URLS.concat(OFFLINE_FALLBACK) : PRECACHE_URLS
      return cache.addAll(urls)
    }),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached
          if (OFFLINE_FALLBACK) return caches.match(OFFLINE_FALLBACK)
          return Response.error()
        })
      ),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request)),
  )
})
`.trim() + '\n'
}
