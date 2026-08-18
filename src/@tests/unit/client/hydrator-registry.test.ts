import { assert, assertEquals } from '@std/assert'
import { getCometHydrator, setCometHydrator } from 'modules/client/hydrator-registry.ts'

/**
 * `orbit.ts` used to import React's `hydrateComets` statically, while being re-exported by BOTH
 * client barrels — so a Preact app re-hydrated every Comet in a swapped outlet with React's
 * `hydrateRoot` after every client-side navigation. These tests pin the seam that replaced it.
 *
 * The barrel-level half of this (that importing a barrel actually registers its own hydrator, and
 * that a Preact client graph therefore never contains React's hydrate module) is covered by
 * `integration/bundler/client-barrel-guard.test.ts` against a real build — a single `deno test`
 * process cannot import both barrels and still observe which one registered, since the second
 * import would simply overwrite the first.
 *
 * @module
 */

Deno.test(
  'getCometHydrator: undefined before any barrel registered one — Orbit skips rehydration ' +
    'rather than throwing, which is correct for a page with no Comets',
  () => {
    // No client barrel is imported by this file, deliberately: this is the un-registered state.
    assertEquals(getCometHydrator(), undefined)
  },
)

Deno.test(
  'setCometHydrator/getCometHydrator: round-trips the exact function, and Orbit therefore ' +
    "calls the ACTIVE renderer's implementation rather than a hardcoded one",
  () => {
    const calls: Array<ParentNode | undefined> = []
    const fake = (root?: ParentNode) => {
      calls.push(root)
    }

    setCometHydrator(fake)
    const resolved = getCometHydrator()
    assert(resolved === fake, 'must return the same function reference, not a wrapper')

    // The exact call shape `orbit.ts`'s `swapOutlet` makes.
    const outlet = { querySelectorAll: () => [] } as unknown as ParentNode
    resolved?.(outlet)
    assertEquals(calls, [outlet])
  },
)

Deno.test(
  'setCometHydrator: a later registration replaces the earlier one — an app only ever ' +
    'imports one barrel, so last-write-wins is the whole contract',
  () => {
    const first = () => {}
    const second = () => {}
    setCometHydrator(first)
    setCometHydrator(second)
    assert(getCometHydrator() === second)
  },
)
