import { assertEquals, assertRejects } from '@std/assert'
import { createInMemoryAssetRepository } from 'modules/assets-api/adapters/in-memory-asset-repository.ts'

/**
 * `createInMemoryAssetRepository`'s own `update`-not-found and `delete` paths — exercised
 * elsewhere only through its FILE-backed sibling (`asset-repository-over-files.test.ts`), never
 * against this in-process `Map`-backed implementation itself. Mirrors that sibling's own two
 * cases so both `AssetRepository` implementations carry the same real regression coverage.
 */

Deno.test('createInMemoryAssetRepository.update throws NOT_FOUND for a missing id', async () => {
  const repository = createInMemoryAssetRepository()
  await assertRejects(() => repository.update('does-not-exist', { status: 'completed' }))
})

Deno.test(
  'createInMemoryAssetRepository.delete removes the record, idempotently',
  async () => {
    const repository = createInMemoryAssetRepository()
    await repository.create({
      id: 'asset-1',
      kind: 'image',
      contentType: 'image/jpeg',
      size: 1,
      checksum: 'x',
      storageKey: 'assets/asset-1/original',
    })
    assertEquals((await repository.findById('asset-1'))?.id, 'asset-1')

    await repository.delete('asset-1')
    assertEquals(await repository.findById('asset-1'), undefined)
    // Deleting an already-gone id is a no-op, never an error.
    await repository.delete('asset-1')
  },
)
