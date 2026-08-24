import { assert, assertEquals, assertRejects } from '@std/assert'
import { InternalError } from '@zanix/errors'
import {
  createAssetRepositoryOverFiles,
  type FileRecordLike,
  type FileRepositoryLike,
} from 'modules/assets-api/adapters/asset-repository-over-files.ts'

/**
 * `createAssetRepositoryOverFiles` — adapts a generic file-record registry (the exact shape
 * `@zanix/datamaster/files`'s `MongoFileRepository` has) into this package's own `AssetRepository`
 * port. Exercised against a small in-memory fake satisfying `FileRepositoryLike` — proves the
 * mapping/merge logic itself, independent of any real Mongo connection (real Mongo-backed coverage
 * of `MongoFileRepository` itself already lives in `@zanix/datamaster`'s own test suite).
 */

function createFakeFileRepository(): FileRepositoryLike & { size: () => number } {
  const records = new Map<string, FileRecordLike>()
  return {
    create(input) {
      const now = new Date().toISOString()
      const record: FileRecordLike = {
        id: input.id,
        key: input.key,
        contentType: input.contentType,
        size: input.size,
        checksum: input.checksum,
        filename: input.filename,
        metadata: input.metadata,
        createdAt: now,
        updatedAt: now,
      }
      records.set(record.id, record)
      return Promise.resolve(record)
    },
    findById(id) {
      return Promise.resolve(records.get(id))
    },
    update(id, changes) {
      const existing = records.get(id)
      if (!existing) return Promise.reject(new Error('NOT_FOUND (fake repository)'))
      const updated: FileRecordLike = {
        ...existing,
        ...changes,
        updatedAt: new Date().toISOString(),
      }
      records.set(id, updated)
      return Promise.resolve(updated)
    },
    delete(id) {
      records.delete(id)
      return Promise.resolve()
    },
    size: () => records.size,
  }
}

Deno.test(
  'createAssetRepositoryOverFiles.create maps CreateAssetInput onto the file record, packing kind/status/variants into metadata',
  async () => {
    const files = createFakeFileRepository()
    const repository = createAssetRepositoryOverFiles(files)

    const record = await repository.create({
      id: 'asset-1',
      kind: 'image',
      originalFilename: 'photo.jpg',
      contentType: 'image/jpeg',
      size: 1024,
      checksum: 'abc123',
      storageKey: 'assets/asset-1/original',
    })

    assertEquals(record.id, 'asset-1')
    assertEquals(record.kind, 'image')
    assertEquals(record.status, 'pending')
    assertEquals(record.originalFilename, 'photo.jpg')
    assertEquals(record.contentType, 'image/jpeg')
    assertEquals(record.size, 1024)
    assertEquals(record.checksum, 'abc123')
    assertEquals(record.storageKey, 'assets/asset-1/original')
    assertEquals(record.variants, [])
    assertEquals(record.error, undefined)

    // The underlying file record itself carries the SAME data, storageKey mapped onto `key`.
    const stored = await files.findById('asset-1')
    assert(stored)
    assertEquals(stored.key, 'assets/asset-1/original')
    assertEquals(stored.metadata, { kind: 'image', status: 'pending', variants: [] })
  },
)

Deno.test(
  'createAssetRepositoryOverFiles.findById returns undefined for a missing id',
  async () => {
    const repository = createAssetRepositoryOverFiles(createFakeFileRepository())
    assertEquals(await repository.findById('does-not-exist'), undefined)
  },
)

Deno.test(
  'createAssetRepositoryOverFiles.update merges changes into the existing metadata, never clearing fields changes omits',
  async () => {
    const files = createFakeFileRepository()
    const repository = createAssetRepositoryOverFiles(files)
    await repository.create({
      id: 'asset-1',
      kind: 'video',
      contentType: 'video/mp4',
      size: 10,
      checksum: 'x',
      storageKey: 'assets/asset-1/original',
    })

    const afterVariants = await repository.update('asset-1', {
      variants: [{
        variantId: 'v1',
        kind: 'video',
        format: 'mp4',
        contentType: 'video/mp4',
        storageKey: 'assets/asset-1/variants/v1',
        size: 5,
        checksum: 'y',
        transformId: 'video-mlg',
        policyVersion: 'v1',
      }],
    })
    assertEquals(afterVariants.status, 'pending', 'expected status to be untouched by this update')
    assertEquals(afterVariants.variants.length, 1)

    const afterStatus = await repository.update('asset-1', { status: 'completed' })
    assertEquals(afterStatus.status, 'completed')
    assertEquals(
      afterStatus.variants.length,
      1,
      'expected the variant set by the PREVIOUS update to survive this one, since this update never mentioned variants',
    )
  },
)

Deno.test(
  'createAssetRepositoryOverFiles.update sets error, and a later update without error preserves it',
  async () => {
    const files = createFakeFileRepository()
    const repository = createAssetRepositoryOverFiles(files)
    await repository.create({
      id: 'asset-1',
      kind: 'audio',
      contentType: 'audio/wav',
      size: 10,
      checksum: 'x',
      storageKey: 'assets/asset-1/original',
    })

    const failed = await repository.update('asset-1', {
      status: 'failed',
      error: { message: 'transcode failed' },
    })
    assertEquals(failed.status, 'failed')
    assertEquals(failed.error, { message: 'transcode failed' })

    const again = await repository.update('asset-1', { status: 'failed' })
    assertEquals(
      again.error,
      { message: 'transcode failed' },
      'expected the previously-set error to survive an update that never mentions it',
    )
  },
)

Deno.test('createAssetRepositoryOverFiles.update throws NOT_FOUND for a missing id', async () => {
  const repository = createAssetRepositoryOverFiles(createFakeFileRepository())
  await assertRejects(() => repository.update('does-not-exist', { status: 'completed' }))
})

Deno.test(
  'createAssetRepositoryOverFiles.delete removes the underlying file record, idempotently',
  async () => {
    const files = createFakeFileRepository()
    const repository = createAssetRepositoryOverFiles(files)
    await repository.create({
      id: 'asset-1',
      kind: 'image',
      contentType: 'image/jpeg',
      size: 1,
      checksum: 'x',
      storageKey: 'assets/asset-1/original',
    })
    assertEquals(files.size(), 1)

    await repository.delete('asset-1')
    assertEquals(files.size(), 0)
    // Deleting an already-gone id is a no-op, never an error.
    await repository.delete('asset-1')
  },
)

Deno.test(
  'createAssetRepositoryOverFiles: a file record with no Asset metadata fails loudly, never guesses kind/status',
  async () => {
    const files = createFakeFileRepository()
    // Simulates a file record that exists in the registry but was never created through THIS
    // adapter (e.g. written by some other, unrelated file-registry consumer).
    await files.create({
      id: 'foreign-record',
      key: 'some/other/key',
      contentType: 'application/octet-stream',
      size: 1,
      checksum: 'x',
    })

    const repository = createAssetRepositoryOverFiles(files)
    const error = await assertRejects(() => repository.findById('foreign-record'), InternalError)
    assertEquals(error.code, 'SPACE_ASSETS_FILE_RECORD_METADATA_MISSING')
  },
)

Deno.test(
  'createAssetRepositoryOverFiles: a record with kind/status but no variants metadata at all ' +
    'defaults to an empty variants array, rather than surfacing undefined',
  async () => {
    const files = createFakeFileRepository()
    // `kind`/`status` present (so `toAssetRecord` does not reject it) but `variants` genuinely
    // absent — this adapter's own `create()` always sets it, so this only happens for a record
    // written some other way (e.g. a legacy record migrated before `variants` existed).
    await files.create({
      id: 'legacy-record',
      key: 'assets/legacy-record/original',
      contentType: 'image/jpeg',
      size: 1,
      checksum: 'x',
      metadata: { kind: 'image', status: 'pending' },
    })

    const repository = createAssetRepositoryOverFiles(files)
    const record = await repository.findById('legacy-record')
    assertEquals(record?.variants, [])
  },
)

Deno.test(
  'createAssetRepositoryOverFiles.update: when NEITHER changes NOR the existing record has ' +
    'variants at all (a legacy record, updated without ever mentioning variants), the merge ' +
    "itself defaults to an empty array too — not just toAssetRecord's own read-side fallback",
  async () => {
    const files = createFakeFileRepository()
    await files.create({
      id: 'legacy-record',
      key: 'assets/legacy-record/original',
      contentType: 'image/jpeg',
      size: 1,
      checksum: 'x',
      metadata: { kind: 'image', status: 'pending' },
    })

    const repository = createAssetRepositoryOverFiles(files)
    const updated = await repository.update('legacy-record', { status: 'completed' })
    assertEquals(updated.variants, [])
  },
)

Deno.test(
  'createAssetRepositoryOverFiles.update preserves previously-set variants when a later ' +
    'update never mentions them — same "omitted field never clears" merge as `error`',
  async () => {
    const files = createFakeFileRepository()
    const repository = createAssetRepositoryOverFiles(files)
    await repository.create({
      id: 'asset-1',
      kind: 'image',
      contentType: 'image/jpeg',
      size: 1,
      checksum: 'x',
      storageKey: 'assets/asset-1/original',
    })

    const variant = {
      variantId: 'v1',
      kind: 'thumbnail' as const,
      format: 'jpeg',
      contentType: 'image/jpeg',
      storageKey: 'assets/asset-1/variants/v1',
      size: 1,
      checksum: 'x',
      transformId: 't',
      policyVersion: 'v1',
    }
    await repository.update('asset-1', { variants: [variant] })

    // Doesn't mention `variants` at all — the previously-set one must survive.
    const afterStatusOnly = await repository.update('asset-1', { status: 'completed' })
    assertEquals(afterStatusOnly.variants, [variant])
  },
)
