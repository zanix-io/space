/**
 * The METADATA port — assetId -> AssetRecord. Deliberately knows nothing about bytes: every field
 * every method here accepts/returns is a plain, JSON-serializable value (string/number/boolean/
 * plain object) — never a `Uint8Array`/`ReadableStream`. A real Mongo-backed implementation is a
 * consuming application's own composition concern, not this package's or `@zanix/datamaster`'s:
 * `@zanix/datamaster/files`'s `MongoFileRepository` is a generic, durable file-record registry
 * (key/contentType/size/checksum/filename/free-form `metadata`) that a real deployment maps
 * `AssetRecord`'s own fields (`kind`/`status`/`variants`/`error`) onto — most naturally through its
 * `metadata` bag — rather than `@zanix/datamaster` gaining any Asset-specific knowledge of its own.
 * That mapping isn't implemented anywhere yet; `InMemoryAssetRepository` (`../adapters/`) is this
 * package's only own implementation today.
 *
 * @module
 */

import type { AssetKind, AssetRecord, AssetStatus, AssetVariant } from '../typings.ts'

/**
 * `id` is caller-assigned (by `AssetService`, via `@zanix/helpers`' `generateUUID`) rather than
 * repository-generated — this is what lets `AssetService` compute a variant's own logical
 * `storageKey` (`../keys.ts`, which needs the asset id) BEFORE the record exists, and it never
 * forces a Mongo-backed implementation into a particular id scheme: a real implementation (see this
 * file's own top-level doc) is free to persist this value as a native `_id` (Mongo accepts a
 * caller-supplied `_id`, exactly like every other value) rather than inventing a parallel id field.
 */
export interface CreateAssetInput {
  /** Caller-assigned asset id — see this interface's own doc above for why. */
  id: string
  /** The asset's kind (`image`/`video`/`audio`/...), copied verbatim onto the created `AssetRecord`. */
  kind: AssetKind
  /** The original filename as sent by the client, when one was recorded — never derived/guessed. */
  originalFilename?: string
  /** MIME type of the original upload, as recorded by `AssetStorage.put()`. */
  contentType: string
  /** Byte size of the original upload, as recorded by `AssetStorage.put()`. */
  size: number
  /** Checksum of the original upload, as recorded by `AssetStorage.put()`. */
  checksum: string
  /** Logical storage key of the original upload — see `../keys.ts`. */
  storageKey: string
}

/** Partial update applied to an existing `AssetRecord` — every field is optional, only the ones
 * present are changed. */
export interface UpdateAssetInput {
  /** New lifecycle status, when the update is a status transition. */
  status?: AssetStatus
  /** New/replaced variant list, when the update adds or replaces transformed variants. */
  variants?: AssetVariant[]
  /** Set alongside `status: 'failed'` to record why the transformation failed. */
  error?: { message: string }
}

/** The METADATA port a real deployment implements — see this module's own top-level doc for the
 * intended Mongo mapping. */
export interface AssetRepository {
  /** Persists a new record for an asset whose id/bytes already exist — never generates `id` itself. */
  create(input: CreateAssetInput): Promise<AssetRecord>
  /** `undefined` when `id` doesn't exist — never throws for a missing record. */
  findById(id: string): Promise<AssetRecord | undefined>
  /** Applies `changes` on top of the existing record; rejects when `id` doesn't exist. */
  update(id: string, changes: UpdateAssetInput): Promise<AssetRecord>
  /** Removes the record for `id`. */
  delete(id: string): Promise<void>
}
