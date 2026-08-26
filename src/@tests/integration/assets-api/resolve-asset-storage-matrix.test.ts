import { assert } from '@std/assert'
import { resolveAssetStorage } from '../../support/resolve-asset-storage.ts'
import { resetLocalObjectsSyncState, S3ObjectStorage } from '@zanix/datamaster/storage'
import { registerS3Connector } from '@zanix/datamaster/core'
import { closeAllConnections, ProgramModule } from '@zanix/server'

/**
 * The complete `S3_ENDPOINT` × `ASSETS_S3_ENABLED` activation matrix — the 5 rows
 * requested, gathered here as ONE reference even though most are proven in their own dedicated
 * files (each needing its own process isolation for re-registering the `s3` connector — see
 * `resolve-asset-storage-s3.test.ts`'s own doc for why):
 *
 * | `S3_ENDPOINT` | `ASSETS_S3_ENABLED` | Result | Proven in                              |
 * |-------------------------|----------------------|--------|------------------------------------------|
 * | absent                  | (any)                | local  | `resolve-asset-storage-local.test.ts`     |
 * | present                 | `'false'`            | local  | `resolve-asset-storage-flag.test.ts`      |
 * | present                 | absent                | S3     | `resolve-asset-storage-s3.test.ts`        |
 * | present                 | `'true'`              | S3     | THIS FILE (the one row not covered yet)   |
 * | present                 | (any, incl. unset)    | error, never local, if the `s3` connector itself can't be resolved | `resolve-asset-storage-misconfigured.test.ts` |
 *
 * Its own file — re-registering the `s3` connector is a module-level-shaped side effect that would
 * otherwise outlive this one test, same reasoning `resolve-asset-storage-s3.test.ts`'s own doc gives.
 */

Deno.test({
  name: 'resolveAssetStorage matrix row: endpoint present + ASSETS_S3_ENABLED="true" (explicit, ' +
    'not just unset) resolves S3',
  fn: async () => {
    resetLocalObjectsSyncState()
    Deno.env.set('S3_ENDPOINT', 'http://localhost:8333')
    Deno.env.set('ASSETS_S3_ENABLED', 'true')
    try {
      // Clears the `'type:connector'` registry and re-registers fresh, re-reading the env vars
      // just set above — see `resolve-asset-storage-s3.test.ts`'s own doc for why this replaced
      // the query-string-on-a-local-path import trick this file used to need. `registerS3Connector`
      // became async in `@zanix/datamaster@1.6.0` (it now lazily `import()`s `./connector.ts` so
      // `@aws-sdk/client-s3` stays out of the graph for consumers that never set `S3_ENDPOINT`) —
      // this MUST be awaited, or the `@Connector` decoration/registration below hasn't actually run
      // yet by the time `.get('s3')` is called, and `getInstance` throws `[BaseInstancesContainer]:
      // Target is not a constructor` instead.
      await closeAllConnections()
      await registerS3Connector()

      const registered = ProgramModule.getConnectors(undefined, false).get('s3')
      assert(
        registered instanceof S3ObjectStorage,
        'expected the s3 connector to have been resolved when ASSETS_S3_ENABLED="true" explicitly',
      )

      const storage = resolveAssetStorage('/unused')
      assert(typeof storage.put === 'function' && typeof storage.get === 'function')
    } finally {
      Deno.env.delete('S3_ENDPOINT')
      Deno.env.delete('ASSETS_S3_ENABLED')
    }
  },
})
