/**
 * Adapts a generic file-record registry — the exact shape `@zanix/datamaster/files`'s
 * `MongoFileRepository` already has — into this package's own `AssetRepository` port, mapping
 * `AssetRecord`'s domain fields (`kind`/`status`/`variants`/`error`) onto the generic registry's
 * free-form `metadata` bag, exactly as `ports/asset-repository.ts`'s own top-level doc already
 * describes as the intended real-deployment mapping.
 *
 * `FileRepositoryLike`/`FileRecordLike` below are declared STRUCTURALLY, here, rather than
 * imported from `@zanix/datamaster/files` — this package never imports `@zanix/datamaster`
 * anywhere in its own published graph (enforced by `dependency-boundary.test.ts`), and doesn't
 * need to: any object satisfying this shape works, `MongoFileRepository` included, without either
 * package's types needing to know about the other's existence.
 *
 * @module
 */

import { HttpError, InternalError } from '@zanix/errors'
import type { AssetKind, AssetRecord, AssetStatus, AssetVariant } from '../typings.ts'
import type {
  AssetRepository,
  CreateAssetInput,
  UpdateAssetInput,
} from '../ports/asset-repository.ts'

/** One persisted file's own real properties — the exact shape `@zanix/datamaster/files`'s
 * `FileRecord` already has. Declared here structurally (see this module's own top-level doc for
 * why), not imported. */
export interface FileRecordLike {
  /** The record's own persisted id — the same value as the owning `AssetRecord.id`. */
  id: string
  /** Storage key the underlying bytes were written under. */
  key: string
  /** MIME type as recorded by the underlying registry. */
  contentType: string
  /** Byte size as recorded by the underlying registry. */
  size: number
  /** Checksum as recorded by the underlying registry. */
  checksum: string
  /** Original filename, when one was recorded. */
  filename?: string
  /** Free-form bag `toAssetRecord`/`create`/`update` pack the `AssetMetadata` fields into. */
  metadata?: Record<string, unknown>
  /** ISO timestamp of when the record was first created. */
  createdAt: string
  /** ISO timestamp of the record's last update. */
  updatedAt: string
}

/** Mirrors `@zanix/datamaster/files`'s own `CreateFileInput`. */
export interface CreateFileInputLike {
  /** Caller-assigned id for the new record. */
  id: string
  /** Storage key the bytes are already stored under. */
  key: string
  /** MIME type of the bytes being recorded. */
  contentType: string
  /** Byte size of the bytes being recorded. */
  size: number
  /** Checksum of the bytes being recorded. */
  checksum: string
  /** Original filename, when known. */
  filename?: string
  /** Free-form metadata bag to persist alongside the record. */
  metadata?: Record<string, unknown>
}

/** Mirrors `@zanix/datamaster/files`'s own `UpdateFileInput`. */
export interface UpdateFileInputLike {
  /** New checksum, when changed. */
  checksum?: string
  /** New byte size, when changed. */
  size?: number
  /** New MIME type, when changed. */
  contentType?: string
  /** New filename, when changed. */
  filename?: string
  /** Replacement metadata bag — replaces the existing one wholesale, matching a plain Mongo `$set`. */
  metadata?: Record<string, unknown>
}

/** Mirrors `@zanix/datamaster/files`'s own `MongoFileRepository` public method shape — a
 * consuming application passes a real `MongoFileRepository` instance here; nothing about this
 * type requires it specifically. */
export interface FileRepositoryLike {
  /** Persists a new file record. */
  create(input: CreateFileInputLike): Promise<FileRecordLike>
  /** `undefined` when `id` doesn't exist — never throws for a missing record. */
  findById(id: string): Promise<FileRecordLike | undefined>
  /** Applies `changes` on top of the record for `id`, replacing `metadata` wholesale when present. */
  update(id: string, changes: UpdateFileInputLike): Promise<FileRecordLike>
  /** Removes the record for `id`. */
  delete(id: string): Promise<void>
}

/** The Asset-domain fields this adapter packs into/reads back from `FileRecordLike.metadata` —
 * never interpreted by the file registry itself, only by this adapter. */
interface AssetMetadata {
  kind?: AssetKind
  status?: AssetStatus
  variants?: AssetVariant[]
  error?: { message: string }
}

function readMetadata(file: FileRecordLike): AssetMetadata {
  return (file.metadata ?? {}) as AssetMetadata
}

/**
 * Maps a `FileRecordLike` (as read back from the underlying registry) to this package's own
 * `AssetRecord` — the inverse of what `create()`/`update()` below write into `metadata`.
 *
 * @throws {InternalError} If `metadata.kind`/`metadata.status` are missing — this would mean the
 * underlying record was never actually created through THIS adapter's own `create()` (which
 * always writes both), a real data-integrity problem worth failing loudly on rather than guessing
 * a kind/status that was never really decided.
 */
function toAssetRecord(file: FileRecordLike): AssetRecord {
  const meta = readMetadata(file)
  if (!meta.kind || !meta.status) {
    throw new InternalError(
      `File record "${file.id}" is missing its Asset kind/status metadata — it was never ` +
        'created through createAssetRepositoryOverFiles(), or its metadata was overwritten ' +
        'externally.',
      { code: 'SPACE_ASSETS_FILE_RECORD_METADATA_MISSING', meta: { source: 'zanix', id: file.id } },
    )
  }
  return {
    id: file.id,
    kind: meta.kind,
    status: meta.status,
    originalFilename: file.filename,
    contentType: file.contentType,
    size: file.size,
    checksum: file.checksum,
    storageKey: file.key,
    variants: meta.variants ?? [],
    error: meta.error,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  }
}

/**
 * Adapts `files` (a generic file-record registry — a real `MongoFileRepository` in production)
 * into a real `AssetRepository`. `id` is always the caller-assigned value `AssetService` already
 * generates (see `ports/asset-repository.ts`'s own doc) — this adapter never invents or
 * re-derives it.
 *
 * `update()` does a real read-modify-write of `metadata`: the underlying registry's own
 * `update()` contract replaces `metadata` wholesale (it has no partial-field semantics of its
 * own, matching a plain Mongo `$set`), so this adapter reads the CURRENT record first and merges
 * `changes` on top of its existing `kind`/`status`/`variants`/`error` before writing the full
 * metadata object back — the same merge shape `InMemoryAssetRepository`'s own in-process `update()`
 * already has (an omitted field in `changes` never clears a previously-set one; only a field
 * actually present in `changes` overrides).
 *
 * @throws {HttpError} `NOT_FOUND` from `update()` when `id` doesn't exist — checked directly by
 * this adapter (it needs the read anyway for the metadata merge), so this never depends on
 * `files.update()`'s own not-found behavior.
 */
export function createAssetRepositoryOverFiles(files: FileRepositoryLike): AssetRepository {
  return {
    async create(input: CreateAssetInput): Promise<AssetRecord> {
      const created = await files.create({
        id: input.id,
        key: input.storageKey,
        contentType: input.contentType,
        size: input.size,
        checksum: input.checksum,
        filename: input.originalFilename,
        metadata: {
          kind: input.kind,
          status: 'pending',
          variants: [],
        } satisfies AssetMetadata,
      })
      return toAssetRecord(created)
    },

    async findById(id: string): Promise<AssetRecord | undefined> {
      const found = await files.findById(id)
      return found ? toAssetRecord(found) : undefined
    },

    async update(id: string, changes: UpdateAssetInput): Promise<AssetRecord> {
      const existing = await files.findById(id)
      if (!existing) {
        throw new HttpError('NOT_FOUND', { meta: { id, source: 'zanix' } })
      }
      const existingMeta = readMetadata(existing)
      const updated = await files.update(id, {
        metadata: {
          kind: existingMeta.kind,
          status: changes.status ?? existingMeta.status,
          variants: changes.variants ?? existingMeta.variants ?? [],
          error: changes.error ?? existingMeta.error,
        } satisfies AssetMetadata,
      })
      return toAssetRecord(updated)
    },

    async delete(id: string): Promise<void> {
      await files.delete(id)
    },
  }
}
