import { assert, assertEquals, assertNotEquals, assertRejects } from '@std/assert'
import { generateRSAKeys, getTemporaryFolder } from '@zanix/helpers'
import { InternalError } from '@zanix/errors'
import { createLocalFilesystemAssetStorage } from 'modules/assets-api/adapters/local-filesystem-asset-storage.ts'

/**
 * Regression coverage for a real path-traversal risk class: a `key` that escapes `rootDir`
 * (`../`, or an absolute path overriding it entirely) must never let `put`/`get`/`delete` touch
 * disk outside the intended store — `key` is joined onto `rootDir` through `@zanix/helpers`'s
 * `confinePath`, which enforces containment, never a bare `join(rootDir, key)`. This suite proves
 * each `AssetStorage` method rejects such a `key` instead of ever reaching `Deno.*`.
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

Deno.test(
  'createLocalFilesystemAssetStorage: omitting options.encrypt writes the exact plaintext bytes ' +
    'to disk, unchanged from before the option existed',
  async () => {
    const dir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      const storage = createLocalFilesystemAssetStorage(dir)
      const bytes = new TextEncoder().encode('never encrypted')
      await storage.put('assets/plain/original', bytes, { contentType: 'text/plain' })

      const onDisk = await Deno.readFile(`${dir}/assets/plain/original`)
      assertEquals(onDisk, bytes, 'expected the raw file on disk to be the exact plaintext bytes')

      const found = await storage.get('assets/plain/original')
      assert(found, 'expected the object to be found')
      assertEquals(new Uint8Array(await new Response(found.stream).arrayBuffer()), bytes)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'createLocalFilesystemAssetStorage with symmetric encryption stores ciphertext, never the ' +
    'plaintext bytes, on disk, and round-trips',
  async () => {
    Deno.env.set('DATA_AES_KEY', 'a-test-symmetric-key-value')
    const dir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      const storage = createLocalFilesystemAssetStorage(dir, { encrypt: { type: 'symmetric' } })
      const plaintext = new TextEncoder().encode('sensitive photo bytes')
      await storage.put('assets/enc/original', plaintext, { contentType: 'image/jpeg' })

      const onDisk = await Deno.readFile(`${dir}/assets/enc/original`)
      assertNotEquals(
        onDisk,
        plaintext,
        'expected the raw file on disk to be ciphertext, never the plaintext',
      )

      const fetched = await storage.get('assets/enc/original')
      assert(fetched, 'expected the object to be found')
      const roundTripped = new Uint8Array(await new Response(fetched.stream).arrayBuffer())
      assertEquals(roundTripped, plaintext)
    } finally {
      await Deno.remove(dir, { recursive: true })
      Deno.env.delete('DATA_AES_KEY')
    }
  },
)

Deno.test(
  'createLocalFilesystemAssetStorage with symmetric encryption enabled but no DATA_AES_KEY ' +
    'configured fails closed, never silently storing plaintext',
  async () => {
    Deno.env.delete('DATA_AES_KEY')
    const dir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      const storage = createLocalFilesystemAssetStorage(dir, { encrypt: { type: 'symmetric' } })
      await assertRejects(
        () => storage.put('assets/enc/original', new Uint8Array([1, 2, 3]), { contentType: 'x' }),
        Error,
        'DATA_AES_KEY',
      )
      assertEquals(await storage.exists('assets/enc/original'), false)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'createLocalFilesystemAssetStorage with asymmetric encryption wraps a random per-object AES ' +
    'key with RSA and round-trips',
  async () => {
    const { publicKey, privateKey } = await generateRSAKeys()
    Deno.env.set('DATA_RSA_PUB', btoa(publicKey))
    Deno.env.set('DATA_RSA_KEY', btoa(privateKey))
    const dir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      const storage = createLocalFilesystemAssetStorage(dir, { encrypt: { type: 'asymmetric' } })
      const plaintext = new TextEncoder().encode('sensitive video bytes')
      await storage.put('assets/enc/original', plaintext, { contentType: 'video/mp4' })

      const onDisk = await Deno.readFile(`${dir}/assets/enc/original`)
      assertNotEquals(onDisk, plaintext)

      const sidecar = JSON.parse(
        await Deno.readTextFile(`${dir}/assets/enc/original.meta.json`),
      )
      assert(
        sidecar.encryption?.wrappedKey,
        'expected a wrapped per-object AES key in the sidecar metadata',
      )

      const fetched = await storage.get('assets/enc/original')
      assert(fetched, 'expected the object to be found')
      const roundTripped = new Uint8Array(await new Response(fetched.stream).arrayBuffer())
      assertEquals(roundTripped, plaintext)
    } finally {
      await Deno.remove(dir, { recursive: true })
      Deno.env.delete('DATA_RSA_PUB')
      Deno.env.delete('DATA_RSA_KEY')
    }
  },
)

Deno.test(
  'createLocalFilesystemAssetStorage.get: an encryption-enabled instance correctly reads a ' +
    'genuinely unencrypted object stored alongside real encrypted ones, without corrupting it',
  async () => {
    Deno.env.set('DATA_AES_KEY', 'a-test-symmetric-key-value')
    const dir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      const plain = createLocalFilesystemAssetStorage(dir)
      const rawPlaintext = new TextEncoder().encode('this one was never encrypted')
      await plain.put('assets/mixed/original', rawPlaintext, { contentType: 'x' })

      const encrypted = createLocalFilesystemAssetStorage(dir, {
        encrypt: { type: 'symmetric' },
      })
      const fetchedPlain = await encrypted.get('assets/mixed/original')
      assert(fetchedPlain, 'expected the unencrypted object to be found')
      assertEquals(
        new Uint8Array(await new Response(fetchedPlain.stream).arrayBuffer()),
        rawPlaintext,
        'expected the unencrypted object to be returned as-is, never run through decryptBytes',
      )
    } finally {
      await Deno.remove(dir, { recursive: true })
      Deno.env.delete('DATA_AES_KEY')
    }
  },
)
