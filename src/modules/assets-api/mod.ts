/**
 * Asset Application/HTTP API — the `@zanix/space/assets-api` entry point.
 *
 * Layering: `HTTP (ZanixController) -> AssetService -> {AssetTransformer (existing, ./assets/
 * ./media, untouched), AssetStorage, AssetRepository, JobDispatcher}`. One-way dependency on
 * `modules/asset-transform/` only — never imported BY it, enforced by
 * `src/@tests/unit/asset-transform/dependency-boundary.test.ts`. Mongo/S3 are NOT
 * implemented here, and never will be — only the ports (`AssetRepository`/`AssetStorage`) this
 * package owns, plus **structurally-typed adapters** that map a generic infrastructure shape onto
 * those ports without ever importing the package that provides it — this module never imports
 * `@zanix/datamaster` (enforced by `dependency-boundary.test.ts`, which proves this package's own
 * published surface never reaches it), even though `createAssetRepositoryOverFiles` is written to
 * accept exactly the shape `@zanix/datamaster/files`'s `MongoFileRepository` has.
 *
 * `AssetStorage` needs no adapter of its own — `S3ObjectStorage` (`@zanix/datamaster/storage`)
 * already structurally satisfies it (identical `put`/`get`/`delete`/`exists` shape). Only the
 * metadata side needs one: `createAssetRepositoryOverFiles` (`adapters/asset-repository-over-files.ts`)
 * maps `AssetRecord`'s domain fields (`kind`/`status`/`variants`/`error`) onto a generic file
 * registry's free-form `metadata` bag, given any object matching `FileRepositoryLike` (a real
 * `MongoFileRepository` in production).
 *
 * A consuming application still composes the pieces: constructing `S3ObjectStorage`/
 * `MongoFileRepository`, deciding local-fallback/S3-switch policy, and calling
 * `createAssetService({ storage, repository })`. `@zanix/core`'s own `Zanix.setup({ assets })` does
 * exactly this composition automatically for a `@zanix/core`-based app — see that package's own
 * docs. `src/@tests/support/resolve-asset-storage.ts` remains a worked, hand-rolled reference
 * example for an app that isn't using `@zanix/core`.
 *
 * @module
 */

export { createAssetService, DEFAULT_ASSET_LIMITS } from './asset-service.ts'
export type {
  /** Per-kind maximum upload size, in bytes — every field optional, an omitted kind falls back to
   * {@linkcode DEFAULT_ASSET_LIMITS}. */
  AssetLimits,
  /** The composed Asset Application API `createAssetService` builds. */
  AssetService,
  /** Dependencies `createAssetService()` composes into a working `AssetService` — only `storage`
   * and `repository` are required. */
  AssetServiceOptions,
  /** Input to `AssetService.createAsset()` — the uploaded bytes plus what to do with them. */
  CreateAssetCommand,
} from './asset-service.ts'

export type {
  /** `'audio' | 'image' | 'video'`, re-exported from `modules/asset-transform` — the build-time
   * pipeline `@zanix/space/assets` documents — since both layers share the same kind concept. */
  AssetKind,
  /** One uploaded asset's full metadata + variants — the shape `GET /assets/:id` returns. */
  AssetRecord,
  /** `AssetRecord.status`'s real lifecycle: `'pending' | 'processing' | 'completed' | 'failed'` —
   * never skipped, even though the default `InlineJobDispatcher` runs through all four
   * synchronously within one request. */
  AssetStatus,
  /** The discriminated union `CreateAssetCommand.transformRequest` takes — a controller (not
   * application code) is the only place this package itself constructs one. */
  AssetTransformRequest,
  /** Discriminated union of every real variant kind: `ImageAssetVariant` / `VideoAssetVariant` /
   * `ThumbnailAssetVariant` / `AudioAssetVariant`. */
  AssetVariant,
  /** Fields common to every {@linkcode AssetVariant}, regardless of kind. */
  AssetVariantBase,
  /** A variant produced by voice-profile audio transcoding. */
  AudioAssetVariant,
  /** A variant produced by image optimization. */
  ImageAssetVariant,
  /** A still-image thumbnail derived from a video or image asset. */
  ThumbnailAssetVariant,
  /** A variant produced by video transcoding at a given breakpoint/format. */
  VideoAssetVariant,
  /** A named video transcoding breakpoint (`'msm' | 'mlg' | 'dmd' | 'dlg'`), re-exported from
   * `@zanix/space/media` since `AssetTransformRequest`'s `'video'` member references it. */
  VideoBreakpointName,
  /** Target voice audio codec/container (`'aac' | 'opus'`), re-exported from `@zanix/space/media`
   * for the same reason as `VideoBreakpointName`. */
  VoiceAudioFormat,
  /** Options for a voice audio transcode, re-exported from `@zanix/space/media` since
   * `AssetTransformRequest`'s `'audio'` member references it. */
  VoiceAudioTransformOptions,
} from './typings.ts'

export { buildOriginalStorageKey, buildVariantStorageKey } from './keys.ts'

export type { AssetObject, AssetStorage } from './ports/asset-storage.ts'
export type {
  AssetRepository,
  CreateAssetInput,
  UpdateAssetInput,
} from './ports/asset-repository.ts'
export type { AssetTransformationJobInput, JobDispatcher } from './ports/job-dispatcher.ts'

export { createInMemoryAssetStorage } from './adapters/in-memory-asset-storage.ts'
export { createInMemoryAssetRepository } from './adapters/in-memory-asset-repository.ts'
export { createLocalFilesystemAssetStorage } from './adapters/local-filesystem-asset-storage.ts'
export { createAssetRepositoryOverFiles } from './adapters/asset-repository-over-files.ts'
export type {
  CreateFileInputLike,
  FileRecordLike,
  FileRepositoryLike,
  UpdateFileInputLike,
} from './adapters/asset-repository-over-files.ts'
export { createInlineJobDispatcher } from './adapters/inline-job-dispatcher.ts'
export type { InlineJobDispatcherOptions } from './adapters/inline-job-dispatcher.ts'

export type {
  /** The real upload read directly off an untouched `Request` — `stream`/`contentType`, plus an
   * optional `filename`/`size` when the client sent them. */
  UploadedAsset,
} from './upload.ts'
export { readUploadedAssetFromRequest } from './upload.ts'

export { createAssetsController } from './controllers/assets.controller.ts'
export type {
  /** The `ZanixController` class `createAssetsController` returns. */
  AssetsControllerInstance,
  /** Options for {@linkcode createAssetsController}: `service`/`prefix`/`guards`. */
  AssetsControllerOptions,
} from './controllers/assets.controller.ts'
export { denyAllGuard } from './controllers/guards/deny-all-guard.ts'
export {
  AssetIdParamsRTO,
  VideoUploadQueryRTO,
  VoiceUploadQueryRTO,
} from './controllers/rtos/assets.rto.ts'
/** Re-exported because `AssetIdParamsRTO`/`VideoUploadQueryRTO`/`VoiceUploadQueryRTO` (above) all
 * extend it — see `@zanix/server`'s own `mod.ts` for the same reasoning applied to its own RTOs. */
export type { BaseRTO } from '@zanix/validator'
