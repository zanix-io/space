/**
 * The default `AssetStorage` for tests — an in-process `Map<key, bytes>`. Never persists across a
 * process restart; never the production object store — see `local-filesystem-asset-storage.ts`'s
 * own doc for the dev/test-usable alternative that DOES persist, and `../mod.ts`'s own doc for
 * where a real production store (S3, `@zanix/datamaster`, later) eventually lands.
 *
 * @module
 */

import { hashSourceBytes } from '../../assets/transform-cache.ts'
import { readAllBytes } from '../read-all-bytes.ts'
import type { AssetObject, AssetStorage } from '../ports/asset-storage.ts'

/** Implements `AssetStorage` over in-process `Map`s — see this module's own top-level doc. */
export function createInMemoryAssetStorage(): AssetStorage {
  const bytes = new Map<string, Uint8Array>()
  const objects = new Map<string, AssetObject>()

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
      bytes.set(key, buffer)
      objects.set(key, object)
      return object
    },

    get(key) {
      const buffer = bytes.get(key)
      const object = objects.get(key)
      if (!buffer || !object) return Promise.resolve(undefined)
      return Promise.resolve({
        object,
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(buffer)
            controller.close()
          },
        }),
      })
    },

    delete(key) {
      bytes.delete(key)
      objects.delete(key)
      return Promise.resolve()
    },

    exists(key) {
      return Promise.resolve(bytes.has(key))
    },
  }
}
