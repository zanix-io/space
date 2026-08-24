import { assert, assertEquals, assertThrows } from '@std/assert'
import { langPreHandler } from 'modules/middleware/lang-pre-handler.ts'

const info = {} as Deno.ServeHandlerInfo<Deno.NetAddr>

Deno.test(
  'langPreHandler: a path already prefixed with a valid lang falls through (null)',
  async () => {
    const handler = langPreHandler({ availableLangs: ['en', 'es'], defaultLang: 'en' })
    const result = await handler(new Request('http://localhost/en/products'), info)

    assertEquals(result, null)
  },
)

Deno.test(
  'langPreHandler: an un-prefixed path redirects to defaultLang, preserving the path',
  async () => {
    const handler = langPreHandler({ availableLangs: ['en', 'es'], defaultLang: 'en' })
    const result = await handler(new Request('http://localhost/products'), info)

    assert(result instanceof Response)
    assertEquals(result.status, 301)
    assertEquals(result.headers.get('Location'), 'http://localhost/en/products')
  },
)

Deno.test(
  'langPreHandler: the bare root redirects to /{defaultLang}, no trailing slash added',
  async () => {
    const handler = langPreHandler({ availableLangs: ['en', 'es'], defaultLang: 'en' })
    const result = await handler(new Request('http://localhost/'), info)

    assert(result instanceof Response)
    assertEquals(result.headers.get('Location'), 'http://localhost/en')
  },
)

Deno.test(
  "langPreHandler: a first segment that only LOOKS like a lang code but isn't configured is " +
    'treated as a real path segment, not stripped',
  async () => {
    const handler = langPreHandler({ availableLangs: ['en', 'es'], defaultLang: 'en' })
    const result = await handler(new Request('http://localhost/xx/products'), info)

    assert(result instanceof Response)
    assertEquals(result.headers.get('Location'), 'http://localhost/en/xx/products')
  },
)

Deno.test(
  'langPreHandler: Accept-Language resolves the redirect target when it names an available lang',
  async () => {
    const handler = langPreHandler({ availableLangs: ['en', 'es'], defaultLang: 'en' })
    const result = await handler(
      new Request('http://localhost/products', {
        headers: { 'accept-language': 'fr;q=0.9,es;q=0.8,en;q=0.7' },
      }),
      info,
    )

    assert(result instanceof Response)
    assertEquals(result.headers.get('Location'), 'http://localhost/es/products')
  },
)

Deno.test(
  'langPreHandler: an Accept-Language region tag (es-MX) matches its base language (es)',
  async () => {
    const handler = langPreHandler({ availableLangs: ['en', 'es'], defaultLang: 'en' })
    const result = await handler(
      new Request('http://localhost/products', {
        headers: { 'accept-language': 'es-MX,es;q=0.9' },
      }),
      info,
    )

    assert(result instanceof Response)
    assertEquals(result.headers.get('Location'), 'http://localhost/es/products')
  },
)

Deno.test(
  'langPreHandler: Accept-Language naming no available language falls back to defaultLang',
  async () => {
    const handler = langPreHandler({ availableLangs: ['en', 'es'], defaultLang: 'en' })
    const result = await handler(
      new Request('http://localhost/products', { headers: { 'accept-language': 'fr,de' } }),
      info,
    )

    assert(result instanceof Response)
    assertEquals(result.headers.get('Location'), 'http://localhost/en/products')
  },
)

Deno.test(
  'langPreHandler: framework-internal routes are never redirected, even without a lang prefix',
  async () => {
    const handler = langPreHandler({ availableLangs: ['en', 'es'], defaultLang: 'en' })
    const paths = [
      '/health',
      '/ready',
      '/assets/logo.svg',
      '/icons/icon-192.png',
      '/sw.js',
      '/manifest.webmanifest',
    ]

    const results = await Promise.all(
      paths.map((path) => handler(new Request(`http://localhost${path}`), info)),
    )
    results.forEach((result, i) =>
      assertEquals(result, null, `expected ${paths[i]} to fall through`)
    )
  },
)

Deno.test('langPreHandler: a custom ignorePrefixes entry is also skipped', async () => {
  const handler = langPreHandler({
    availableLangs: ['en', 'es'],
    defaultLang: 'en',
    ignorePrefixes: ['/api/'],
  })
  const result = await handler(new Request('http://localhost/api/orders'), info)

  assertEquals(result, null)
})

Deno.test('langPreHandler: query strings are preserved across the redirect', async () => {
  const handler = langPreHandler({ availableLangs: ['en', 'es'], defaultLang: 'en' })
  const result = await handler(new Request('http://localhost/products?sort=price'), info)

  assert(result instanceof Response)
  assertEquals(result.headers.get('Location'), 'http://localhost/en/products?sort=price')
})

Deno.test(
  'langPreHandler: a redirect also sets the persistence cookie for the resolved lang',
  async () => {
    const handler = langPreHandler({ availableLangs: ['en', 'es'], defaultLang: 'en' })
    const result = await handler(new Request('http://localhost/products'), info)

    assert(result instanceof Response)
    const setCookie = result.headers.get('Set-Cookie')
    assert(setCookie?.includes('X-Znx-Lang=en'))
    assert(setCookie?.includes('SameSite=Lax'))
    // Regression guard: this cookie used to hand-roll 'Path=/; SameSite=Lax' with no `Secure` — the
    // only cookie in the whole ecosystem missing it. Now built from `PUBLIC_COOKIE_ATTRIBUTES`.
    assert(setCookie?.includes('Secure'))
    assertEquals(setCookie?.includes('HttpOnly'), false)
  },
)

Deno.test(
  'langPreHandler: an existing cookie wins over Accept-Language for an un-prefixed request',
  async () => {
    const handler = langPreHandler({ availableLangs: ['en', 'es'], defaultLang: 'en' })
    const result = await handler(
      new Request('http://localhost/products', {
        headers: { cookie: 'X-Znx-Lang=es', 'accept-language': 'en' },
      }),
      info,
    )

    assert(result instanceof Response)
    assertEquals(result.headers.get('Location'), 'http://localhost/es/products')
  },
)

Deno.test(
  'langPreHandler: a cookie naming a language outside availableLangs is ignored, falling back ' +
    'to Accept-Language',
  async () => {
    const handler = langPreHandler({ availableLangs: ['en', 'es'], defaultLang: 'en' })
    const result = await handler(
      new Request('http://localhost/products', {
        headers: { cookie: 'X-Znx-Lang=fr', 'accept-language': 'es' },
      }),
      info,
    )

    assert(result instanceof Response)
    assertEquals(result.headers.get('Location'), 'http://localhost/es/products')
  },
)

Deno.test(
  'langPreHandler: an already-correctly-prefixed request never sets a cookie on its own (by ' +
    "design — a PreHandler can't attach headers to a response it isn't building; langGuard " +
    'covers this case instead, see lang-guard.test.ts)',
  async () => {
    const handler = langPreHandler({ availableLangs: ['en', 'es'], defaultLang: 'en' })
    const result = await handler(
      new Request('http://localhost/es/products', { headers: { cookie: 'X-Znx-Lang=en' } }),
      info,
    )

    assertEquals(result, null)
  },
)

Deno.test('langPreHandler: a custom cookieName is both read and written', async () => {
  const handler = langPreHandler({
    availableLangs: ['en', 'es'],
    defaultLang: 'en',
    cookieName: 'X-Znx-App-Lang',
  })

  const withCookie = await handler(
    new Request('http://localhost/products', { headers: { cookie: 'X-Znx-App-Lang=es' } }),
    info,
  )
  assert(withCookie instanceof Response)
  assertEquals(withCookie.headers.get('Location'), 'http://localhost/es/products')

  const withoutCookie = await handler(new Request('http://localhost/products'), info)
  assert(withoutCookie instanceof Response)
  assert(withoutCookie.headers.get('Set-Cookie')?.includes('X-Znx-App-Lang=en'))
})

// See `csrf-guard.test.ts`'s identical comment for why `.code`, not `instanceof`, is asserted.
Deno.test('langPreHandler: a cookieName missing the X-Znx- prefix throws at construction', () => {
  const error = assertThrows(() =>
    langPreHandler({ availableLangs: ['en'], defaultLang: 'en', cookieName: 'lang' })
  ) as { code?: string }
  assertEquals(error.code, 'UTILS_COOKIES_INVALID_PREFIX')
})
