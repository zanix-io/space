import { assert, assertEquals, assertFalse, assertStringIncludes } from '@std/assert'
import { buildServiceWorkerSource } from 'modules/bundler/service-worker-source.ts'
import type { ServiceWorkerSourceOptions } from 'modules/bundler/service-worker-source.ts'

const ORIGIN = 'https://example.test'

const PUSH = {
  fallbackTitle: 'Storefront',
  defaultUrl: '/home',
  iconUrl: '/icons/icon-192.png',
} satisfies NonNullable<ServiceWorkerSourceOptions['push']>

type Shown = { title: string; options: Record<string, unknown> }

/**
 * A minimal fake `ServiceWorkerGlobalScope` for the generated source, evaluated via `new Function`:
 * `self.addEventListener` records handlers by event type, `self.registration.showNotification`
 * records what a push displays, and `self.clients` records which window a click focuses or opens.
 * Only what the push handlers call is faked; the cache and fetch surface is the concern of
 * `service-worker-source.test.ts`.
 */
function runWorker(source: string, openWindows: { url: string; focus: () => void }[] = []) {
  const listeners = new Map<string, (event: unknown) => void>()
  const shown: Shown[] = []
  const opened: string[] = []

  const fakeSelf = {
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      listeners.set(type, handler)
    },
    skipWaiting: () => {},
    location: { origin: ORIGIN },
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options })
        return Promise.resolve()
      },
    },
    clients: {
      claim: () => {},
      matchAll: () => Promise.resolve(openWindows),
      openWindow: (url: string) => {
        opened.push(url)
        return Promise.resolve()
      },
    },
  }

  new Function('self', 'caches', 'fetch', source)(fakeSelf, {}, () => {})

  const dispatch = async (type: string, event: Record<string, unknown>) => {
    const handler = listeners.get(type)
    if (!handler) throw new Error(`no ${type} listener was registered`)
    let pending: Promise<unknown> = Promise.resolve()
    handler({ ...event, waitUntil: (promise: Promise<unknown>) => (pending = promise) })
    await pending
  }

  return {
    listeners,
    shown,
    opened,
    push: (data: { json: () => unknown } | null) => dispatch('push', { data }),
    click: async (url: string | null | undefined) => {
      let closed = false
      await dispatch('notificationclick', {
        notification: {
          data: url === undefined ? undefined : { url },
          close: () => (closed = true),
        },
      })
      return closed
    },
  }
}

const withPush = (extra: Partial<ServiceWorkerSourceOptions> = {}) =>
  buildServiceWorkerSource({ precacheUrls: [], offlineFallback: null, push: PUSH, ...extra })

Deno.test('service worker push: a worker without `push` registers no push listener', () => {
  const source = buildServiceWorkerSource({ precacheUrls: [], offlineFallback: null })

  assertFalse(source.includes("'push'"))
  assertFalse(source.includes("'notificationclick'"))
  assertFalse(runWorker(source).listeners.has('push'))
})

Deno.test('service worker push: registers push and notificationclick listeners', () => {
  const sw = runWorker(withPush())

  assert(sw.listeners.has('push'))
  assert(sw.listeners.has('notificationclick'))
})

Deno.test('service worker push: shows the payload as a notification', async () => {
  const sw = runWorker(withPush())

  await sw.push({
    json: () => ({
      title: 'Gesture received',
      body: 'Someone thought of you',
      tag: 'gesture-1',
      url: '/es/gestures',
      badge: '/badge.png',
    }),
  })

  assertEquals(sw.shown, [{
    title: 'Gesture received',
    options: {
      body: 'Someone thought of you',
      tag: 'gesture-1',
      icon: PUSH.iconUrl,
      badge: '/badge.png',
      data: { url: '/es/gestures' },
    },
  }])
})

Deno.test('service worker push: a payload icon replaces the default icon', async () => {
  const sw = runWorker(withPush())

  await sw.push({ json: () => ({ title: 'Hi', icon: '/custom.png' }) })

  assertEquals(sw.shown[0].options.icon, '/custom.png')
})

Deno.test(
  'service worker push: a push with no payload, non-JSON, or an unusable title shows the fallback',
  async () => {
    const sw = runWorker(withPush())
    const unparseable = {
      json: () => {
        throw new SyntaxError('Unexpected token')
      },
    }

    await sw.push(null)
    await sw.push(unparseable)
    await sw.push({ json: () => ({ title: '' }) })
    await sw.push({ json: () => ({ title: 42 }) })
    await sw.push({ json: () => 'plain string' })
    await sw.push({ json: () => null })

    assertEquals(sw.shown.length, 6)
    for (const { title, options } of sw.shown) {
      assertEquals(title, 'Storefront')
      assertEquals(options.body, undefined)
      assertEquals(options.data, { url: null })
      assertEquals(options.icon, PUSH.iconUrl)
    }
  },
)

Deno.test('service worker push: a non-string payload field is dropped, not forwarded', async () => {
  const sw = runWorker(withPush())

  await sw.push({ json: () => ({ title: 'Hi', body: { nested: true }, url: 7, tag: ['x'] }) })

  assertEquals(sw.shown[0].options.body, undefined)
  assertEquals(sw.shown[0].options.tag, undefined)
  assertEquals(sw.shown[0].options.data, { url: null })
})

Deno.test('service worker push: a click closes the notification and opens its same-origin url', async () => {
  const sw = runWorker(withPush())

  const closed = await sw.click('/es/gestures?from=push')

  assert(closed)
  assertEquals(sw.opened, [`${ORIGIN}/es/gestures?from=push`])
})

Deno.test('service worker push: a click without a url opens the configured default', async () => {
  const sw = runWorker(withPush())

  await sw.click(null)
  await sw.click(undefined)

  assertEquals(sw.opened, [`${ORIGIN}/home`, `${ORIGIN}/home`])
})

Deno.test('service worker push: a click never opens another origin', async () => {
  const sw = runWorker(withPush())

  await sw.click('https://evil.example/phish')
  await sw.click('//evil.example/phish')
  await sw.click('javascript:alert(1)')

  assertEquals(sw.opened, [ORIGIN + '/', ORIGIN + '/', ORIGIN + '/'])
})

Deno.test('service worker push: a click on a malformed url falls back to the site root', async () => {
  const sw = runWorker(withPush())

  await sw.click('http://')

  assertEquals(sw.opened, [`${ORIGIN}/`])
})

Deno.test('service worker push: a click focuses a window already on the target instead of opening one', async () => {
  let focused = false
  const sw = runWorker(withPush(), [
    { url: `${ORIGIN}/other`, focus: () => {} },
    { url: `${ORIGIN}/es/gestures`, focus: () => (focused = true) },
  ])

  await sw.click('/es/gestures')

  assert(focused)
  assertEquals(sw.opened, [])
})

Deno.test('service worker extra script: runs after the generated handlers', async () => {
  const sw = runWorker(
    withPush({
      push: undefined,
      extraScript: "self.addEventListener('push', (event) => event.waitUntil(" +
        "self.registration.showNotification('from the app script', {})))",
    }),
  )

  await sw.push(null)

  assertEquals(sw.shown.map((entry) => entry.title), ['from the app script'])
})

Deno.test('service worker extra script: its declarations never collide with the generated worker', () => {
  const source = withPush({
    extraScript:
      "const PRECACHE = 'mine'\nconst PUSH = 'mine'\nfunction resolveNotificationTarget() {}",
  })

  // Redeclaring a top-level `const` of the generated worker is a SyntaxError unless wrapped.
  runWorker(source)
})

Deno.test('service worker extra script: a trailing line comment does not swallow the wrapper', () => {
  const source = withPush({ extraScript: '// nothing to do' })

  assertStringIncludes(source, '// nothing to do\n})()')
  runWorker(source)
})

Deno.test('service worker without caching: takes control of its pages and touches no cache', async () => {
  const source = withPush({ caching: false, push: { ...PUSH, iconUrl: undefined } })

  // `runWorker` hands the worker an empty `caches`, so any cache access would throw.
  const sw = runWorker(source)

  assertEquals([...sw.listeners.keys()].sort(), [
    'activate',
    'install',
    'notificationclick',
    'push',
  ])
  assertFalse(source.includes('caches.'))
  assertFalse(source.includes('PRECACHE'))

  await sw.push({ json: () => ({ title: 'Hi' }) })
  assertEquals(sw.shown[0].options.icon, undefined)
})

Deno.test('service worker without caching: is valid JavaScript with no push and no script', () => {
  const source = buildServiceWorkerSource({
    precacheUrls: ['/ignored.css'],
    offlineFallback: '/ignored',
    caching: false,
  })

  new Function(source)
  assertFalse(source.includes('/ignored'))
  assertStringIncludes(source, 'self.skipWaiting()')
  assertStringIncludes(source, 'self.clients.claim()')
})
