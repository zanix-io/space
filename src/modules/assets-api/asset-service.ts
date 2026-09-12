/**
 * The Asset Application API — the ONE place that composes `AssetTransformer` + `AssetStorage` +
 * `AssetRepository` + `JobDispatcher` into real behavior. Controllers (`controllers/
 * assets.controller.ts`) are a thin HTTP adapter over this; build-time (`assetsPlugin`/
 * `mediaPlugin`, `modules/bundler/`) never touches this file at all — it calls
 * `createAssetTransformer()` directly, exactly as before this subpath existed. See this subpath's
 * own `mod.ts` doc for the full layering.
 *
 * `createAsset()` is the ONE generic entrypoint — there is deliberately no `createVoiceAsset()`/
 * `createImageAsset()` special-casing here. The CALLER (today: `controllers/assets.controller.ts`,
 * the only place `'voice'` is named at the HTTP layer) constructs the
 * `{kind:'audio', profile:'voice', ...}` command; this file interprets it via `runTransformation`,
 * the one place `AssetTransformRequest`'s real shape is read.
 *
 * @module
 */

import { generateUUID } from '@zanix/helpers'
import { HttpError, InternalError } from '@zanix/errors'
import { createAssetTransformer } from '../asset-transform/asset-transformer.ts'
import { hashSourceBytes } from '../assets/transform-cache.ts'
import { contentTypeFor } from '../assets/content-type.ts'
import {
  buildVoiceTransformId,
  VOICE_TRANSFORM_POLICY_VERSION,
} from '../media/audio/policies/voice.ts'
import type { VoiceAudioTransformOptions } from '../media/audio/policies/voice.ts'
import {
  THUMBNAIL_TRANSFORM_POLICY_VERSION,
  VIDEO_TRANSFORM_POLICY_VERSION,
} from '../media/cached-video-transcoder.ts'
import type { VideoBreakpointName } from '../media/video-breakpoints.ts'
import type { ImagesOptimizeOptions } from '../assets/image-optimize-types.ts'
import { buildOriginalStorageKey, buildVariantStorageKey } from './keys.ts'
import { readAllBytes, readBoundedBytes } from './read-all-bytes.ts'
import { matchesImageSignature } from './magic-bytes.ts'
import type { AssetTransformationJobInput } from './ports/job-dispatcher.ts'
import { createInlineJobDispatcher } from './adapters/inline-job-dispatcher.ts'
import type { AssetRecord, AssetTransformRequest, AssetVariant } from './typings.ts'
import type {
  AssetLimits,
  AssetService,
  AssetServiceOptions,
  CreateAssetCommand,
} from './asset-service-types.ts'
import { DEFAULT_ASSET_LIMITS } from './asset-service-types.ts'

export type { AssetLimits, AssetService, AssetServiceOptions, CreateAssetCommand }
export { DEFAULT_ASSET_LIMITS }

/** Builds an `AssetService` from the given ports/dependencies, defaulting any that are omitted. */
export function createAssetService(options: AssetServiceOptions): AssetService {
  const { storage, repository } = options
  const transformer = options.transformer ?? createAssetTransformer()
  const limits: Required<AssetLimits> = { ...DEFAULT_ASSET_LIMITS, ...options.limits }

  /**
   * The ONE place `AssetTransformRequest`'s real shape is read — everything above this function
   * (`JobDispatcher`, `InlineJobDispatcher`) only ever sees `transformRequest` as `unknown`. Always
   * resolves to an ARRAY: every kind but `'image'` (with `options`) produces exactly one variant,
   * but `'image'` alone can produce several — one per surviving breakpoint/format combination (see
   * `runImageTransformation`'s own doc) — so the return shape is uniform across every kind rather
   * than special-casing image at every call site.
   */
  async function runTransformation(input: AssetTransformationJobInput): Promise<AssetVariant[]> {
    const request = input.transformRequest as AssetTransformRequest

    const source = await storage.get(input.sourceKey)
    if (!source) {
      throw new HttpError('NOT_FOUND', {
        meta: { source: 'zanix', reason: `Source "${input.sourceKey}" not found in storage.` },
      })
    }
    const sourceBytes = await readAllBytes(source.stream)

    switch (request.kind) {
      case 'audio':
        return [
          await runVoiceTransformation(
            input.assetId,
            input.sourceKey,
            sourceBytes,
            source.object.contentType,
            request.options,
          ),
        ]
      case 'image':
        return await runImageTransformation(
          input.assetId,
          sourceBytes,
          source.object.contentType,
          request.options,
        )
      case 'video':
        return await runVideoTransformation(
          input.assetId,
          input.sourceKey,
          sourceBytes,
          source.object.contentType,
          request.options,
        )
      default: {
        // Exhaustiveness guard — mirrors `system-ffmpeg-audio-transcoder.ts`'s own pattern. Now
        // checked against the whole `request` (every member handled above narrows it to `never`
        // here), not `request.kind` alone — the original single-member union made both equivalent,
        // but a real union needs the full-value check to stay exhaustive.
        const exhaustive: never = request
        throw new HttpError('BAD_REQUEST', {
          meta: { source: 'zanix', kind: (exhaustive as { kind: string }).kind },
        })
      }
    }
  }

  async function runVoiceTransformation(
    assetId: string,
    originalStorageKey: string,
    sourceBytes: Uint8Array,
    sourceContentType: string,
    requestOptions: Omit<VoiceAudioTransformOptions, 'outputPath' | 'profile'>,
  ): Promise<AssetVariant> {
    // The temp file's own extension must reflect the REAL uploaded content-type, never a
    // hardcoded assumption. `validateVoiceSource` (`modules/media/audio/policies/voice.ts`) only
    // protects against a lossy re-encode by inspecting `sourcePath`'s own extension — a
    // hardcoded `.wav` suffix here would silently DEFEAT that guardrail for every upload,
    // regardless of what was actually sent (it would always pass the extension check). A strict,
    // exact match against `audio/wav` — the one real content-type `content-type.ts` maps `.wav`
    // to, and the one every existing caller already sends — is the conservative, correct choice:
    // anything else deliberately reaches the guardrail as a non-`.wav` extension and is rejected
    // with the SAME actionable error a direct `AssetTransformer.transformAudio()` caller gets
    // (surfaced as `AssetRecord.status: 'failed'`, same as any other transform failure — see
    // `JobDispatcher`'s own doc for why an invalid input is never a synchronous 400 here).
    const sourceExtension = sourceContentType === 'audio/wav' ? '.wav' : '.bin'
    const sourcePath = await Deno.makeTempFile({ suffix: sourceExtension })
    const outputPath = await Deno.makeTempFile({
      suffix: requestOptions.format === 'opus' ? '.opus' : '.m4a',
    })
    try {
      await Deno.writeFile(sourcePath, sourceBytes)
      const fullOptions: VoiceAudioTransformOptions = {
        ...requestOptions,
        profile: 'voice',
        outputPath,
      }
      const result = await transformer.transformAudio({ sourcePath }, fullOptions)

      // Never-worsened: `outputPath` holds an untouched copy of the SOURCE (see
      // `system-ffmpeg-audio-transcoder.ts`'s own doc) — `result.format`/`result.mimeType` already
      // honestly report the source's own real type here, never the fictitious target one. Storing
      // a byte-identical second copy under a new key would be pure waste (and would risk exactly
      // the "mislabeled file" that same doc warns against if this logic ever drifted) — this
      // variant instead points straight at the ALREADY-stored original.
      const variantId = generateUUID()
      const storageKey = result.neverWorsened ? originalStorageKey : buildVariantStorageKey(
        assetId,
        variantId,
      )
      const object = result.neverWorsened
        ? { size: sourceBytes.byteLength, checksum: await hashSourceBytes(sourceBytes) }
        : await storage.put(storageKey, await Deno.readFile(outputPath), {
          contentType: result.mimeType,
        })

      return {
        variantId,
        kind: 'audio',
        profile: 'voice',
        format: result.format,
        contentType: result.mimeType,
        storageKey,
        size: object.size,
        checksum: object.checksum,
        transformId: buildVoiceTransformId(fullOptions),
        policyVersion: VOICE_TRANSFORM_POLICY_VERSION,
        sampleRateHz: result.sampleRateHz,
        channels: result.channels,
        durationSeconds: result.durationSeconds,
      }
    } finally {
      await Deno.remove(sourcePath).catch(() => {})
      await Deno.remove(outputPath).catch(() => {})
    }
  }

  /** Content-types `runImageTransformation`/`runVideoTransformation` accept, each mapped to the
   * extension `AssetTransformer.transformImage()`'s `relativePath` argument (and, for video, the
   * temp source file) needs — same "REAL uploaded content-type, never a hardcoded assumption"
   * guardrail shape `runVoiceTransformation`'s own `.wav`-only check establishes, generalized to
   * a small allowlist instead of a single format. */
  const IMAGE_EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
  }
  const VIDEO_EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
    'video/mp4': '.mp4',
    'video/webm': '.webm',
  }
  /** Applied when `AssetTransformRequest`'s `'image'` member carries no `options` — the bare
   * in-place recompress, unchanged since before `options` existed on this member. */
  const IMAGE_TRANSFORM_POLICY_VERSION = 'v1'
  /** Applied whenever `options` IS given — a materially different contract from the bare case (a
   * caller-configured breakpoint/format policy, potentially producing several variants from one
   * upload instead of exactly one), so it gets its own version rather than silently sharing `v1`. */
  const IMAGE_TRANSFORM_POLICY_VERSION_WITH_OPTIONS = 'v2'

  /**
   * `AssetTransformer.transformImage(relativePath, bytes, options ?? true)`. `sharp` detects the
   * real source format from the BYTES themselves (confirmed reading `image-optimize.ts`), so
   * `relativePath`'s extension only affects the returned entries' own labeling/content-type
   * resolution here, never the actual transform — but it still has to be the REAL one, not a
   * hardcoded guess, for `contentTypeFor()` below to resolve correctly. `optimizeImageAsset` already
   * applies its own "never worsen" comparison internally (`pickSmaller`) — nothing extra to handle
   * here for that.
   *
   * Two shapes, per `options`:
   * - **Omitted** (the common case) — `transformImage` always returns exactly one entry (the
   *   source, recompressed in place only if strictly smaller). That entry becomes the one variant
   *   this function has always returned, byte-for-byte the same behavior as before `options`
   *   existed on this member.
   * - **Given** — `transformImage` returns the UNCHANGED original as its first entry (already
   *   covered by `AssetRecord.storageKey`, which `createAsset()` persists before this function ever
   *   runs, so it's never re-stored as a variant here) followed by zero or more derived
   *   breakpoint/format entries, each already vetted by `optimizeImageAsset`'s own never-worsen
   *   rule. Every derived entry becomes its own `AssetVariant`, so ONE upload can yield several
   *   stored, independently downloadable variants (e.g. a resized "full" view alongside a distinct
   *   thumbnail) — never one variant silently overwriting another. A `breakpoints` request whose
   *   resize never beats the original in bytes (a source too small to shrink further) legitimately
   *   yields zero derived variants, the same outcome `assetsPlugin`'s own build-time optimizer has
   *   for an equally-unfavorable input.
   *
   * After the content-type allowlist check, also verifies the buffered bytes actually START WITH
   * `sourceContentType`'s real file signature (`matchesImageSignature`, `magic-bytes.ts`) — the
   * allowlist alone only proves the client's CLAIM is one of jpeg/png/webp, never that the bytes
   * genuinely are. Runs on already-bounded bytes (`AssetServiceOptions.limits` is enforced earlier,
   * in `createAsset()`, before `sourceBytes` ever reaches this function), so this check itself can
   * never be abused with an oversized payload. `sharp`'s own default `limitInputPixels` (~268M
   * pixels) is the separate, already-sufficient guard against a decompression bomb once real,
   * signature-verified image bytes reach `transformImage`/`optimizeImageAsset` — not re-implemented
   * here.
   *
   * @throws {HttpError} `BAD_REQUEST` for a content-type outside the jpeg/png/webp allowlist, or
   * when the bytes don't match the declared content-type's real file signature.
   */
  async function runImageTransformation(
    assetId: string,
    sourceBytes: Uint8Array,
    sourceContentType: string,
    options?: ImagesOptimizeOptions,
  ): Promise<AssetVariant[]> {
    const extension = IMAGE_EXTENSION_BY_CONTENT_TYPE[sourceContentType]
    if (!extension) {
      throw new HttpError('BAD_REQUEST', {
        meta: {
          source: 'zanix',
          reason: `Image optimization only accepts jpeg/png/webp sources — ` +
            `"${sourceContentType}" is not supported.`,
        },
      })
    }
    if (!matchesImageSignature(sourceBytes, sourceContentType)) {
      throw new HttpError('BAD_REQUEST', {
        meta: {
          source: 'zanix',
          reason: `Declared content-type "${sourceContentType}" doesn't match the file's real ` +
            `signature.`,
        },
      })
    }

    const entries = await transformer.transformImage(
      `source${extension}`,
      sourceBytes,
      options ?? true,
    )

    if (!options) {
      const [optimized] = entries
      const variantId = generateUUID()
      const contentType = contentTypeFor(optimized.relativePath)
      const storageKey = buildVariantStorageKey(assetId, variantId)
      const object = await storage.put(storageKey, optimized.bytes, { contentType })

      return [{
        variantId,
        kind: 'image',
        format: extension.slice(1),
        contentType,
        storageKey,
        size: object.size,
        checksum: object.checksum,
        transformId: 'image-optimize',
        policyVersion: IMAGE_TRANSFORM_POLICY_VERSION,
      }]
    }

    // `entries[0]` is the untouched original (see this function's own doc) — every entry AFTER it
    // is a real, already-vetted derived variant.
    const variants: AssetVariant[] = []
    for (const entry of entries.slice(1)) {
      const contentType = contentTypeFor(entry.relativePath)
      const variantId = generateUUID()
      const storageKey = buildVariantStorageKey(assetId, variantId)
      // Sequential on purpose, mirroring `optimizeImageAsset`'s own sequential breakpoint loop,
      // rather than adding unbounded upload-time storage concurrency for a handful of variants.
      // deno-lint-ignore no-await-in-loop
      const object = await storage.put(storageKey, entry.bytes, { contentType })

      // `entry.relativePath` is always `<base>.<ext>` (no options given — unreachable here) or one
      // of `<base>.<breakpointKey>.<ext>` / `<base>.<format>` / `<base>.<breakpointKey>.<format>`
      // (see `image-optimize.ts`'s own key construction) — the trailing segment is always the real
      // output extension, and a 3-segment key's middle segment is always the breakpoint identity.
      const segments = entry.relativePath.split('.')
      const outputExtension = segments[segments.length - 1]
      const breakpointKey = segments.length === 3 ? segments[1] : undefined

      variants.push({
        variantId,
        kind: 'image',
        format: outputExtension,
        contentType,
        storageKey,
        size: object.size,
        checksum: object.checksum,
        transformId: breakpointKey ? `image-${breakpointKey}` : 'image-format',
        policyVersion: IMAGE_TRANSFORM_POLICY_VERSION_WITH_OPTIONS,
      })
    }
    return variants
  }

  /** Fixed, declared policy for the ONE still-frame thumbnail `runVideoTransformation` extracts
   * when `options.thumbnail` is `true` — see `AssetTransformRequest`'s own `'video'` member doc
   * for why this stays a library-owned default rather than an HTTP-caller-facing knob. `jpeg` at
   * the frame's own real dimensions (no forced resize — a caller that needs a smaller grid tile
   * gets there the same way `PhotosField`-style consumers already do for images, an app-level
   * `?variant=` policy of ITS own, not something this generic library should assume every consumer
   * wants baked into the derived asset itself), one second in (the same "avoid a black/blank first
   * frame" reasoning `ThumbnailOptions.atSeconds`'s own doc already gives for its `1`-second
   * default — left unset here so a bump to that default upstream in `video-transcoder.ts` is
   * inherited automatically, never silently pinned to today's value).
   */
  const VIDEO_THUMBNAIL_FORMAT = 'jpeg' as const

  /**
   * Mirrors `runVoiceTransformation`'s own temp-file/never-worsened shape exactly, over
   * `AssetTransformer.transformVideo()` instead of `transformAudio()`. `breakpoint` defaults to
   * `'mlg'` (mobile-large) when the HTTP caller doesn't specify one — a real, working default, not
   * a placeholder; a caller that wants a different preset passes `options.breakpoint` explicitly
   * (see `AssetTransformRequest`'s own `'video'` member).
   *
   * Always returns at least the transcoded video variant; a truthy `options.thumbnail` additionally
   * extracts ONE still frame from the same already-downloaded source bytes (via
   * `AssetTransformer.transformThumbnail()`, real ffmpeg) and appends it as a second, `'thumbnail'`
   * -kind variant — unlike the video transcode itself, a thumbnail has no "original" to fall back
   * to on failure (see `ThumbnailResult`'s own doc), so extraction failure here fails the WHOLE
   * upload rather than silently omitting the thumbnail; a caller that can't tolerate that shouldn't
   * request one.
   *
   * @throws {HttpError} `BAD_REQUEST` for a content-type outside the mp4/webm allowlist.
   */
  async function runVideoTransformation(
    assetId: string,
    originalStorageKey: string,
    sourceBytes: Uint8Array,
    sourceContentType: string,
    requestOptions: {
      breakpoint?: VideoBreakpointName
      format?: 'mp4' | 'webm'
      thumbnail?: boolean
    } = {},
  ): Promise<AssetVariant[]> {
    const sourceExtension = VIDEO_EXTENSION_BY_CONTENT_TYPE[sourceContentType]
    if (!sourceExtension) {
      throw new HttpError('BAD_REQUEST', {
        meta: {
          source: 'zanix',
          reason: `Video transcoding only accepts mp4/webm sources — "${sourceContentType}" is ` +
            `not supported.`,
        },
      })
    }

    const breakpoint = requestOptions.breakpoint ?? 'mlg'
    const sourcePath = await Deno.makeTempFile({ suffix: sourceExtension })
    const outputSuffix = requestOptions.format ? `.${requestOptions.format}` : sourceExtension
    const outputPath = await Deno.makeTempFile({ suffix: outputSuffix })
    // Only allocated when a thumbnail is actually requested — see this function's own doc.
    const thumbnailOutputPath = requestOptions.thumbnail
      ? await Deno.makeTempFile({
        suffix: `.${VIDEO_THUMBNAIL_FORMAT === 'jpeg' ? 'jpg' : VIDEO_THUMBNAIL_FORMAT}`,
      })
      : undefined
    try {
      await Deno.writeFile(sourcePath, sourceBytes)
      const result = await transformer.transformVideo(
        { sourcePath },
        { breakpoint, format: requestOptions.format, outputPath },
      )

      // Never-worsened: same reasoning as `runVoiceTransformation` — point straight at the
      // already-stored original instead of storing a byte-identical second copy.
      const variantId = generateUUID()
      const storageKey = result.neverWorsened ? originalStorageKey : buildVariantStorageKey(
        assetId,
        variantId,
      )
      const object = result.neverWorsened
        ? { size: sourceBytes.byteLength, checksum: await hashSourceBytes(sourceBytes) }
        : await storage.put(storageKey, await Deno.readFile(outputPath), {
          contentType: result.mimeType,
        })

      const variants: AssetVariant[] = [{
        variantId,
        kind: 'video',
        format: (requestOptions.format ?? sourceExtension.slice(1)) as string,
        contentType: result.mimeType,
        storageKey,
        size: object.size,
        checksum: object.checksum,
        transformId: `video-${breakpoint}`,
        policyVersion: VIDEO_TRANSFORM_POLICY_VERSION,
      }]

      if (thumbnailOutputPath) {
        // Extracted from the ORIGINAL source, not the just-transcoded `outputPath` — the source is
        // already decoded/available here, and extracting from it rather than waiting on the
        // transcode's own output means a slow/failed transcode-quality choice never affects
        // whether a thumbnail can be produced at all.
        const thumbnailResult = await transformer.transformThumbnail(
          { sourcePath },
          { outputPath: thumbnailOutputPath, format: VIDEO_THUMBNAIL_FORMAT },
        )
        const thumbnailVariantId = generateUUID()
        const thumbnailStorageKey = buildVariantStorageKey(assetId, thumbnailVariantId)
        const thumbnailObject = await storage.put(
          thumbnailStorageKey,
          await Deno.readFile(thumbnailOutputPath),
          { contentType: thumbnailResult.mimeType },
        )
        variants.push({
          variantId: thumbnailVariantId,
          kind: 'thumbnail',
          format: VIDEO_THUMBNAIL_FORMAT,
          contentType: thumbnailResult.mimeType,
          storageKey: thumbnailStorageKey,
          size: thumbnailObject.size,
          checksum: thumbnailObject.checksum,
          transformId: 'video-thumbnail',
          policyVersion: THUMBNAIL_TRANSFORM_POLICY_VERSION,
        })
      }

      return variants
    } finally {
      await Deno.remove(sourcePath).catch(() => {})
      await Deno.remove(outputPath).catch(() => {})
      if (thumbnailOutputPath) await Deno.remove(thumbnailOutputPath).catch(() => {})
    }
  }

  const jobs = options.jobs ?? createInlineJobDispatcher({ repository, runTransformation })

  return {
    async createAsset(command: CreateAssetCommand): Promise<AssetRecord> {
      const maxBytes = limits[command.transformRequest.kind]

      // Layer 1 — fast reject against the CLAIMED size, before the stream is ever touched.
      // `UploadedAsset.size` comes straight from the `Content-Length` header (`upload.ts`), which
      // is optional (absent with chunked transfer-encoding) and client-controlled (nothing stops a
      // caller from sending a false one) — this check is a cheap early exit when the header IS
      // present and already honest, never the real defense on its own.
      if (command.upload.size !== undefined && command.upload.size > maxBytes) {
        throw new HttpError('PAYLOAD_TOO_LARGE', {
          meta: {
            source: 'zanix',
            reason: `Upload declares ${command.upload.size} bytes, exceeding the ${maxBytes}-byte` +
              ` limit for "${command.transformRequest.kind}" assets.`,
          },
        })
      }

      // Layer 2 — the real enforcement, against bytes actually read while buffering. Covers the
      // case Layer 1 can't: no `Content-Length` at all, or one that understates the real size.
      const sourceBytes = await readBoundedBytes(command.upload.stream, maxBytes)
      const checksum = await hashSourceBytes(sourceBytes)

      // Caller-assigned id (see `ports/asset-repository.ts`'s own doc on `CreateAssetInput.id`) —
      // lets the storage key be computed BEFORE the record exists, with no two-phase create+patch.
      const id = generateUUID()
      const storageKey = buildOriginalStorageKey(id)

      // Storage first: if this fails, no repository record (and no orphaned metadata) is ever
      // created. A record created after a storage failure would be a real asset that could never
      // be transformed — worse than the reverse (an orphaned stored object with no record, the one
      // real trade-off two independent ports without a shared transaction accept).
      await storage.put(storageKey, sourceBytes, { contentType: command.upload.contentType })

      await repository.create({
        id,
        kind: command.transformRequest.kind,
        originalFilename: command.upload.filename,
        contentType: command.upload.contentType,
        size: sourceBytes.byteLength,
        checksum,
        storageKey,
      })

      await jobs.dispatch({
        assetId: id,
        sourceKey: storageKey,
        kind: command.transformRequest.kind,
        transformRequest: command.transformRequest,
      })

      // `InlineJobDispatcher` already ran the full chain synchronously by the time `dispatch()`
      // resolves — re-reading is what makes this correct for a FUTURE async dispatcher too, whose
      // `dispatch()` would resolve long before the record reaches a terminal status.
      const record = await repository.findById(id)
      if (!record) {
        throw new InternalError(`Asset "${id}" vanished immediately after its own creation.`, {
          code: 'SPACE_ASSETS_RECORD_MISSING_AFTER_CREATE',
          meta: { source: 'zanix', id },
        })
      }
      return record
    },

    getAsset(id: string): Promise<AssetRecord | undefined> {
      return repository.findById(id)
    },

    async downloadVariant(id: string, variantId?: string) {
      const record = await repository.findById(id)
      if (!record) return undefined

      const key = variantId
        ? record.variants.find((variant) => variant.variantId === variantId)?.storageKey
        : record.storageKey
      if (!key) return undefined

      const stored = await storage.get(key)
      if (!stored) return undefined
      return {
        stream: stored.stream,
        contentType: stored.object.contentType,
        size: stored.object.size,
      }
    },

    async deleteAsset(id: string): Promise<void> {
      const record = await repository.findById(id)
      if (!record) return

      // Deduplicated — the never-worsened transform case (`runVoiceTransformation`/
      // `runVideoTransformation`) points a variant's own `storageKey` straight at the original's,
      // so deleting each key exactly once (rather than once per variant) never issues a second,
      // redundant delete against the same object.
      const storageKeys = new Set(
        [record.storageKey, ...record.variants.map((variant) => variant.storageKey)],
      )
      for (const key of storageKeys) {
        // deno-lint-ignore no-await-in-loop
        await storage.delete(key)
      }
      await repository.delete(id)
    },
  }
}
