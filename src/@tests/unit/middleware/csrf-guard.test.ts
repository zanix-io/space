import { assert, assertEquals, assertRejects } from '@std/assert'
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
    assert(headers?.['Set-Cookie']?.includes('SameSite=Strict'))
  },
)

Deno.test('csrfGuard: a GET with an existing cookie reuses it, no Set-Cookie', async () => {
  const ctx = mockGuardContext({ cookies: { 'X-Znx-Csrf': 'existing-token' } })
  const { headers } = await csrfGuard()(ctx)

  assertEquals(ctx.locals[CSRF_TOKEN_LOCALS_KEY], 'existing-token')
  assertEquals(headers?.['Set-Cookie'], undefined)
})

Deno.test('csrfGuard: a POST with no token at all is rejected', async () => {
  const ctx = mockGuardContext({ method: 'POST', cookies: { 'X-Znx-Csrf': 'the-token' } })
  await assertRejects(() => Promise.resolve(csrfGuard()(ctx)), HttpError)
})

Deno.test('csrfGuard: a POST with a mismatched header token is rejected', async () => {
  const ctx = mockGuardContext({
    method: 'POST',
    cookies: { 'X-Znx-Csrf': 'the-real-token' },
    headers: { 'x-csrf-token': 'wrong-token' },
  })
  await assertRejects(() => Promise.resolve(csrfGuard()(ctx)), HttpError)
})

Deno.test('csrfGuard: a POST with a matching header token passes', async () => {
  const ctx = mockGuardContext({
    method: 'POST',
    cookies: { 'X-Znx-Csrf': 'the-real-token' },
    headers: { 'x-csrf-token': 'the-real-token' },
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
  'csrfGuard: reading the form field does not consume the body for the real handler afterward',
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

    // The guard used `req.clone()` internally — the original request's body must still be readable.
    const stillReadable = await ctx.req.formData()
    assertEquals(stillReadable.get('email'), 'user@example.com')
  },
)

Deno.test('csrfGuard: a custom cookieName/headerName is respected', async () => {
  const ctx = mockGuardContext({
    method: 'POST',
    cookies: { 'my-csrf': 'the-real-token' },
    headers: { 'x-my-csrf': 'the-real-token' },
  })
  const result = await csrfGuard({ cookieName: 'my-csrf', headerName: 'x-my-csrf' })(ctx)
  assertEquals(result, {})
})
