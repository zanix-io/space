import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import { HttpError } from '@zanix/errors'
import type { GuardContext } from '@zanix/server'
import { CSRF_TOKEN_LOCALS_KEY, csrfGuard } from 'modules/middleware/csrf-guard.ts'

function mockGuardContext(overrides: {
  method?: string
  cookies?: Record<string, string>
  headers?: Record<string, string>
  body?: BodyInit
} = {}): GuardContext {
  const req = new Request('http://localhost/checkout', {
    method: overrides.method ?? 'GET',
    headers: overrides.headers,
    body: overrides.body,
  })
  return {
    id: 'test-context',
    req,
    cookies: overrides.cookies ?? {},
    locals: {},
    // Mirrors real `@zanix/server` behavior: an `application/x-www-form-urlencoded`
    // `FormData` body is already consumed and parsed into `payload.body` by the time any guard
    // runs (see `csrf-guard.ts`'s own `readFormField` doc) — a mock that left this out let a real,
    // confirmed bug (reading `req.clone().formData()` on an already-spent stream) go undetected.
    payload: {
      body: overrides.body instanceof FormData ? overrides.body : undefined,
    },
  } as GuardContext
}

Deno.test(
  'csrfGuard: a GET with no existing cookie issues a fresh token and Set-Cookie',
  async () => {
    const ctx = mockGuardContext()
    const { headers } = await csrfGuard()(ctx)

    const token = ctx.locals[CSRF_TOKEN_LOCALS_KEY]
    assert(typeof token === 'string' && token.length > 0)
    assert(headers?.['Set-Cookie']?.includes(`X-Znx-Csrf=${token}`))
    assert(headers?.['Set-Cookie']?.includes('HttpOnly'))
    assert(headers?.['Set-Cookie']?.includes('Secure'))
    assert(headers?.['Set-Cookie']?.includes('SameSite=Strict'))
  },
)

/**
 * Regression coverage for a confirmed invariant: the token genuinely derives from
 * `crypto.getRandomValues` (the real Web Crypto CSPRNG), not merely "looks random" — stubbing it
 * with a fully controlled, deterministic fake and proving the emitted token is EXACTLY the
 * (padding-stripped) base64 of those bytes is what actually pins this down.
 */
Deno.test('csrfGuard: the token is derived from real crypto.getRandomValues output', async () => {
  const original = crypto.getRandomValues.bind(crypto)
  const fixedBytes = new Uint8Array(24).map((_, i) => i)
  crypto.getRandomValues = (<T extends ArrayBufferView | null>(arr: T): T => {
    const view = arr as unknown as Uint8Array
    view.set(fixedBytes.subarray(0, view.length))
    return arr
  }) as Crypto['getRandomValues']

  try {
    const ctx = mockGuardContext()
    await csrfGuard()(ctx)

    const expectedToken = btoa(String.fromCharCode(...fixedBytes)).replace(/[+/=]/g, '')
    assertEquals(ctx.locals[CSRF_TOKEN_LOCALS_KEY], expectedToken)
  } finally {
    crypto.getRandomValues = original
  }
})

Deno.test('csrfGuard: a GET with an existing cookie reuses it, no Set-Cookie', async () => {
  const ctx = mockGuardContext({ cookies: { 'X-Znx-Csrf': 'existing-token' } })
  const { headers } = await csrfGuard()(ctx)

  assertEquals(ctx.locals[CSRF_TOKEN_LOCALS_KEY], 'existing-token')
  assertEquals(headers?.['Set-Cookie'], undefined)
})

Deno.test('csrfGuard: a POST with no token at all is rejected', async () => {
  const ctx = mockGuardContext({
    method: 'POST',
    cookies: { 'X-Znx-Csrf': 'the-token' },
  })
  await assertRejects(() => Promise.resolve(csrfGuard()(ctx)), HttpError)
})

Deno.test('csrfGuard: a POST with a mismatched header token is rejected', async () => {
  const ctx = mockGuardContext({
    method: 'POST',
    cookies: { 'X-Znx-Csrf': 'the-real-token' },
    headers: { 'X-Znx-Csrf-Token': 'wrong-token' },
  })
  await assertRejects(() => Promise.resolve(csrfGuard()(ctx)), HttpError)
})

Deno.test('csrfGuard: a POST with a matching header token passes', async () => {
  const ctx = mockGuardContext({
    method: 'POST',
    cookies: { 'X-Znx-Csrf': 'the-real-token' },
    headers: { 'X-Znx-Csrf-Token': 'the-real-token' },
  })
  const result = await csrfGuard()(ctx)
  assertEquals(result, {})
})

Deno.test('csrfGuard: a POST with a matching _csrf form field passes', async () => {
  const formData = new FormData()
  formData.set('_csrf', 'the-real-token')
  const ctx = mockGuardContext({
    method: 'POST',
    cookies: { 'X-Znx-Csrf': 'the-real-token' },
    body: formData,
  })
  const result = await csrfGuard()(ctx)
  assertEquals(result, {})
})

Deno.test(
  'csrfGuard: reading the form field does not consume ctx.payload.body for the real handler afterward',
  async () => {
    const formData = new FormData()
    formData.set('_csrf', 'the-real-token')
    formData.set('email', 'user@example.com')
    const ctx = mockGuardContext({
      method: 'POST',
      cookies: { 'X-Znx-Csrf': 'the-real-token' },
      body: formData,
    })
    await csrfGuard()(ctx)

    // The guard reads `_csrf` off `ctx.payload.body` (the already-parsed `FormData` a real
    // `@zanix/server` request leaves there — see `readFormField`'s own doc) via a non-destructive
    // `.get()` — every other field must still be readable afterward, same instance, for whatever
    // reads `ctx.payload.body` next (e.g. `SpacePageController.handlePost`).
    assertEquals(ctx.payload.body, formData)
    assertEquals((ctx.payload.body as FormData).get('email'), 'user@example.com')
  },
)

Deno.test('csrfGuard: a custom cookieName/headerName is respected', async () => {
  const ctx = mockGuardContext({
    method: 'POST',
    cookies: { 'X-Znx-My-Csrf': 'the-real-token' },
    headers: { 'x-my-csrf': 'the-real-token' },
  })
  const result = await csrfGuard({
    cookieName: 'X-Znx-My-Csrf',
    headerName: 'x-my-csrf',
  })(ctx)
  assertEquals(result, {})
})

// Not asserted via `instanceof ApplicationError` here: `assertZnxCookieName` throws from inside
// `@zanix/utils`'s own local checkout (reached through `@zanix/helpers`'s TEMP local-path
// override, see `deno.jsonc`), a different module resolution than this file's own `@zanix/errors`
// import (still pinned to the published JSR line) — the exact same cross-boundary class-identity
// gap `deno.jsonc` already documents for `readBoundedStream`. Asserting on `.code` sidesteps it
// entirely and is more precise anyway.
Deno.test(
  'csrfGuard: a cookieName missing the X-Znx- prefix throws at construction, not per-request',
  () => {
    const error = assertThrows(() => csrfGuard({ cookieName: 'my-csrf' })) as { code?: string }
    assertEquals(error.code, 'UTILS_COOKIES_INVALID_PREFIX')
  },
)

Deno.test(
  'csrfGuard: a cookieName starting with X-Znx- but missing "Csrf" throws at construction',
  () => {
    const error = assertThrows(() => csrfGuard({ cookieName: 'X-Znx-Token' })) as { code?: string }
    assertEquals(error.code, 'UTILS_COOKIES_MISSING_KEYWORD')
  },
)
