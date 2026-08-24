/**
 * The default `AssetRepository` for tests — an in-process `Map<id, AssetRecord>`. Never persists
 * across a process restart. See `../ports/asset-repository.ts`'s own doc for how a real deployment
 * would get durable metadata storage instead — mapping onto `@zanix/datamaster/files`'s generic
 * `MongoFileRepository`, composed in by the consuming application, not a dedicated repository class
 * living in this package or `@zanix/datamaster`.
 *
 * @module
 */

import { HttpError } from '@zanix/errors'
import type { AssetRecord } from '../typings.ts'
import type {
  AssetRepository,
  CreateAssetInput,
  UpdateAssetInput,
} from '../ports/asset-repository.ts'

/** Implements `AssetRepository` over an in-process `Map` — see this module's own top-level doc. */
export function createInMemoryAssetRepository(): AssetRepository {
  const records = new Map<string, AssetRecord>()

  return {
    create(input: CreateAssetInput): Promise<AssetRecord> {
      const now = new Date().toISOString()
      const record: AssetRecord = {
        id: input.id,
        kind: input.kind,
        status: 'pending',
        originalFilename: input.originalFilename,
        contentType: input.contentType,
        size: input.size,
        checksum: input.checksum,
        storageKey: input.storageKey,
        variants: [],
        createdAt: now,
        updatedAt: now,
      }
      records.set(record.id, record)
      return Promise.resolve(record)
    },

    findById(id: string): Promise<AssetRecord | undefined> {
      return Promise.resolve(records.get(id))
    },

    update(id: string, changes: UpdateAssetInput): Promise<AssetRecord> {
      const existing = records.get(id)
      if (!existing) {
        return Promise.reject(new HttpError('NOT_FOUND', { meta: { id, source: 'zanix' } }))
      }
      const updated: AssetRecord = {
        ...existing,
        ...changes,
        updatedAt: new Date().toISOString(),
      }
      records.set(id, updated)
      return Promise.resolve(updated)
    },

    delete(id: string): Promise<void> {
      records.delete(id)
      return Promise.resolve()
    },
  }
}
