import { assert, assertEquals } from '@std/assert'
import { closeAllConnections, ProgramModule } from '@zanix/server'
import { registerS3Connector } from '@zanix/datamaster/core'
import { createLocalFilesystemAssetStorage } from 'modules/assets-api/adapters/local-filesystem-asset-storage.ts'
import {
  createFallbackObjectStorage,
  ensureLocalObjectsSynced,
  resetLocalObjectsSyncState,
  type S3ObjectStorage,
} from '@zanix/datamaster/storage'

/**
 * The local-only -> S3 lazy migration (`@zanix/datamaster/storage`'s own generic
 * `ensureLocalObjectsSynced`/`createFallbackObjectStorage`), exercised against a REAL SeaweedFS
 * instance — no mocked `S3Client`. Same `RUN_S3_TESTS` convention as
 * `voice-upload-s3.test.ts`/`@zanix/datamaster`'s own `s3-object-storage.test.ts`
 * functional suite: gated purely on the flag, genuinely fails (never silently skips) if the flag
 * is set but no SeaweedFS is actually reachable.
 *
 * Covers what the unit-level `asset-storage-migration-e2e.test.ts` already proves against an
 * in-memory S3 stand-in, but against the real thing: a real network round-trip, real S3 metadata
 * persistence (the migrated object's checksum/content-type really survive a real PUT then GET),
 * and a real `NoSuchKey` from a real SeaweedFS gateway driving the fallback decision.
 */
const shouldRun = Deno.env.get('RUN_S3_TESTS') === 'true'

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !shouldRun,
  name: 'local-only asset migrates into a REAL SeaweedFS on first read, and is served by it ' +
    'directly afterward',
  fn: async () => {
    resetLocalObjectsSyncState()
    Deno.env.set(
      'S3_ENDPOINT',
      Deno.env.get('S3_ENDPOINT') || 'http://localhost:8333',
    )
    // Real, portable replacement for the old query-string-on-a-local-path re-evaluation trick
    // (`datamaster-internal/core.ts?case=...`) — see `resolve-asset-storage-s3.test.ts`'s own doc.
    await closeAllConnections()
    registerS3Connector()

    const s3 = ProgramModule.getConnectors(undefined, false).get(
      's3',
    ) as InstanceType<typeof S3ObjectStorage>

    const dir = await Deno.makeTempDir()
    const key = `assets/migration-test-${crypto.randomUUID()}/original`
    try {
      const local = createLocalFilesystemAssetStorage(dir)
      const bytes = new TextEncoder().encode('a real local-only asset, never yet in S3')
      const original = await local.put(key, bytes, { contentType: 'audio/wav' })

      // Genuinely absent from the real SeaweedFS before migration.
      assertEquals(await s3.exists(key), false)

      const storage = createFallbackObjectStorage(
        s3,
        local,
        () => ensureLocalObjectsSynced(local, s3, dir),
      )

      const firstRead = await storage.get(key)
      assert(firstRead, 'expected the local-only object to be found via fallback')
      assertEquals(new Uint8Array(await new Response(firstRead.stream).arrayBuffer()), bytes)

      // Migrated for real — the SAME S3ObjectStorage instance, addressed directly, now
      // has it.
      const migrated = await s3.get(key)
      assert(migrated, 'expected the object to have really landed in SeaweedFS')
      assertEquals(migrated.object.key, original.key)
      assertEquals(migrated.object.size, original.size)
      assertEquals(migrated.object.checksum, original.checksum)
      assertEquals(migrated.object.contentType, 'audio/wav')
      assertEquals(new Uint8Array(await new Response(migrated.stream).arrayBuffer()), bytes)

      // A second read, through a storage whose fallback is deliberately broken, still succeeds —
      // proving it's served by the real S3 primary alone now.
      const brokenFallback = {
        put: () => Promise.reject(new Error('fallback must never be reached again')),
        get: () => Promise.reject(new Error('fallback must never be reached again')),
        exists: () => Promise.reject(new Error('fallback must never be reached again')),
        delete: () => Promise.reject(new Error('fallback must never be reached again')),
      }
      const storageAfterMigration = createFallbackObjectStorage(s3, brokenFallback)
      const secondRead = await storageAfterMigration.get(key)
      assert(secondRead, 'expected the second read to be served entirely by the real SeaweedFS')
      assertEquals(new Uint8Array(await new Response(secondRead.stream).arrayBuffer()), bytes)
    } finally {
      await s3.delete(key).catch(() => {})
      await Deno.remove(dir, { recursive: true })
    }
  },
})
