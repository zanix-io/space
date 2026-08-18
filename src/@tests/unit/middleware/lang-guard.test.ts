import { assert, assertEquals } from '@std/assert'
import type { GuardContext } from '@zanix/server'
import { langGuard } from 'modules/middleware/lang-guard.ts'

function mockGuardContext(overrides: {
  params?: Record<string, string>
  cookies?: Record<string, string>
} = {}): GuardContext {
  const url = new URL('http://localhost/es/products')
  return {
    id: 'test-context',
    req: new Request(url),
    url,
    payload: { params: overrides.params ?? {}, search: {}, body: undefined },
    cookies: overrides.cookies ?? {},
    locals: {},
  } as GuardContext
}

Deno.test('langGuard: no :lang param on the matched route sets no cookie', async () => {
  const ctx = mockGuardContext()
  const { headers } = await langGuard()(ctx)

  assertEquals(headers, undefined)
})

Deno.test(
  'langGuard: a :lang param that already matches the cookie does not re-issue Set-Cookie',
  async () => {
    const ctx = mockGuardContext({
      params: { lang: 'es' },
      cookies: { 'X-Znx-Lang': 'es' },
    })
    const { headers } = await langGuard()(ctx)

    assertEquals(headers, undefined)
  },
)

Deno.test(
  'langGuard: a :lang param with no existing cookie at all issues a fresh Set-Cookie',
  async () => {
    const ctx = mockGuardContext({ params: { lang: 'es' } })
    const { headers } = await langGuard()(ctx)

    assert(headers?.['Set-Cookie']?.includes('X-Znx-Lang=es'))
    assert(headers?.['Set-Cookie']?.includes('SameSite=Lax'))
    assertEquals(headers?.['Set-Cookie']?.includes('HttpOnly'), false)
  },
)

Deno.test(
  'langGuard: this is exactly the case langPreHandler alone cannot cover — browsing ' +
    'already-prefixed URLs with a stale cookie from an earlier visit refreshes it',
  async () => {
    const ctx = mockGuardContext({
      params: { lang: 'es' },
      cookies: { 'X-Znx-Lang': 'en' },
    })
    const { headers } = await langGuard()(ctx)

    assert(headers?.['Set-Cookie']?.includes('X-Znx-Lang=es'))
  },
)

Deno.test('langGuard: a custom paramName/cookieName is respected', async () => {
  const ctx = mockGuardContext({ params: { locale: 'fr' } })
  const { headers } = await langGuard({ paramName: 'locale', cookieName: 'X-Znx-Locale' })(ctx)

  assert(headers?.['Set-Cookie']?.includes('X-Znx-Locale=fr'))
})
