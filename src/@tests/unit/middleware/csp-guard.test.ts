import { assert, assertEquals, assertNotEquals } from '@std/assert'
import type { GuardContext } from '@zanix/server'
import { CSP_NONCE_LOCALS_KEY, cspGuard } from 'modules/middleware/csp-guard.ts'

function mockGuardContext(): GuardContext {
  return {
    id: 'test-context',
    req: new Request('http://localhost/'),
    cookies: {},
    locals: {},
  } as GuardContext
}

Deno.test('cspGuard: a directive set to false is omitted entirely', async () => {
  const ctx = mockGuardContext()
  const { headers } = await cspGuard({
    'default-src': ["'self'"],
    'upgrade-insecure-requests': false,
  })(ctx)

  const csp = headers?.['Content-Security-Policy']
  assert(csp?.includes("default-src 'self'"))
  assertEquals(csp?.includes('upgrade-insecure-requests'), false)
})

Deno.test('cspGuard: a directive set to true is included with no value', async () => {
  const ctx = mockGuardContext()
  const { headers } = await cspGuard({
    'upgrade-insecure-requests': true,
  })(ctx)

  assertEquals(headers?.['Content-Security-Policy'], 'upgrade-insecure-requests')
})

Deno.test('cspGuard: a single string value is kept as-is', async () => {
  const ctx = mockGuardContext()
  const { headers } = await cspGuard({
    'default-src': "'self'",
  })(ctx)

  assertEquals(headers?.['Content-Security-Policy'], "default-src 'self'")
})

Deno.test('cspGuard: a string array value is joined by spaces', async () => {
  const ctx = mockGuardContext()
  const { headers } = await cspGuard({
    'img-src': ["'self'", 'data:'],
  })(ctx)

  assertEquals(headers?.['Content-Security-Policy'], "img-src 'self' data:")
})

Deno.test(
  'cspGuard: mixes false/true/string/array directives into a single semicolon-joined header',
  async () => {
    const ctx = mockGuardContext()
    const { headers } = await cspGuard({
      'default-src': ["'self'"],
      'img-src': ["'self'", 'data:'],
      'object-src': false,
      'upgrade-insecure-requests': true,
    })(ctx)

    assertEquals(
      headers?.['Content-Security-Policy'],
      "default-src 'self'; img-src 'self' data:; upgrade-insecure-requests",
    )
  },
)

Deno.test(
  'cspGuard (nonce form): stashes a real nonce on ctx.locals and includes the SAME nonce in the header',
  async () => {
    const ctx = mockGuardContext()
    const { headers } = await cspGuard((nonce) => ({
      'script-src': ["'self'", `'nonce-${nonce}'`],
    }))(ctx)

    const nonce = ctx.locals[CSP_NONCE_LOCALS_KEY]
    assert(typeof nonce === 'string' && nonce.length > 0)
    assertEquals(
      headers?.['Content-Security-Policy'],
      `script-src 'self' 'nonce-${nonce}'`,
    )
  },
)

Deno.test('cspGuard (nonce form): two separate calls produce two different nonces', async () => {
  const ctxA = mockGuardContext()
  const ctxB = mockGuardContext()
  const guard = cspGuard((nonce) => ({ 'script-src': [`'nonce-${nonce}'`] }))

  await guard(ctxA)
  await guard(ctxB)

  assertNotEquals(ctxA.locals[CSP_NONCE_LOCALS_KEY], ctxB.locals[CSP_NONCE_LOCALS_KEY])
})

/**
 * Regression coverage for a confirmed invariant: the nonce genuinely derives from
 * `crypto.getRandomValues` (the real Web Crypto CSPRNG), not merely "looks different each time" —
 * a plain incrementing counter or `Date.now()` would ALSO satisfy the "two calls differ" test
 * above without being cryptographically random at all. Stubbing `crypto.getRandomValues` with a
 * fully controlled, deterministic fake and proving the emitted nonce is EXACTLY the base64 of
 * those bytes (not merely influenced by them) is what actually pins this down.
 */
Deno.test('cspGuard (nonce form): the nonce derives from real crypto.getRandomValues', async () => {
  const original = crypto.getRandomValues.bind(crypto)
  const fixedBytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  crypto.getRandomValues = (<T extends ArrayBufferView | null>(arr: T): T => {
    const view = arr as unknown as Uint8Array
    view.set(fixedBytes.subarray(0, view.length))
    return arr
  }) as Crypto['getRandomValues']

  try {
    const ctx = mockGuardContext()
    const guard = cspGuard((nonce) => ({ 'script-src': [`'nonce-${nonce}'`] }))
    await guard(ctx)

    const expectedNonce = btoa(String.fromCharCode(...fixedBytes))
    assertEquals(ctx.locals[CSP_NONCE_LOCALS_KEY], expectedNonce)
  } finally {
    crypto.getRandomValues = original
  }
})
