/**
 * A transform cache shared between image optimization (`image-optimize.ts`) and video
 * transcoding/thumbnail extraction (`system-ffmpeg-transcoder.ts`) — implements the identity model
 * from this codebase's own audit of the question "can we guarantee an asset never re-runs the same
 * optimization twice": `sha256(source) + transformId + policyVersion` identifies one
 * transformation attempt, exactly the `sha256(source) + video:mlg + policy:v1` shape that audit
 * settled on.
 *
 * That audit's other conclusion is load-bearing for this file's own boundaries: neither
 * `VideoTranscoder`/`SystemFfmpegTranscoder` nor `image-optimize.ts`'s pure functions know this
 * module exists, or ever will — it is strictly an ORCHESTRATION-layer concern. This module is
 * wired in exclusively through the decorators in `modules/media/cached-video-transcoder.ts` and
 * `modules/assets/cached-image-optimizer.ts`; the transformation code itself stays exactly as pure
 * and cache-unaware as it already was.
 *
 * The identity is content-based, deliberately never path- or mtime-based: the previous
 * `assets-manifest.json` (see `assets-manifest.ts`) is a flat `relativePath -> URL` map keyed by a
 * STABLE PATH, with no content-hash identity and no policy-version concept at all — confirmed by
 * that same audit to be the reason no "already processed" guarantee existed anywhere in this
 * codebase before this file.
 *
 * @module
 */

import { uint8ArrayToHEX } from '@zanix/helpers'

/** One past transformation attempt's real outcome — enough to skip recomputation on a hit,
 * without this module ever needing to know WHY a transform looks the way it does (that's entirely
 * encoded in the caller's own opaque `transformId`). */
export interface TransformCacheEntry {
  /**
   * `'optimized'`: a real, improved output was produced, and its bytes are retrievable via
   * `TransformCacheStore.getBytes` (keyed by this entry's own cache key, or one of `outputs`'s own
   * sub-keys for a multi-output transform).
   *
   * `'never-worsened'`: the transformation ran, but its own never-worsen rule rejected the
   * result — the ORIGINAL source is the correct output, and every caller that can produce this
   * status already holds the original's own bytes in hand (it just read them to hash them) — no
   * output bytes are ever stored for this case, and none should be: storing a byte-for-byte copy
   * of a source the caller already has would be pure waste.
   */
  status: 'optimized' | 'never-worsened'
  /** Real byte size of the transformation's own output. `0` for `'never-worsened'` — there is no
   * new output, by definition. */
  bytesWritten: number
  /**
   * Sub-keys under which this entry's output bytes are stored — a single-output transform (video:
   * exactly one file per `transcode()`/`extractThumbnail()` call) omits this and stores its bytes
   * directly under this entry's own cache key. A multi-output transform (image: N breakpoints × M
   * formats from one `optimizeImageAsset()` call) lists each output's own `relativePath` here;
   * each one's bytes live under `` `${key}::${relativePath}` ``.
   */
  outputs?: string[]
  /**
   * Small, OPAQUE, caller-defined metadata alongside this entry — this module never reads or
   * interprets it, pure passthrough storage. Exists so a decorator whose real result carries more
   * than bytes (e.g. `cached-audio-transcoder.ts`'s own `sampleRateHz`/`channels`/`durationSeconds`
   * — real facts a fresh transcode already learns via `ffprobe`) can replay a cache HIT without
   * spawning a real subprocess just to re-derive them — preserving this whole cache system's own
   * core guarantee: a hit costs zero real transformer/probe invocations, of any kind. Omitted:
   * no metadata — every existing image/video entry is completely unaffected by this field's
   * addition (purely additive, never required).
   */
  meta?: Record<string, unknown>
}

/**
 * Where cache entries and their output bytes actually live — a real filesystem
 * (`createFileTransformCacheStore`, `transform-cache-store.ts`), in-memory (tests), or anything
 * else a future caller wants (a KV store, an Asset API's own database).
 *
 * Implementations MUST treat a missing/corrupt/incompatible entry as absent rather than
 * throwing — `getEntry`'s own contract is "give me a trustworthy entry or nothing at all";
 * every caller of this store already has a safe real-recompute fallback for `undefined`, and a
 * thrown error would defeat that safety net for no benefit.
 */
export interface TransformCacheStore {
  /** Reads back a previously stored entry's metadata, or `undefined` if `key` is absent/invalid. */
  getEntry(key: string): Promise<TransformCacheEntry | undefined>
  /** Persists an entry's metadata under `key`. */
  setEntry(key: string, entry: TransformCacheEntry): Promise<void>
  /** Reads back a previously stored entry's real output bytes, or `undefined` if `key` is
   * absent/invalid. */
  getBytes(key: string): Promise<Uint8Array | undefined>
  /** Persists an entry's real output bytes under `key`. */
  setBytes(key: string, bytes: Uint8Array): Promise<void>
}

/**
 * `sha256(sourceBytes)` — the ASSET IDENTITY half of the cache key. Deliberately a hash of the
 * real bytes, never the source's path or mtime: the whole point of this module is identity that
 * survives a file being renamed, copied, or touched without its real content changing, and that
 * correctly treats two byte-identical files (or the same file re-read after an unrelated `git
 * checkout`) as the same asset.
 */
export async function hashSourceBytes(bytes: Uint8Array): Promise<string> {
  // Re-wrapped into a fresh, concretely `ArrayBuffer`-backed view — `bytes` may arrive typed as
  // `Uint8Array<ArrayBufferLike>` (e.g. straight from `Deno.readFile`), which `SubtleCrypto.digest`
  // doesn't structurally accept even though it's a real `Uint8Array` at runtime.
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return uint8ArrayToHEX(new Uint8Array(digest))
}

/**
 * The full cache key: `` `${sourceHash}:${transformId}:${policyVersion}` `` — exactly the
 * `sha256(source) + video:mlg + policy:v1` identity this module was designed around. A
 * `policyVersion` bump (a deliberate recalibration — e.g. the capped-CRF/CQ values in
 * `video-breakpoints.ts` changing) changes every key it touches, so every entry made under the
 * old version is simply never looked up again — no explicit invalidation pass needed anywhere.
 */
export function buildTransformCacheKey(
  params: { sourceHash: string; transformId: string; policyVersion: string },
): string {
  return `${params.sourceHash}:${params.transformId}:${params.policyVersion}`
}

/**
 * A trustworthy, per-entry runtime shape check — corrupt data (a hand-edited cache file, disk
 * corruption) or incompatible data (a future version of this module using a shape this one
 * doesn't understand) is treated as "no entry", triggering a safe real recompute, never a crash.
 * Deliberately per-ENTRY, not per-file: one bad/foreign-shaped key must never invalidate every
 * other, still-valid entry sitting next to it in the same store.
 */
export function isValidTransformCacheEntry(value: unknown): value is TransformCacheEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  if (entry.status !== 'optimized' && entry.status !== 'never-worsened') return false
  if (typeof entry.bytesWritten !== 'number') return false
  if (entry.outputs !== undefined) {
    if (!Array.isArray(entry.outputs)) return false
    if (!entry.outputs.every((item) => typeof item === 'string')) return false
  }
  if (entry.meta !== undefined) {
    if (typeof entry.meta !== 'object' || entry.meta === null || Array.isArray(entry.meta)) {
      return false
    }
  }
  return true
}
