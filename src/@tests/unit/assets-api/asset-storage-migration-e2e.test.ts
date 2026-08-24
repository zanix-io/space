import { assert, assertEquals } from '@std/assert'
import { getTemporaryFolder } from '@zanix/helpers'
import { createInMemoryAssetStorage } from 'modules/assets-api/adapters/in-memory-asset-storage.ts'
import { createLocalFilesystemAssetStorage } from 'modules/assets-api/adapters/local-filesystem-asset-storage.ts'
import {
  createFallbackObjectStorage,
  ensureLocalObjectsSynced,
  resetLocalObjectsSyncState,
} from '@zanix/datamaster/storage'

/**
 * The full chain `resolveAssetStorage()` composes for real, end to end, exactly as requested:
 *
 *   local object exists
 *        ↓
 *   AssetStorage.get(key)
 *        ↓
 *   S3 reports NoSuchKey (here: an InMemoryAssetStorage standing in for S3, genuinely lacking the
 *        key — same `undefined` contract S3ObjectStorage.get() returns for a real NoSuchKey)
 *        ↓
 *   local object is returned
 *        ↓
 *   object is migrated to S3
 *        ↓
 *   subsequent get() is served by S3
 *
 * The LAST step is the one worth proving carefully, not assuming: after migration, a second read
 * must not depend on the local fallback at all — proven here by making the fallback THROW on the
 * second call and confirming the read still succeeds (because it's now served by the primary).
 */

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

Deno.test(
  'local-only asset: first get() falls back and migrates; SUBSEQUENT get() is served by S3 ' +
    'alone, never touching the local fallback again',
  async () => {
    resetLocalObjectsSyncState()
    const dir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      const local = createLocalFilesystemAssetStorage(dir)
      const bytes = new TextEncoder().encode('written while S3 was off')
      const original = await local.put('assets/x/original', bytes, { contentType: 'audio/wav' })

      const s3 = createInMemoryAssetStorage()
      const storage = createFallbackObjectStorage(
        s3,
        local,
        () => ensureLocalObjectsSynced(local, s3, dir),
      )

      // Step 1: S3 genuinely doesn't have it yet.
      assertEquals(await s3.exists('assets/x/original'), false)

      // Step 2-4: get() falls back to local AND triggers the migration.
      const firstRead = await storage.get('assets/x/original')
      assert(firstRead, 'expected the local-only object to still be readable')
      assertEquals(await readAll(firstRead.stream), bytes)

      // Step 5: the object has genuinely landed in S3 now — fields preserved exactly.
      const migrated = await s3.get('assets/x/original')
      assert(migrated, 'expected the object to have been migrated into S3 as a side effect')
      assertEquals(migrated.object.key, original.key)
      assertEquals(migrated.object.size, original.size)
      assertEquals(migrated.object.checksum, original.checksum)
      assertEquals(migrated.object.contentType, 'audio/wav')
      assertEquals(await readAll(migrated.stream), bytes)

      // Step 6: a broken/unavailable fallback must not matter anymore — the SECOND read is
      // genuinely served by S3 alone.
      const brokenFallback = {
        put: () => Promise.reject(new Error('fallback must never be reached again')),
        get: () => Promise.reject(new Error('fallback must never be reached again')),
        exists: () => Promise.reject(new Error('fallback must never be reached again')),
        delete: () => Promise.reject(new Error('fallback must never be reached again')),
      }
      const storageAfterMigration = createFallbackObjectStorage(s3, brokenFallback)
      const secondRead = await storageAfterMigration.get('assets/x/original')
      assert(secondRead, 'expected the second read to succeed, served entirely by S3')
      assertEquals(await readAll(secondRead.stream), bytes)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'a nested-key local-only asset migrates and is served correctly end to end',
  async () => {
    resetLocalObjectsSyncState()
    const dir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      const local = createLocalFilesystemAssetStorage(dir)
      const bytes = new TextEncoder().encode('nested variant bytes')
      await local.put('assets/x/variants/v1', bytes, { contentType: 'audio/aac' })

      const s3 = createInMemoryAssetStorage()
      const storage = createFallbackObjectStorage(
        s3,
        local,
        () => ensureLocalObjectsSynced(local, s3, dir),
      )

      const found = await storage.get('assets/x/variants/v1')
      assert(found, 'expected the nested-key object to be found via fallback')
      assertEquals(await readAll(found.stream), bytes)

      assertEquals(
        await s3.exists('assets/x/variants/v1'),
        true,
        'expected the FULL nested key to have been migrated into S3, not a truncated one',
      )
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)
