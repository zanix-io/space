/**
 * Wraps a real `AudioTranscoder` with the SAME shared transform cache
 * (`../../assets/transform-cache.ts`) `cached-video-transcoder.ts`/`cached-image-optimizer.ts`
 * already use — no new cache system, no `AudioCache`.
 * `createCachedAudioTranscoder(createSystemFfmpegAudioTranscoder(), store)` is a drop-in
 * `AudioTranscoder` with identical observable behavior, minus redundant `ffmpeg` invocations.
 *
 * **A cache HIT costs zero real subprocess calls, of any kind — including `ffprobe`.**
 * `AudioTranscodeResult`'s own `sampleRateHz`/`channels`/`durationSeconds` are real facts a fresh
 * transcode already learns via one `probeSourceAudio` call; a naive replay would need to re-run
 * `ffprobe` on the materialized bytes to report them again, which would be a real regression from
 * this whole cache system's own core guarantee (a hit never re-invokes the real
 * transformer/decoder, of any kind — see `transform-cache.ts`'s own doc). Instead, this decorator
 * stores those three values in `TransformCacheEntry.meta` (a small, opaque, caller-defined bag that
 * module never reads or interprets — see its own doc) alongside the FIRST real transcode, and reads
 * them straight back out of the entry on every later hit. `TransformCacheEntry` itself needed this
 * one, minimal, purely-additive extension (`meta?: Record<string, unknown>`) — no other existing
 * consumer (image, video, thumbnail) is affected by its addition.
 *
 * **This file stays profile-agnostic** — it never hardcodes "voice" anywhere in its own cache-hit/
 * cache-miss control flow. The one place it dispatches on `options.profile` is
 * {@linkcode resolveIdentity}, which delegates the ENTIRE transform-id/policy-version decision to
 * the matching `policies/*.ts` module (today only `./policies/voice.ts`). A future profile adds one
 * more `case` there — never a change to the logic below.
 *
 * Same cache-hit requirement `cached-video-transcoder.ts` already documents: the SAME `outputPath`
 * must be requested again for a hit — this decorator never owns storage/CDN placement. A hit whose
 * recorded output no longer matches what's really on disk is treated as a safe miss and reprocessed
 * for real, never trusted blindly.
 *
 * @module
 */

import { InternalError } from '@zanix/errors'
import { contentTypeFor } from '../../assets/content-type.ts'
import {
  buildTransformCacheKey,
  hashSourceBytes,
  type TransformCacheStore,
} from '../../assets/transform-cache.ts'
import { buildVoiceTransformId, VOICE_TRANSFORM_POLICY_VERSION } from './policies/voice.ts'
import type {
  AudioTranscodeInput,
  AudioTranscoder,
  AudioTranscodeResult,
  AudioTransformOptions,
} from './audio-transcoder.ts'

/** Resolves ONE profile's own real transform id + policy version — the ONLY place this decorator
 * dispatches on `options.profile`. Every profile's own identity rule lives entirely in its own
 * `policies/*.ts` module (`buildVoiceTransformId`/`VOICE_TRANSFORM_POLICY_VERSION` today); this
 * function only routes to it. A future profile (e.g. `music`) adds its own `case` here, its own
 * `policies/music.ts`, and nothing else changes in this file. */
function resolveIdentity(
  options: AudioTransformOptions,
): { transformId: string; policyVersion: string } {
  switch (options.profile) {
    case 'voice':
      return {
        transformId: buildVoiceTransformId(options),
        policyVersion: VOICE_TRANSFORM_POLICY_VERSION,
      }
    default: {
      const exhaustive: never = options.profile
      throw new InternalError(`Unknown audio transform profile: "${exhaustive}".`, {
        code: 'SPACE_MEDIA_AUDIO_UNKNOWN_PROFILE',
      })
    }
  }
}

/** The target format's own container extension/mimeType label — derived from the CURRENT call's
 * own request, never re-derived from `ffprobe` (which reports a codec name, not this framework's
 * own container/format label). Correct on a cache hit precisely because a hit only ever happens for
 * the exact same `(sourceHash, transformId, policyVersion)` — i.e. the exact same requested format
 * that originally produced this entry. */
function requestedFormatOf(
  options: AudioTransformOptions,
): { extension: string; mimeType: string } {
  switch (options.profile) {
    case 'voice': {
      const extension = options.format === 'opus' ? 'opus' : 'm4a'
      return { extension, mimeType: contentTypeFor(`x.${extension}`) }
    }
    default: {
      const exhaustive: never = options.profile
      throw new InternalError(`Unknown audio transform profile: "${exhaustive}".`, {
        code: 'SPACE_MEDIA_AUDIO_UNKNOWN_PROFILE',
      })
    }
  }
}

interface AudioCacheMeta {
  [key: string]: unknown
  sampleRateHz?: number
  channels?: number
  durationSeconds?: number
}

function metaFromResult(result: AudioTranscodeResult): AudioCacheMeta {
  return {
    sampleRateHz: result.sampleRateHz,
    channels: result.channels,
    durationSeconds: result.durationSeconds,
  }
}

function metaFrom(entryMeta: Record<string, unknown> | undefined): AudioCacheMeta {
  const sampleRateHz = typeof entryMeta?.sampleRateHz === 'number'
    ? entryMeta.sampleRateHz
    : undefined
  const channels = typeof entryMeta?.channels === 'number' ? entryMeta.channels : undefined
  const durationSeconds = typeof entryMeta?.durationSeconds === 'number'
    ? entryMeta.durationSeconds
    : undefined
  return { sampleRateHz, channels, durationSeconds }
}

/** Configuration for {@linkcode createCachedAudioTranscoder}. */
export interface CachedAudioTranscoderOptions {
  /** Overrides every profile's own default policy version at once — mainly a test seam. Prefer
   * bumping the profile's own constant (`VOICE_TRANSFORM_POLICY_VERSION`, ...) for a real
   * recalibration; this override applies uniformly across profiles, which a real product change
   * rarely wants. */
  policyVersion?: string
}

/** Wraps `transcoder` with `store`-backed caching, returning a drop-in `AudioTranscoder`. */
export function createCachedAudioTranscoder(
  transcoder: AudioTranscoder,
  store: TransformCacheStore,
  options: CachedAudioTranscoderOptions = {},
): AudioTranscoder {
  return {
    probe: transcoder.probe,

    async transcode(
      input: AudioTranscodeInput,
      opts: AudioTransformOptions,
    ): Promise<AudioTranscodeResult> {
      const sourceBytes = await Deno.readFile(input.sourcePath)
      const identity = resolveIdentity(opts)
      const sourceHash = await hashSourceBytes(sourceBytes)
      const policyVersion = options.policyVersion ?? identity.policyVersion
      const key = buildTransformCacheKey({
        sourceHash,
        transformId: identity.transformId,
        policyVersion,
      })

      const cached = await store.getEntry(key)
      if (cached?.status === 'never-worsened') {
        // No new bytes were ever produced last time — the ORIGINAL is the correct output, and
        // this call already holds its real bytes (just read to hash them). Never re-runs ffmpeg
        // OR ffprobe — see this module's own doc.
        await Deno.writeFile(opts.outputPath, sourceBytes)
        const meta = metaFrom(cached.meta)
        return {
          outputPath: opts.outputPath,
          bytesWritten: sourceBytes.byteLength,
          mimeType: contentTypeFor(input.sourcePath),
          format: extensionOf(input.sourcePath),
          sampleRateHz: meta.sampleRateHz,
          channels: meta.channels,
          durationSeconds: meta.durationSeconds,
          passthrough: false,
          neverWorsened: true,
        }
      }
      if (cached?.status === 'optimized') {
        const bytes = await store.getBytes(key)
        const hit = bytes &&
          await verifyOnDiskCopyOrWrite(opts.outputPath, bytes, cached.bytesWritten)
        if (hit) {
          const { extension, mimeType } = requestedFormatOf(opts)
          const meta = metaFrom(cached.meta)
          return {
            outputPath: opts.outputPath,
            bytesWritten: bytes.byteLength,
            mimeType,
            format: extension,
            sampleRateHz: meta.sampleRateHz,
            channels: meta.channels,
            durationSeconds: meta.durationSeconds,
            passthrough: false,
            neverWorsened: false,
          }
        }
        // Recorded as 'optimized' but its own bytes are missing/short in the store — a
        // corrupt/incompatible cache entry. Falls through to a real, safe recompute.
      }

      const result = await transcoder.transcode(input, opts)

      // The ffmpeg-unavailable passthrough is an ENVIRONMENT state, not a property of (source,
      // transform, policy) — never cached, same reasoning `cached-video-transcoder.ts` already
      // documents.
      if (!result.passthrough) {
        if (result.neverWorsened) {
          await store.setEntry(key, {
            status: 'never-worsened',
            bytesWritten: 0,
            meta: metaFromResult(result),
          })
        } else {
          const outputBytes = await Deno.readFile(opts.outputPath)
          await store.setBytes(key, outputBytes)
          await store.setEntry(key, {
            status: 'optimized',
            bytesWritten: outputBytes.byteLength,
            meta: metaFromResult(result),
          })
        }
      }

      return result
    },
  }
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot + 1).toLowerCase()
}

/** Materializes a cache hit's bytes at `outputPath` — same contract `cached-video-transcoder.ts`'s
 * own `verifyOnDiskCopyOrWrite` already establishes. */
async function verifyOnDiskCopyOrWrite(
  outputPath: string,
  bytes: Uint8Array,
  expectedSize: number,
): Promise<boolean> {
  if (bytes.byteLength !== expectedSize) return false
  await Deno.writeFile(outputPath, bytes)
  return true
}
