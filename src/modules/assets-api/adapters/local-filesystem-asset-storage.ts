/**
 * A REAL, disk-backed `AssetStorage` — lets the complete Asset API vertical slice run locally with
 * zero external infra (no Mongo, no S3, no network). **This is a dev/test adapter, not the
 * intended production object store** — a real deployment's bytes belong in a real object store.
 * `S3ObjectStorage` (`@zanix/datamaster/storage`) is that real implementation: a generic,
 * S3-compatible byte store this package never imports directly — it structurally satisfies
 * `AssetStorage` already (identical `put`/`get`/`delete`/`exists` shape), so a consuming
 * application composes it in without this package needing to know S3 exists. See
 * `src/@tests/support/resolve-asset-storage.ts` for the reference composition (S3-configured vs.
 * this adapter, chosen purely by `S3_ENDPOINT`'s presence). This adapter exists so the
 * dev/test claim above is actually exercised end-to-end today, not just designed on paper — see
 * `src/@tests/functional/assets-api/voice-upload.test.ts`, which deliberately uses THIS adapter
 * (not `InMemoryAssetStorage`) for exactly that reason.
 *
 * `key` (e.g. `'assets/<id>/original'`) maps directly onto a nested path under `rootDir` — no
 * translation, no extension appended: the logical key IS the relative path, which is itself the
 * concrete proof `../keys.ts`'s "backend-independent" claim holds — this adapter adds nothing to
 * it, it only ever treats `key` as an opaque path segment.
 *
 * @module
 */

import { dirname } from '@std/path'
import { confinePath } from '@zanix/helpers'
import { InternalError } from '@zanix/errors'
import { hashSourceBytes } from '../../assets/transform-cache.ts'
import { readAllBytes } from '../read-all-bytes.ts'
import type { AssetObject, AssetStorage } from '../ports/asset-storage.ts'

// `key` is caller-supplied (ultimately an HTTP route param — see `AssetIdParamsRTO`) —
// `confinePath` rejects one that would resolve outside `rootDir` (`../` traversal, or an absolute
// `key` overriding `rootDir` outright) instead of letting `put`/`get`/`delete` touch disk there.
function bytesPath(rootDir: string, key: string): string {
  return confinePath(rootDir, key)
}

/** A sidecar file next to the real bytes — `AssetObject`'s own properties (`contentType`/
 * `checksum`) aren't derivable from the raw bytes alone (a real backend would carry this as
 * object metadata/headers instead; a plain filesystem has no such concept, so this is the
 * adapter's own, local-only way of not losing it). */
function metaPath(rootDir: string, key: string): string {
  return confinePath(rootDir, `${key}.meta.json`)
}

/** Implements `AssetStorage` over `rootDir` on local disk — see this module's own top-level doc. */
export function createLocalFilesystemAssetStorage(rootDir: string): AssetStorage {
  return {
    async put(key, data, meta) {
      const buffer = await readAllBytes(data)
      const checksum = await hashSourceBytes(buffer)
      const object: AssetObject = {
        key,
        contentType: meta.contentType,
        size: buffer.byteLength,
        checksum,
      }
      const target = bytesPath(rootDir, key)
      await Deno.mkdir(dirname(target), { recursive: true })
      await Deno.writeFile(target, buffer)
      await Deno.writeTextFile(metaPath(rootDir, key), JSON.stringify(object))
      return object
    },

    async get(key) {
      try {
        const object = JSON.parse(await Deno.readTextFile(metaPath(rootDir, key))) as AssetObject
        const buffer = await Deno.readFile(bytesPath(rootDir, key))
        return {
          object,
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue(buffer)
              controller.close()
            },
          }),
        }
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return undefined
        // A native `Deno.errors.*` besides `NotFound` (permission denied, disk failure, ...) must
        // never cross this port's own boundary unwrapped: its raw `.message` routinely embeds a
        // real, absolute filesystem path (`rootDir` included) — `@zanix/server`'s own
        // `getPublicErrorResponse` allowlists `message` by default, so an unwrapped native error
        // reaching `downloadAsset`'s HTTP route would hand that path straight to the client. `key`
        // (not the resolved path) is the safe identifier to surface; the real error detail still
        // reaches the log via `cause`.
        throw new InternalError('Failed to read a stored asset from disk.', {
          code: 'SPACE_ASSETS_STORAGE_READ_FAILED',
          meta: { source: 'zanix', key },
          cause: error,
        })
      }
    },

    async delete(key) {
      await Deno.remove(bytesPath(rootDir, key)).catch(() => {})
      await Deno.remove(metaPath(rootDir, key)).catch(() => {})
    },

    async exists(key) {
      try {
        await Deno.stat(bytesPath(rootDir, key))
        return true
      } catch {
        return false
      }
    },
  }
}
