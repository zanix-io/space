/** Options for {@linkcode buildServiceWorkerSource}. */
export interface ServiceWorkerSourceOptions {
  /** URLs to precache at `install` time — this app's real, hashed stylesheet(s), so the shell
   * still looks right even on a fully offline first paint. */
  precacheUrls: string[]
  /** A route to also precache and serve for a failed navigation once the network is genuinely
   * unreachable and nothing else is cached. `null` for no offline fallback at all. */
  offlineFallback: string | null
  /** Adds the `push` and `notificationclick` handlers. Omit for a worker that shows no
   * notification. */
  push?: {
    /** Title of the notification for a push without a usable payload. */
    fallbackTitle: string
    /** Where a click opens when the payload has no same-origin `url`. */
    defaultUrl: string
    /** Icon of a notification whose payload names none. Omit for the browser's own default. */
    iconUrl?: string
  }
  /** Source of an app's own classic script, appended after the generated handlers. */
  extraScript?: string
  /** `false` omits the precache and the `fetch` handler, leaving a worker that only takes control
   * of its pages and runs the push/`extraScript` logic. A worker that caches would hide an edit
   * from the developer who just made it, so a worker served without a client build uses this.
   * @default true */
  caching?: boolean
}

/**
 * Generates a small, dependency-free service worker's own source — no `workbox-strategies`/
 * `generateSW`/`injectManifest`, since this framework's own build already knows exactly which
 * assets are the real app shell (unlike a generic tool, which would have to guess or precache
 * everything). Cache-first for anything already precached, network-first for navigations (so a
 * live deploy is never masked by a stale cached page), falling back to the offline fallback route
 * only once both the network and the cache have nothing.
 *
 * Anything NOT precached at `install` (every JS bundle Vite emits — `precacheUrls` only ever
 * carries CSS, see `pwaPlugin`'s own comment for why) is still written to the same cache the first
 * time it's actually fetched — "cache falling back to network, then cache the response" — so an
 * app's own hydration bundle survives a later fully-offline visit instead of only ever living in
 * the browser's separate, unreliable disk cache. Only a successful (`response.ok`) response is
 * cached, so a transient failure is never remembered as if it were the real asset.
 *
 * A pure function — no filesystem/network access of its own. `pwaPlugin` writes the returned
 * string as this app's real `sw.js` build output, and `registerPwa` serves it directly, uncached,
 * when the app has no client build output.
 */
export function buildServiceWorkerSource(
  options: ServiceWorkerSourceOptions,
): string {
  const { precacheUrls, offlineFallback, push, extraScript, caching = true } = options

  const base = caching ? buildBaseSource(precacheUrls, offlineFallback) : buildLifecycleSource()
  return `${base}${push ? buildPushSource(push) : ''}${
    extraScript ? buildExtraSource(extraScript) : ''
  }`.trim() + '\n'
}

/** A worker that only takes control of its pages: no precache, no `fetch` handler. */
function buildLifecycleSource(): string {
  return `
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})
`
}

/** The install/activate/fetch handlers every generated worker has. */
function buildBaseSource(precacheUrls: string[], offlineFallback: string | null): string {
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
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(PRECACHE).then((cache) => cache.put(request, clone))
        }
        return response
      })
    }),
  )
})
`
}

/** The `push` and `notificationclick` handlers. A push always ends in a visible notification,
 * whatever its payload, because browsers penalise or revoke a subscription whose pushes show
 * nothing; a click target is only ever a same-origin URL. */
function buildPushSource(push: NonNullable<ServiceWorkerSourceOptions['push']>): string {
  return `
const PUSH = ${JSON.stringify(push)}

self.addEventListener('push', (event) => {
  let payload = null
  try {
    payload = event.data ? event.data.json() : null
  } catch (_) {
    payload = null
  }
  const usable = payload !== null && typeof payload === 'object' && typeof payload.title === 'string' &&
    payload.title !== ''
  const source = usable ? payload : {}
  const text = (value) => (typeof value === 'string' ? value : undefined)

  event.waitUntil(
    self.registration.showNotification(usable ? payload.title : PUSH.fallbackTitle, {
      body: text(source.body),
      tag: text(source.tag),
      icon: text(source.icon) || PUSH.iconUrl,
      badge: text(source.badge),
      data: { url: text(source.url) || null },
    }),
  )
})

function resolveNotificationTarget(url) {
  try {
    const target = new URL(url || PUSH.defaultUrl, self.location.origin)
    if (target.origin === self.location.origin) return target.href
  } catch (_) {
    // A malformed URL falls through to the site root.
  }
  return new URL('/', self.location.origin).href
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = resolveNotificationTarget(event.notification.data && event.notification.data.url)

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url === target)
      return open ? open.focus() : self.clients.openWindow(target)
    }),
  )
})
`
}

/** An app's own script, wrapped in a function scope so a `const` it declares can never collide
 * with one the generated worker declares, or the other way round. */
function buildExtraSource(script: string): string {
  return `
;(() => {
${script}
})()
`
}
