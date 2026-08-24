/**
 * The BYTES port — put/get/delete/exists over an opaque `key`. Deliberately knows nothing about
 * Mongo, asset metadata, or any backend technology: `InMemoryAssetStorage`/
 * `LocalFilesystemAssetStorage` (this package, `../adapters/`) and `S3ObjectStorage`
 * (`@zanix/datamaster/storage`) all satisfy this SAME interface with no change here.
 * `S3ObjectStorage` is a generic object store, not written against this port — it
 * structurally satisfies it (identical `put`/`get`/`delete`/`exists` shape) without this package or
 * `@zanix/datamaster` importing each other's types; a consuming application composes it in, see
 * `src/@tests/support/resolve-asset-storage.ts`. See `../keys.ts`'s own doc for who builds `key`
 * values — never this port's own implementations, and never this file.
 *
 * @module
 */

/** One stored object's own real properties, as reported back by `put`/`get` — never the bytes
 * themselves (a separate stream, see below). */
export interface AssetObject {
  /** The logical key this object was stored/retrieved under — see `../keys.ts`. */
  key: string
  /** MIME type as actually stored, never assumed from the caller's own claim. */
  contentType: string
  /** Byte size as actually stored. */
  size: number
  /** Checksum as actually stored. */
  checksum: string
}

/** The BYTES port a real deployment implements — see this module's own top-level doc. */
export interface AssetStorage {
  /** Persists `data` under `key`, returning the real, stored object's own properties (size/
   * checksum as actually written — never assumed from the caller's own claim). */
  put(
    key: string,
    data: Uint8Array | ReadableStream<Uint8Array>,
    meta: { contentType: string },
  ): Promise<AssetObject>
  /** `undefined` when `key` doesn't exist — never throws for a missing object. */
  get(
    key: string,
  ): Promise<{ stream: ReadableStream<Uint8Array>; object: AssetObject } | undefined>
  /** A no-op when `key` doesn't exist — deleting something already gone is not an error. */
  delete(key: string): Promise<void>
  /** Whether `key` currently exists in the store. */
  exists(key: string): Promise<boolean>
}
