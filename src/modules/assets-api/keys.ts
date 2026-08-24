/**
 * Builds the ONE, logical, backend-independent storage key for a given asset/variant — the only
 * place `assets-api` ever constructs a `storageKey` string. Deliberately opaque to any real
 * backend: no file extension (a variant's real format lives in `AssetVariant.format`/
 * `contentType`, never encoded into the key itself), no absolute path, no bucket/container
 * concept — `/`-separated only. `AssetStorage` implementations (`InMemoryAssetStorage`,
 * `LocalFilesystemAssetStorage`, and `S3ObjectStorage` — `@zanix/datamaster/storage`, a
 * generic object store a consuming application composes in, see `src/@tests/support/
 * resolve-asset-storage.ts`) treat this as a fully opaque string; none of them, and nothing in
 * `AssetService`, ever builds a key any other way.
 *
 * @module
 */

export function buildOriginalStorageKey(assetId: string): string {
  return `assets/${assetId}/original`
}

/** Builds the logical storage key for one variant of an asset. */
export function buildVariantStorageKey(assetId: string, variantId: string): string {
  return `assets/${assetId}/variants/${variantId}`
}
