/**
 * Pure data-shape types for the Asset Application API — `CreateAssetCommand`, `AssetLimits`,
 * `DEFAULT_ASSET_LIMITS`, `AssetServiceOptions`, `AssetService` — deliberately split from
 * `asset-service.ts` itself, which unconditionally value-imports `createAssetTransformer`
 * (transitively `sharp`-backed, via `../asset-transform/asset-transformer.ts`). None of these
 * reference anything beyond `./typings.ts`, `./upload.ts`, `./ports/*`, and
 * `../asset-transform/types.ts` (all `sharp`-free), so a consumer that only needs to type an
 * options object or a return value — e.g. `mod.ts`'s own re-exports — never resolves `sharp`
 * merely by reading this file. Re-exported unchanged from `asset-service.ts`, so switching that
 * import site between "the real file" and "this types file" is never a breaking change in either
 * direction.
 *
 * @module
 */

import type { AssetTransformer } from '../asset-transform/types.ts'
import type { AssetRepository } from './ports/asset-repository.ts'
import type { AssetStorage } from './ports/asset-storage.ts'
import type { JobDispatcher } from './ports/job-dispatcher.ts'
import type { UploadedAsset } from './upload.ts'
import type { AssetRecord, AssetTransformRequest } from './typings.ts'

/** Input to `AssetService.createAsset()` — the uploaded bytes plus what to do with them. */
export interface CreateAssetCommand {
  /** The raw uploaded bytes and their original metadata. */
  upload: UploadedAsset
  /** What transform to run against the upload — see `AssetTransformRequest`. */
  transformRequest: AssetTransformRequest
}

/**
 * Per-kind maximum upload size, in bytes — see `AssetServiceOptions.limits`'s own doc for the
 * two-layer defense these back and why they're operator-configured, never caller-requested.
 * Every field is optional; an omitted kind falls back to `DEFAULT_ASSET_LIMITS`.
 */
export interface AssetLimits {
  /** Max bytes for `kind: 'image'`. Default: 25MB. */
  image?: number
  /** Max bytes for `kind: 'audio'`. Default: 50MB. */
  audio?: number
  /** Max bytes for `kind: 'video'`. Default: 200MB. */
  video?: number
}

/**
 * Real defaults `AssetServiceOptions.limits` falls back to per kind, chosen conservatively rather
 * than as one generic ceiling: an image upload is buffered whole in memory and then re-encoded by
 * `sharp` (a second, decoded in-memory copy), so its default stays the smallest. Audio/video are
 * additionally written to an on-disk temp file before/after transcoding (`Deno.writeFile`/
 * `Deno.readFile` in `runVoiceTransformation`/`runVideoTransformation`), which makes their
 * PROPORTIONAL in-memory cost per byte cheaper than an image's — but the cost is still real, hence
 * still-real (if higher) caps rather than no cap at all. Video gets the highest default since
 * legitimate video uploads are routinely large; a deployment that genuinely needs to accept larger
 * files than any of these configures `AssetServiceOptions.limits` explicitly rather than inheriting
 * an unbounded default.
 */
export const DEFAULT_ASSET_LIMITS: Required<AssetLimits> = {
  image: 25 * 1024 * 1024,
  audio: 50 * 1024 * 1024,
  video: 200 * 1024 * 1024,
}

/** Dependencies `createAssetService()` composes into a working `AssetService`. */
export interface AssetServiceOptions {
  /** Default: `createAssetTransformer()` with no cache — a real caller almost always wants to pass
   * an explicit, cached one (e.g. `createAssetTransformer({cacheDir})`), same as `assetsPlugin`/
   * `mediaPlugin` do; this option exists so `AssetService` never constructs a second, hidden one a
   * caller can't see or configure. */
  transformer?: AssetTransformer
  /** Port for persisting/retrieving asset bytes. */
  storage: AssetStorage
  /** Port for persisting/querying asset metadata. */
  repository: AssetRepository
  /** Default: `createInlineJobDispatcher(...)` — see that module's own doc. */
  jobs?: JobDispatcher
  /**
   * Per-kind max upload size, in bytes — see `DEFAULT_ASSET_LIMITS` for the defaults an omitted
   * kind falls back to. Same "operator-configured, never caller-requested" posture
   * `auth-service-credential`'s own permissions/rate-limits establish: the HTTP caller can never
   * raise or bypass this from the request itself (nothing in `UploadedAsset`/`AssetTransformRequest`
   * carries a limit), only the process that constructs `AssetService` can.
   *
   * Enforced in two layers by `createAsset()`, both real, neither alone sufficient: a fast reject
   * against `UploadedAsset.size` (the `Content-Length` header) when the client sent one — cheap,
   * but `Content-Length` is optional and client-controlled, so this alone is not a real defense —
   * followed by `readBoundedBytes()` enforcing the same cap against bytes actually read while
   * buffering the upload, which is what actually protects memory when `Content-Length` is absent
   * (e.g. chunked transfer-encoding) or simply lied about.
   */
  limits?: AssetLimits
}

/** The composed Asset Application API — see `asset-service.ts`'s own module doc for what it wires
 * together. */
export interface AssetService {
  /** Uploads and persists an asset, then runs its transform to produce the first variant. */
  createAsset(command: CreateAssetCommand): Promise<AssetRecord>
  /** Looks up a persisted asset's metadata by id. */
  getAsset(id: string): Promise<AssetRecord | undefined>
  /** `variantId` omitted downloads the ORIGINAL upload. `undefined` when the asset, or the
   * requested variant, doesn't exist. */
  downloadVariant(
    id: string,
    variantId?: string,
  ): Promise<
    { stream: ReadableStream<Uint8Array>; contentType: string; size: number } | undefined
  >
}
