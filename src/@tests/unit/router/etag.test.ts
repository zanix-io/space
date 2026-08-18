import { assert, assertEquals, assertNotEquals } from '@std/assert'
import { computeEtag } from 'modules/router/etag.ts'

Deno.test('computeEtag: the same data always produces the same ETag', async () => {
  const a = await computeEtag({ id: 1, name: 'Ana' })
  const b = await computeEtag({ id: 1, name: 'Ana' })

  assertEquals(a, b)
})

Deno.test('computeEtag: different data produces a different ETag', async () => {
  const a = await computeEtag({ id: 1 })
  const b = await computeEtag({ id: 2 })

  assertNotEquals(a, b)
})

Deno.test('computeEtag: is a quoted value, safe to use as an ETag header as-is', async () => {
  const etag = await computeEtag({ id: 1 })

  assert(etag.startsWith('"') && etag.endsWith('"'))
})

Deno.test('computeEtag: handles undefined data (a page with no loader)', async () => {
  const etag = await computeEtag(undefined)

  assert(etag.length > 2)
})

Deno.test(
  'computeEtag: omitting extra produces the EXACT SAME hash as before this parameter existed — ' +
    'a page without theme.resolve configured is completely unaffected',
  async () => {
    const withoutExtraParam = await computeEtag({ id: 1, name: 'Ana' })
    const withExplicitUndefined = await computeEtag({ id: 1, name: 'Ana' }, undefined)

    assertEquals(withoutExtraParam, withExplicitUndefined)
  },
)

Deno.test(
  'computeEtag: two "populations" sharing the SAME loader data but a different extra ' +
    '(e.g. population, when theme.resolve is configured) produce DIFFERENT ETags — the exact ' +
    'same-origin collision theme.resolve would otherwise cause',
  async () => {
    const sameLoaderData = { title: 'Welcome' }
    const populationA = await computeEtag(sameLoaderData, 'tenant-a')
    const populationB = await computeEtag(sameLoaderData, 'tenant-b')

    assertNotEquals(populationA, populationB)
  },
)

Deno.test(
  'computeEtag: the SAME data and the SAME extra produce a STABLE ETag across calls',
  async () => {
    const a = await computeEtag({ title: 'Welcome' }, 'tenant-a')
    const b = await computeEtag({ title: 'Welcome' }, 'tenant-a')

    assertEquals(a, b)
  },
)
