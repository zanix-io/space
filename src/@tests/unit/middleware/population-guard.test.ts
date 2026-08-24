import { assert, assertEquals, assertThrows } from '@std/assert'
import type { GuardContext } from '@zanix/server'
import { POPULATION_LOCALS_KEY, populationGuard } from 'modules/middleware/population-guard.ts'

function mockGuardContext(overrides: {
  url?: string
  params?: Record<string, string>
  cookies?: Record<string, string>
} = {}): GuardContext {
  const url = new URL(overrides.url ?? 'http://localhost/products')
  return {
    id: 'test-context',
    req: new Request(url),
    url,
    payload: { params: overrides.params ?? {}, search: {}, body: undefined },
    cookies: overrides.cookies ?? {},
    locals: {},
  } as GuardContext
}

Deno.test({
  name: 'populationGuard: with nothing resolvable, locals stay empty and no cookie is set',
  fn: async () => {
    const ctx = mockGuardContext()
    const result = await populationGuard()(ctx)

    assertEquals(ctx.locals[POPULATION_LOCALS_KEY], undefined)
    assertEquals(result.headers, undefined)
  },
})

Deno.test('populationGuard: a route param resolves and persists to the cookie', async () => {
  const ctx = mockGuardContext({ params: { population: 'zanix' } })
  const { headers } = await populationGuard()(ctx)

  assertEquals(ctx.locals[POPULATION_LOCALS_KEY], 'zanix')
  assert(headers?.['Set-Cookie']?.includes('X-Znx-Population=zanix'))
  assert(headers?.['Set-Cookie']?.includes('SameSite=Lax'))
  // Regression guard: this cookie used to hand-roll 'Path=/; SameSite=Lax' with no `Secure` — the
  // only cookie in the whole ecosystem missing it. Now built from `PUBLIC_COOKIE_ATTRIBUTES`.
  assert(headers?.['Set-Cookie']?.includes('Secure'))
  assertEquals(headers?.['Set-Cookie']?.includes('HttpOnly'), false)
})

Deno.test('populationGuard: a query string param resolves and persists to the cookie', async () => {
  const ctx = mockGuardContext({ url: 'http://localhost/products?population=zanix' })
  const { headers } = await populationGuard()(ctx)

  assertEquals(ctx.locals[POPULATION_LOCALS_KEY], 'zanix')
  assert(headers?.['Set-Cookie']?.includes('X-Znx-Population=zanix'))
})

Deno.test('populationGuard: a route param wins over a query string param', async () => {
  const ctx = mockGuardContext({
    url: 'http://localhost/products?population=from-query',
    params: { population: 'from-param' },
  })
  await populationGuard()(ctx)

  assertEquals(ctx.locals[POPULATION_LOCALS_KEY], 'from-param')
})

Deno.test(
  'populationGuard: with neither param nor query, the cookie resolves it — with no re-issued Set-Cookie',
  async () => {
    const ctx = mockGuardContext({ cookies: { 'X-Znx-Population': 'zanix' } })
    const { headers } = await populationGuard()(ctx)

    assertEquals(ctx.locals[POPULATION_LOCALS_KEY], 'zanix')
    assertEquals(headers, undefined)
  },
)

Deno.test(
  'populationGuard: a param matching the already-set cookie does not re-issue Set-Cookie',
  async () => {
    const ctx = mockGuardContext({
      params: { population: 'zanix' },
      cookies: { 'X-Znx-Population': 'zanix' },
    })
    const { headers } = await populationGuard()(ctx)

    assertEquals(headers, undefined)
  },
)

Deno.test(
  'populationGuard: a param that CHANGES the population overwrites the existing cookie',
  async () => {
    const ctx = mockGuardContext({
      params: { population: 'new-population' },
      cookies: { 'X-Znx-Population': 'old-population' },
    })
    const { headers } = await populationGuard()(ctx)

    assertEquals(ctx.locals[POPULATION_LOCALS_KEY], 'new-population')
    assert(headers?.['Set-Cookie']?.includes('X-Znx-Population=new-population'))
  },
)

Deno.test('populationGuard: a custom paramName/cookieName is respected', async () => {
  const ctx = mockGuardContext({
    url: 'http://localhost/products?segment=vip',
  })
  const { headers } = await populationGuard({ paramName: 'segment', cookieName: 'X-Znx-Segment' })(
    ctx,
  )

  assertEquals(ctx.locals[POPULATION_LOCALS_KEY], 'vip')
  assert(headers?.['Set-Cookie']?.includes('X-Znx-Segment=vip'))
})

// See `csrf-guard.test.ts`'s identical comment for why `.code`, not `instanceof`, is asserted.
Deno.test('populationGuard: a cookieName missing the X-Znx- prefix throws at construction', () => {
  const error = assertThrows(() => populationGuard({ cookieName: 'segment' })) as { code?: string }
  assertEquals(error.code, 'UTILS_COOKIES_INVALID_PREFIX')
})
