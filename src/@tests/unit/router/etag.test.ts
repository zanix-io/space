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
