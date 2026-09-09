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
import {
  base64ToUint8Array,
  confinePath,
  decrypt as rsaDecrypt,
  decryptAES,
  encrypt as rsaEncrypt,
  encryptAES,
  generateAESKey,
  stringToUint8Array,
  uint8ArrayToBase64,
  uint8ArrayToString,
} from '@zanix/helpers'
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
 * adapter's own, local-only way of not losing it). When the object is encrypted, this same file
 * also carries `encryption` — the metadata `decryptBytes` (below) needs back, the local-disk
 * equivalent of the S3 object metadata `@zanix/datamaster/storage`'s `S3ObjectStorage` carries the
 * same fields as. */
function metaPath(rootDir: string, key: string): string {
  return confinePath(rootDir, `${key}.meta.json`)
}

/** On-disk shape of the sidecar file: `AssetObject`'s own public fields, plus — only for an
 * encrypted object — the key version it was encrypted under, and, for `'asymmetric'` objects
 * only, the wrapped per-object AES key. */
type AssetObjectFile = AssetObject & {
  encryption?: { version: string; wrappedKey?: string }
}

/**
 * `createLocalFilesystemAssetStorage`'s own encryption-at-rest option — same opt-in shape
 * `@zanix/datamaster/storage`'s `S3ObjectStorage` `encrypt` option has (`'symmetric'`/
 * `'asymmetric'`, an optional key-rotation `version`), reached independently rather than by
 * importing that package (this module never does — see this file's own top-level doc): a random
 * per-object AES key for `'asymmetric'` objects is generated and RSA-wrapped locally with
 * `@zanix/helpers`'s own primitives, the same ones `@zanix/datamaster/storage`'s equivalent
 * mechanism is built on. Reuses the exact same `DATA_AES_KEY`/`DATA_RSA_PUB`/`DATA_RSA_KEY`
 * (optionally `_V1`/`_V2`/...-suffixed for `version`) environment variables that package's own
 * encryption already reads — the same key material protects an object regardless of which
 * implementation wrote it.
 */
export interface AssetStorageEncryptSettings {
  /** `'symmetric'` encrypts bytes directly with `DATA_AES_KEY`; `'asymmetric'` wraps a random
   * per-object AES key with `DATA_RSA_PUB`/`DATA_RSA_KEY` (RSA can't encrypt an arbitrary-size
   * payload directly). Any other value (including omitted) behaves as `'symmetric'`. */
  type?: 'symmetric' | 'asymmetric'
  /** Selects `DATA_AES_KEY_<VERSION>`/`DATA_RSA_PUB_<VERSION>`/`DATA_RSA_KEY_<VERSION>` for NEW
   * writes — an object's own recorded version (in its sidecar file) is always used for its own
   * decryption, so rotating this only affects future writes. `'v0'` (the default) reads the
   * unsuffixed env var names. */
  version?: `v${number}` | 'v0'
}

const normalizeVersion = (version: AssetStorageEncryptSettings['version']): string =>
  version && version !== 'v0' ? `_${version.toUpperCase()}` : ''

/** Resolves the env var a key must come from, throwing when it's missing — a caller who set
 * `encrypt` has to be able to trust that `put()` either encrypted the bytes or failed loudly,
 * never that it silently stored plaintext under an "encrypted" label. */
function requireEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) {
    throw new InternalError(
      `Asset storage encryption is enabled but '${name}' is not set in the environment.`,
      {
        code: 'SPACE_ASSETS_STORAGE_ENCRYPTION_ENV_MISSING',
        meta: { source: 'zanix', envVar: name },
      },
    )
  }
  return value
}

async function encryptBytes(
  plaintext: Uint8Array,
  settings: AssetStorageEncryptSettings,
): Promise<{ ciphertext: Uint8Array; encryption: AssetObjectFile['encryption'] }> {
  const suffix = normalizeVersion(settings.version)
  const plaintextBase64 = uint8ArrayToBase64(plaintext)
  const version = settings.version ?? 'v0'

  if (settings.type === 'asymmetric') {
    const objectKey = await generateAESKey(256)
    const ciphertextBase64 = await encryptAES(plaintextBase64, objectKey)
    const rsaPublicKey = requireEnv(`DATA_RSA_PUB${suffix}`)
    const wrappedKey = await rsaEncrypt(objectKey, atob(rsaPublicKey), 'RSA')
    return {
      ciphertext: stringToUint8Array(ciphertextBase64),
      encryption: { version, wrappedKey },
    }
  }

  const aesKey = requireEnv(`DATA_AES_KEY${suffix}`)
  const ciphertextBase64 = await encryptAES(plaintextBase64, aesKey)
  return { ciphertext: stringToUint8Array(ciphertextBase64), encryption: { version } }
}

async function decryptBytes(
  ciphertext: Uint8Array,
  settings: AssetStorageEncryptSettings,
  encryption: NonNullable<AssetObjectFile['encryption']>,
): Promise<Uint8Array> {
  const suffix = normalizeVersion(encryption.version as AssetStorageEncryptSettings['version'])
  const ciphertextBase64 = uint8ArrayToString(ciphertext)

  if (settings.type === 'asymmetric') {
    if (!encryption.wrappedKey) {
      throw new InternalError('Cannot decrypt: object is missing its wrapped key metadata.', {
        code: 'SPACE_ASSETS_STORAGE_DECRYPT_METADATA_MISSING',
        meta: { source: 'zanix' },
      })
    }
    const rsaPrivateKey = requireEnv(`DATA_RSA_KEY${suffix}`)
    const objectKey = await rsaDecrypt(encryption.wrappedKey, atob(rsaPrivateKey), 'RSA')
    const plaintextBase64 = await decryptAES(ciphertextBase64, objectKey)
    return base64ToUint8Array(plaintextBase64)
  }

  const aesKey = requireEnv(`DATA_AES_KEY${suffix}`)
  const plaintextBase64 = await decryptAES(ciphertextBase64, aesKey)
  return base64ToUint8Array(plaintextBase64)
}

/**
 * Implements `AssetStorage` over `rootDir` on local disk — see this module's own top-level doc.
 *
 * `options.encrypt`, when set, encrypts bytes at rest — see {@link AssetStorageEncryptSettings}.
 * Omitted (the default): bytes are written and read back exactly as given, unchanged from before
 * this option existed.
 */
export function createLocalFilesystemAssetStorage(
  rootDir: string,
  options: { encrypt?: AssetStorageEncryptSettings } = {},
): AssetStorage {
  const encrypt = options.encrypt

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

      let bytes: Uint8Array = buffer
      const file: AssetObjectFile = { ...object }
      if (encrypt) {
        const encrypted = await encryptBytes(buffer, encrypt)
        bytes = encrypted.ciphertext
        file.encryption = encrypted.encryption
      }

      const target = bytesPath(rootDir, key)
      await Deno.mkdir(dirname(target), { recursive: true })
      await Deno.writeFile(target, bytes)
      await Deno.writeTextFile(metaPath(rootDir, key), JSON.stringify(file))
      return object
    },

    async get(key) {
      try {
        const file = JSON.parse(await Deno.readTextFile(metaPath(rootDir, key))) as AssetObjectFile
        const raw = await Deno.readFile(bytesPath(rootDir, key))
        // Same "only the object's own recorded metadata means real ciphertext" rule
        // `S3ObjectStorage.get()` follows — this instance's own `encrypt` option only means it's
        // CONFIGURED to decrypt, not that this particular object was ever actually encrypted (it
        // may have been written before `encrypt` was set, or by an instance without it).
        const bytes = encrypt && file.encryption
          ? await decryptBytes(raw, encrypt, file.encryption)
          : raw
        const object: AssetObject = {
          key: file.key,
          contentType: file.contentType,
          size: bytes.byteLength,
          checksum: file.checksum,
        }
        return {
          object,
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue(bytes)
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
        // reaches the log via `cause`. A decryption failure (e.g. a missing key) gets the same
        // treatment, for the same reason.
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
