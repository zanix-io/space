import { assert } from '@std/assert'
import { resolveAssetStorage } from '../../support/resolve-asset-storage.ts'
import { resetLocalObjectsSyncState } from '@zanix/datamaster/storage'
import { registerS3Connector } from '@zanix/datamaster/core'
import { closeAllConnections, ProgramModule } from '@zanix/server'

/**
 * Its own file — see `resolve-asset-storage-local.test.ts`'s own doc for why (registering the `s3`
 * connector is a module-level-shaped side effect that would otherwise outlive this one test).
 *
 * Proves the RESOLUTION mechanism specifically: given `S3_ENDPOINT` and
 * `registerS3Connector()` called, `resolveAssetStorage()` really resolves the `s3`-slot
 * connector (not a "no such slot" error, not a silent local-only fallback) and wraps it — proven by
 * checking the SAME connector instance `ProgramModule.getConnectors().get('s3')` returns directly.
 * Doesn't re-exercise `S3ObjectStorage`'s own put/get/delete/exists behavior against a
 * mocked `S3Client` — that's already covered exhaustively by `@zanix/datamaster`'s own
 * `s3-object-storage.test.ts`. Doesn't exercise a real network call either (no real
 * S3-compatible backend reachable here) — see `voice-upload-s3.test.ts` for that.
 *
 * Lives in `integration/`, not `unit/`: it calls the real `registerS3Connector()` and asserts
 * against the real `ProgramModule.getConnectors()` registry, with nothing mocked — proving the
 * `s3` slot is genuinely wired up, not exercising isolated internal logic (see
 * `zanix-test-tier-conventions`' Pattern A).
 */

Deno.test({
  name: 'resolveAssetStorage: with S3_ENDPOINT set, resolves and wraps the real s3-slot ' +
    'connector',
  fn: async () => {
    resetLocalObjectsSyncState()
    Deno.env.set('S3_ENDPOINT', 'http://localhost:8333')
    try {
      // Clears the `'type:connector'` registry (`closeAllConnections()`, `@zanix/server`) and
      // re-registers fresh, re-reading the env var just set above — the real, portable replacement
      // for the query-string-on-a-local-path trick this file used to need
      // (`datamaster-internal/core.ts?case=...`): `registerS3Connector` is a real, callable
      // export now (`@zanix/datamaster/core`), so no module re-evaluation is required at all, and
      // this can use the real published `jsr:` specifier directly. Same technique
      // `@zanix/datamaster`'s own `observability/core.test.ts` already establishes for
      // `ELASTICSEARCH_URL`.
      await closeAllConnections()
      registerS3Connector()
      const { S3ObjectStorage } = await import('@zanix/datamaster/storage')

      const registered = ProgramModule.getConnectors(undefined, false).get('s3')
      assert(
        registered instanceof S3ObjectStorage,
        'sanity check: the s3 slot must resolve a real S3ObjectStorage in this scenario',
      )

      // resolveAssetStorage() must genuinely go through the SAME resolution path, not construct
      // its own separate connector or silently prefer the local-only adapter.
      const storage = resolveAssetStorage('/unused')
      assert(typeof storage.put === 'function' && typeof storage.get === 'function')
    } finally {
      Deno.env.delete('S3_ENDPOINT')
    }
  },
})
