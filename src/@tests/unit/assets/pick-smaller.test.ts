import { assertEquals, assertStrictEquals } from '@std/assert'
import { pickSmaller } from 'modules/assets/image-optimize.ts'

/**
 * `pickSmaller` is the single choke point every "never worsen" decision in `image-optimize.ts`
 * (bare `images: true`, tier-1 vs. the global original, tier-2 format vs. its own tier-1
 * reference) and `svg-optimize.ts` goes through. Proven here with fully synthetic, deterministic
 * byte arrays — never relying on whether some real photo happens to compress well, exactly the
 * approach explicitly sanctioned for these cases: verify the RULE exhaustively and directly,
 * independent of any particular codec's real-world behavior.
 */

Deno.test('pickSmaller: a strictly smaller candidate wins', () => {
  const candidate = new Uint8Array(5)
  const reference = new Uint8Array(10)
  assertStrictEquals(pickSmaller(candidate, reference), candidate)
})

Deno.test('pickSmaller: a strictly larger candidate loses — the reference is kept exactly', () => {
  const candidate = new Uint8Array(20)
  const reference = new Uint8Array(10)
  assertStrictEquals(pickSmaller(candidate, reference), reference)
})

Deno.test({
  name:
    'pickSmaller: an EQUAL-size candidate loses — ties always go to the reference, never the candidate',
  fn: () => {
    const candidate = new Uint8Array(10)
    const reference = new Uint8Array(10)
    assertStrictEquals(pickSmaller(candidate, reference), reference)
  },
})

Deno.test({
  name:
    'pickSmaller: a zero-length candidate against a non-empty reference wins (still strictly smaller)',
  fn: () => {
    const candidate = new Uint8Array(0)
    const reference = new Uint8Array(1)
    assertStrictEquals(pickSmaller(candidate, reference), candidate)
  },
})

Deno.test({
  name: 'pickSmaller: the returned value is the literal reference identity on a loss, not a copy',
  fn: () => {
    const reference = new Uint8Array([1, 2, 3])
    const candidate = new Uint8Array([1, 2, 3, 4])
    const winner = pickSmaller(candidate, reference)
    assertStrictEquals(winner, reference)
    assertEquals(Array.from(winner), [1, 2, 3])
  },
})
