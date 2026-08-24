/**
 * A real, persisted `TransformCacheStore` — the one this codebase's own future orchestrators
 * (`assetsPlugin`'s image path, a future `modules/bundler/media-plugin.ts`, an Asset API) are
 * meant to actually construct. See `transform-cache.ts`'s own doc for the identity model and the
 * store contract this implements.
 *
 * @module
 */

import { join } from '@std/path'
import { uint8ArrayToHEX } from '@zanix/helpers'
import {
  isValidTransformCacheEntry,
  type TransformCacheEntry,
  type TransformCacheStore,
} from './transform-cache.ts'

/** A safe filename for an arbitrary cache key — a key contains `:` and is never itself a safe
 * path component, so this hashes it rather than sanitizing it: two different keys never collide,
 * and no path-traversal-shaped key can ever reach the real filesystem. */
async function keyToFilename(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  return uint8ArrayToHEX(new Uint8Array(digest))
}

/**
 * One small JSON index file (`index.json`, entries only — metadata is cheap) plus one binary file
 * per stored output (`` `${cacheDir}/${sha256(key)}.bin` ``) — output bytes never round-trip
 * through JSON/base64, which would bloat a video-sized payload by ~33% for no reason.
 *
 * Corrupt/incompatible handling (this store's real implementation of the "cache
 * corrupto/incompatible -> recomputa de forma segura" requirement):
 * - An unreadable or non-JSON index file is treated as an EMPTY cache, never thrown — a corrupt
 *   cache is never worse than no cache, only slower (every lookup becomes a real recompute).
 * - Each individual entry is ALSO shape-checked on read (`isValidTransformCacheEntry`) — one
 *   bad/foreign-shaped entry is ignored as if absent, without discarding every other still-valid
 *   entry in the same index.
 * - A missing/unreadable output file behind an otherwise-valid entry is the same safe-miss: the
 *   caller gets `undefined` from `getBytes`, never a thrown error.
 */
export function createFileTransformCacheStore(cacheDir: string): TransformCacheStore {
  const indexPath = join(cacheDir, 'index.json')
  let index: Record<string, unknown> | undefined

  async function loadIndex(): Promise<Record<string, unknown>> {
    if (index) return index
    try {
      const text = await Deno.readTextFile(indexPath)
      const parsed = JSON.parse(text)
      index = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {}
    } catch {
      // Missing file, unreadable, or not valid JSON at all — start fresh rather than throw.
      index = {}
    }
    return index
  }

  async function persistIndex(): Promise<void> {
    await Deno.mkdir(cacheDir, { recursive: true })
    await Deno.writeTextFile(indexPath, JSON.stringify(index ?? {}))
  }

  return {
    async getEntry(key: string): Promise<TransformCacheEntry | undefined> {
      const data = await loadIndex()
      const raw = data[key]
      return isValidTransformCacheEntry(raw) ? raw : undefined
    },

    async setEntry(key: string, entry: TransformCacheEntry): Promise<void> {
      const data = await loadIndex()
      data[key] = entry
      await persistIndex()
    },

    async getBytes(key: string): Promise<Uint8Array | undefined> {
      try {
        const filename = await keyToFilename(key)
        return await Deno.readFile(join(cacheDir, filename))
      } catch {
        return undefined
      }
    },

    async setBytes(key: string, bytes: Uint8Array): Promise<void> {
      await Deno.mkdir(cacheDir, { recursive: true })
      const filename = await keyToFilename(key)
      await Deno.writeFile(join(cacheDir, filename), bytes)
    },
  }
}

/**
 * An in-memory `TransformCacheStore` — for tests and for a caller that deliberately wants a
 * per-process-only cache (no filesystem persistence at all). Same corrupt-entry safety contract
 * as the file store: `getEntry` re-validates on every read, so a test can inject a malformed value
 * directly to exercise the "incompatible cache" path without touching a real file.
 */
export function createInMemoryTransformCacheStore(): TransformCacheStore {
  const entries = new Map<string, unknown>()
  const bytes = new Map<string, Uint8Array>()
  return {
    getEntry(key) {
      const raw = entries.get(key)
      return Promise.resolve(isValidTransformCacheEntry(raw) ? raw : undefined)
    },
    setEntry(key, entry) {
      entries.set(key, entry)
      return Promise.resolve()
    },
    getBytes(key) {
      return Promise.resolve(bytes.get(key))
    },
    setBytes(key, value) {
      bytes.set(key, value)
      return Promise.resolve()
    },
  }
}
