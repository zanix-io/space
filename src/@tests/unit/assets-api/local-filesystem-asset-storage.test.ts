import { assertEquals, assertRejects } from '@std/assert'
import { getTemporaryFolder } from '@zanix/helpers'
import { InternalError } from '@zanix/errors'
import { createLocalFilesystemAssetStorage } from 'modules/assets-api/adapters/local-filesystem-asset-storage.ts'

/**
 * Regression coverage for a confirmed path-traversal vulnerability: `key` used to be joined
 * straight onto `rootDir` (`join(rootDir, key)`) with no containment check, so a `key` that
 * escaped `rootDir` (`../`, or an absolute path overriding it entirely) let `put`/`get`/`delete`
 * touch disk outside the intended store. Fixed via `@zanix/helpers`'s `confinePath` — this suite
 * proves each `AssetStorage` method rejects such a `key` instead of ever reaching `Deno.*`.
 *
 * `AssetIdParamsRTO`'s own `@IsUUID` (see `assets-rto.test.ts`) closes the same class of payload
 * off earlier, at the API boundary — this is the deeper, backend-level invariant that must hold
 * regardless of what validation ran upstream.
 */
Deno.test(
  'createLocalFilesystemAssetStorage: put/get/delete/exists reject a traversal key',
  async () => {
    const dir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      const storage = createLocalFilesystemAssetStorage(dir)
      const bytes = new TextEncoder().encode('x')
      const traversingKeys = ['../../etc/passwd', 'a/../../x', '/etc/passwd']

      // Sequential per key, deliberately — a real Promise.all here would run every key's four
      // checks interleaved, which is fine functionally but harder to read than "one key, fully
      // checked, then the next".
      for (const key of traversingKeys) {
        // deno-lint-ignore no-await-in-loop
        await assertRejects(() => storage.put(key, bytes, { contentType: 'text/plain' }))
        // deno-lint-ignore no-await-in-loop
        await assertRejects(() => storage.get(key))
        // deno-lint-ignore no-await-in-loop
        await assertRejects(() => storage.delete(key))
        // `exists()` wraps everything in a catch-all that already treats any thrown error as
        // "not found" (true even before this fix, for e.g. a permission error) — so a rejected key
        // surfaces as `false` here, not a throw. Still safe: no traversal ever occurs either way,
        // only the shape of the negative result differs from the other three methods.
        // deno-lint-ignore no-await-in-loop
        assertEquals(await storage.exists(key), false)
      }
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

/**
 * Regression coverage for a confirmed raw-native-error leak: `get()` used to rethrow any non-
 * `NotFound` `Deno.errors.*` completely unwrapped — whose `.message` routinely embeds the real,
 * absolute on-disk path (confirmed via a real repro: `Deno.readFile()` on a directory throws
 * `Is a directory (os error 21): readfile '<the real path>'`). Since `@zanix/server`'s own
 * `getPublicErrorResponse` allowlists `message` by default, that raw path would reach an HTTP
 * client through `GET /assets/:id/download`. Fixed by wrapping into `InternalError` — this proves
 * the specific class + `code`, not a generic `Error`/message substring (see
 * `zanix-observability-conventions`'s own testing discipline for why a substring match doesn't
 * actually guard against regression).
 */
Deno.test(
  'createLocalFilesystemAssetStorage: get() wraps a non-NotFound native error into InternalError, never rethrows it raw',
  async () => {
    const dir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      const storage = createLocalFilesystemAssetStorage(dir)
      // A directory where `get()` expects to read the sidecar meta file as bytes — a real,
      // deterministic, cross-platform way to trigger `Deno.errors.IsADirectory` (never `NotFound`).
      await Deno.mkdir(`${dir}/assets/1/original.meta.json`, { recursive: true })

      const error = await assertRejects(
        () => storage.get('assets/1/original'),
        InternalError,
      )
      assertEquals(error.code, 'SPACE_ASSETS_STORAGE_READ_FAILED')
      // The real error is still reachable for logging (via `cause`) — just never exposed raw.
      assertEquals(error.cause instanceof Deno.errors.IsADirectory, true)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test('createLocalFilesystemAssetStorage: an ordinary key still works normally', async () => {
  const dir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
  try {
    const storage = createLocalFilesystemAssetStorage(dir)
    const bytes = new TextEncoder().encode('hello')
    await storage.put('assets/1/original', bytes, { contentType: 'text/plain' })

    const read = await storage.get('assets/1/original')
    if (!read) throw new Error('expected the object to be readable')
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test(
  'createLocalFilesystemAssetStorage: get() returns undefined for a genuinely missing key ' +
    '(the real NotFound branch, distinct from a rejected/traversal key)',
  async () => {
    const dir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      const storage = createLocalFilesystemAssetStorage(dir)
      assertEquals(await storage.get('assets/never-existed/original'), undefined)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'createLocalFilesystemAssetStorage: delete() on a key that was never stored is a silent no-op',
  async () => {
    const dir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      const storage = createLocalFilesystemAssetStorage(dir)
      await storage.delete('assets/never-existed/original')
      assertEquals(await storage.exists('assets/never-existed/original'), false)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)
