/**
 * Shared types for the Asset Application/HTTP API (`@zanix/space/assets-api`) — the layer ABOVE
 * `modules/asset-transform/` (pure transformation) and the layer that owns upload/persist/query
 * concerns. See this subpath's own `mod.ts` doc for the full contract and the one-way dependency
 * boundary (`assets-api -> asset-transform`, never reversed) enforced by
 * `src/@tests/unit/asset-transform/dependency-boundary.test.ts`.
 *
 * @module
 */

import type { AssetKind } from '../asset-transform/types.ts'
import type { VoiceAudioFormat, VoiceAudioTransformOptions } from '../media/audio/policies/voice.ts'
import type { VideoBreakpointName } from '../media/video-breakpoints.ts'

/** Re-exported because `AssetTransformRequest` (below) references it, and a type reachable from
 * this module's own public surface must itself be nameable from here — see `asset-transform/types.ts`
 * for the full contract (the same `'image' | 'video' | 'thumbnail' | 'audio'` shape shared with
 * `@zanix/space/assets`). */
export type { AssetKind }
/** Re-exported for the same reason `AssetKind` is above: `AssetTransformRequest` (below)
 * references all three (`VoiceAudioFormat` transitively, via `VoiceAudioTransformOptions.format`),
 * and a type reachable from this module's own public surface must itself be nameable from here —
 * not just from `@zanix/space/media`, where each is ALSO public. */
export type { VideoBreakpointName, VoiceAudioFormat, VoiceAudioTransformOptions }

/**
 * Real lifecycle of one asset's own transformation — deliberately compatible with a FUTURE async
 * dispatcher (see `ports/job-dispatcher.ts`'s own doc): `'pending'` the moment the record is
 * created, `'processing'` once a dispatcher actually starts running the transform, `'completed'`/
 * `'failed'` as real terminal states — never skipped, even though today's default
 * `InlineJobDispatcher` runs through all four synchronously within one request/response cycle.
 */
export type AssetStatus = 'pending' | 'processing' | 'completed' | 'failed'

/** Fields common to every variant, regardless of kind — see the per-kind extensions below for
 * what's genuinely kind-specific. `transformId`/`policyVersion` mirror the SAME identity concepts
 * `modules/assets/transform-cache.ts` already establishes — never a parallel scheme. */
export interface AssetVariantBase {
  /** Unique id for this specific variant — distinct from the owning asset's own `id`. */
  variantId: string
  /** File format/extension label, e.g. `'jpg'`, `'opus'` — never includes the leading dot. */
  format: string
  /** MIME type of this variant's bytes. */
  contentType: string
  /** Logical, backend-independent key — see `keys.ts`'s own doc. Never a filesystem path, bucket
   * name, or any other backend-specific identifier. */
  storageKey: string
  /** Byte size of the stored variant. */
  size: number
  /** Content hash of the stored variant. */
  checksum: string
  /** Identifies the exact transform that produced this variant — see `transform-cache.ts`. */
  transformId: string
  /** Version of the transform policy applied, bumped whenever its output would change. */
  policyVersion: string
}

/** A variant produced by image optimization — optimized bytes, no responsive breakpoints. */
export interface ImageAssetVariant extends AssetVariantBase {
  /** Discriminant identifying this as an image variant. */
  kind: 'image'
  /** Pixel width of the image, when known. */
  width?: number
  /** Pixel height of the image, when known. */
  height?: number
}

/** A variant produced by video transcoding at a given breakpoint/format. */
export interface VideoAssetVariant extends AssetVariantBase {
  /** Discriminant identifying this as a video variant. */
  kind: 'video'
  /** Pixel width of the video, when known. */
  width?: number
  /** Pixel height of the video, when known. */
  height?: number
  /** Playback duration in seconds, when known. */
  durationSeconds?: number
  /** Encoded bitrate in kilobits per second, when known. */
  bitrateKbps?: number
}

/** A still-image thumbnail derived from a video or image asset. */
export interface ThumbnailAssetVariant extends AssetVariantBase {
  /** Discriminant identifying this as a thumbnail variant. */
  kind: 'thumbnail'
  /** Pixel width of the thumbnail, when known. */
  width?: number
  /** Pixel height of the thumbnail, when known. */
  height?: number
}

/** The one real, implemented audio profile today. `profile` is its own discriminant nested inside
 * the `kind: 'audio'` member — a future profile (`'music'`, ...) is a new value of THIS field,
 * never a new top-level `AssetVariant` member, matching `modules/media/audio/`'s own "profile,
 * not a new kind" architecture. */
export interface AudioAssetVariant extends AssetVariantBase {
  /** Discriminant identifying this as an audio variant. */
  kind: 'audio'
  /** The audio profile applied — today only `'voice'` is implemented. */
  profile: 'voice'
  /** Sample rate in Hertz, when known. */
  sampleRateHz?: number
  /** Channel count (1 = mono, 2 = stereo), when known. */
  channels?: number
  /** Playback duration in seconds, when known. */
  durationSeconds?: number
}

/** Every variant an asset can have — a real discriminated union, never a shared bag of optional
 * fields every kind has to tolerate. Adding a new kind/profile later is a new union member here,
 * never a change to `AssetVariantBase`. */
export type AssetVariant =
  | ImageAssetVariant
  | VideoAssetVariant
  | ThumbnailAssetVariant
  | AudioAssetVariant

/** One persisted asset's own METADATA — never its bytes. See `ports/asset-repository.ts`'s own
 * doc for why: `AssetRepository` is the metadata port, `AssetStorage` is the bytes port, and
 * nothing in this codebase ever lets the two mix. */
export interface AssetRecord {
  /** Unique identifier for the asset, assigned at creation. */
  id: string
  /** The transform family this asset belongs to. */
  kind: AssetKind
  /** Current lifecycle state — see `AssetStatus`. */
  status: AssetStatus
  /** Filename supplied by the uploader, when provided. */
  originalFilename?: string
  /** MIME type of the original upload. */
  contentType: string
  /** Byte size of the original upload. */
  size: number
  /** Content hash of the original upload. */
  checksum: string
  /** Logical storage key for the ORIGINAL upload — see `keys.ts`. */
  storageKey: string
  /** Transformed outputs produced from the original upload. */
  variants: AssetVariant[]
  /** Set only when `status === 'failed'`. */
  error?: { message: string }
  /** ISO timestamp of when the record was created. */
  createdAt: string
  /** ISO timestamp of the most recent update to the record. */
  updatedAt: string
}

/**
 * What `AssetService.createAsset()` (and, downstream, `JobDispatcher`) is actually being asked to
 * DO — a discriminated union so a future profile/kind is a new member here, never a redesign of
 * `AssetService` or the ports. Lives in THIS types module (kind-generic, already depended on by
 * both the service and the ports) rather than in `ports/job-dispatcher.ts` — that port only ever
 * sees a value of this type as opaque `unknown`, specifically so it never has to import
 * `VoiceAudioTransformOptions` or know a single profile/codec concept exists.
 *
 * `outputPath` is deliberately omitted from the audio member's `options` — it's an internal,
 * transform-time detail (a temp file path `AssetService` decides), never something an HTTP caller
 * supplies. `profile` is omitted too — it's already carried at the top level, so `options` never
 * repeats it.
 *
 * `'image'` takes no options — it always runs `AssetTransformer.transformImage(..., true)`, the
 * simplest case (optimize in place, no responsive breakpoints/format conversion — see
 * `asset-transformer.ts`'s own `ImagesOptimizeOptions` doc for what those would add). `'video'`
 * exposes only `breakpoint`/`format`, mirroring the audio member's own minimal, HTTP-caller-facing
 * surface — never `width`/`bitrateKbps`/`outputPath`, which stay `AssetService`'s own transform-time
 * decisions.
 */
export type AssetTransformRequest =
  | {
    kind: 'audio'
    profile: 'voice'
    options: Omit<VoiceAudioTransformOptions, 'outputPath' | 'profile'>
  }
  | { kind: 'image' }
  | { kind: 'video'; options?: { breakpoint?: VideoBreakpointName; format?: 'mp4' | 'webm' } }
