import { assertEquals, assertNotEquals } from '@std/assert'
import {
  CSP_SIGNATURE_NONE,
  normalizeCspSignature,
  withCspSignatureMeta,
} from 'modules/router/csp-signature.ts'
import type { ResolvedHead } from 'modules/router/head-descriptor.ts'

Deno.test('normalizeCspSignature: null (no header) normalizes to CSP_SIGNATURE_NONE', () => {
  assertEquals(normalizeCspSignature(null), CSP_SIGNATURE_NONE)
})

Deno.test(
  'normalizeCspSignature: two policies differing ONLY by their own per-request nonce normalize ' +
    'equal — the whole point of this function',
  () => {
    const a = "default-src 'self'; script-src 'self' 'nonce-AAAAAAAAAAAAAAAAAAAAAA=='"
    const b = "default-src 'self'; script-src 'self' 'nonce-ZZZZZZZZZZZZZZZZZZZZZZ=='"
    assertEquals(normalizeCspSignature(a), normalizeCspSignature(b))
  },
)

Deno.test(
  'normalizeCspSignature: a policy with no nonce at all normalizes to itself, unchanged',
  () => {
    const csp = "default-src 'self'; img-src 'self' data:"
    assertEquals(normalizeCspSignature(csp), csp)
  },
)

Deno.test(
  'normalizeCspSignature: a genuinely different policy (not just a different nonce) never ' +
    'collapses to the same signature',
  () => {
    const strict = "default-src 'self'; script-src 'self' 'nonce-AAAAAAAAAAAAAAAAAAAAAA=='"
    const relaxed =
      "default-src 'self'; script-src 'self' 'unsafe-eval' 'nonce-AAAAAAAAAAAAAAAAAAAAAA=='"
    assertNotEquals(normalizeCspSignature(strict), normalizeCspSignature(relaxed))
  },
)

Deno.test(
  'normalizeCspSignature: "no header" and an explicit, empty policy never collapse to the same ' +
    'signature — the real reason CSP_SIGNATURE_NONE is a sentinel, not an empty string',
  () => {
    assertNotEquals(normalizeCspSignature(null), normalizeCspSignature(''))
  },
)

function emptyHead(): ResolvedHead {
  return { meta: [], link: [] }
}

Deno.test(
  'withCspSignatureMeta: appends exactly one meta tag, under the reserved name, with the given ' +
    'signature as its content',
  () => {
    const result = withCspSignatureMeta(emptyHead(), 'a-signature')
    assertEquals(result.meta, [{ name: 'x-space-csp-signature', content: 'a-signature' }])
  },
)

Deno.test(
  "withCspSignatureMeta: never mutates the input head, and never drops the page's own meta/link/title",
  () => {
    const head: ResolvedHead = {
      title: 'A Page',
      meta: [{ name: 'description', content: 'a page' }],
      link: [{ rel: 'canonical', href: 'https://example.com/' }],
    }
    const result = withCspSignatureMeta(head, 'sig')

    assertEquals(head.meta.length, 1, 'the original head object must never be mutated')
    assertEquals(result.title, 'A Page')
    assertEquals(result.link, head.link)
    assertEquals(result.meta, [
      { name: 'description', content: 'a page' },
      { name: 'x-space-csp-signature', content: 'sig' },
    ])
  },
)
