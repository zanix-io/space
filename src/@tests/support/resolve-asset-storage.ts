/**
 * REFERENCE EXAMPLE — not shipped, not part of the published package (`src/@tests` is excluded
 * from `deno publish`; see `assets-api/dependency-boundary.test.ts` for the real, checked proof
 * that `@zanix/datamaster` never reaches the published `assets-api` module graph).
 *
 * Demonstrates the composition a real consuming application — never `@zanix/space` itself, never
 * `@zanix/datamaster` — is responsible for: deciding which `AssetStorage` implementation backs
 * `AssetService`, based purely on configuration.
 *
 * `S3_ENDPOINT`'s presence is the primary signal — the same convention
 * `@zanix/datamaster`'s own `./core` auto-registration already uses for every optional connector
 * (Elasticsearch/OpenSearch included), so this introduces no second, space-specific flag for THAT
 * decision. `ASSETS_S3_ENABLED` is a separate, narrower override: it exists for an app that
 * configures `S3_ENDPOINT` for some OTHER feature entirely and explicitly does NOT want
 * Assets to use it — set to the literal `'false'` to opt Assets out even though S3 itself is
 * configured. Unset (or anything else) never disables it on its own; only S3 actually being
 * unconfigured does. This mirrors this exact repo's own established "explicit override always wins,
 * unset means default-on" convention (e.g. `AUTO_PROTECT_ON_DB_UPDATE` in `@zanix/datamaster`).
 *
 * When S3 is active, the returned `AssetStorage` is `S3ObjectStorage` wrapped in a fallback
 * to `LocalFilesystemAssetStorage`, via `@zanix/datamaster/storage`'s own generic
 * `createFallbackObjectStorage` (`AssetStorage`/`ObjectStorage` are structurally identical, so no
 * adapter is needed) — protects against exactly one real scenario: `S3_ENDPOINT` gets
 * unset for a while (assets written locally in the meantime), then set again — those assets must
 * stay reachable, not silently 404. The fallback also lazily migrates anything found only locally
 * into S3, once per process, via that same package's `ensureLocalObjectsSynced`.
 *
 * When S3 is inactive, this resolves to `LocalFilesystemAssetStorage` alone — the same dev/test
 * default this package's own functional tests already use.
 *
 * Resolution itself (not the per-key fallback, not the migration) MUST succeed when S3 is meant to
 * be active — if `ProgramModule.getConnectors().get('s3')` throws (e.g. the app forgot to import
 * `@zanix/datamaster/core` before this runs), that propagates for real, rather than this function
 * silently constructing a local-only store. A production environment that believes it's writing to
 * S3 must never discover otherwise from a swallowed error.
 *
 * @module
 */

import type { AssetStorage } from 'modules/assets-api/ports/asset-storage.ts'

import { ProgramModule } from '@zanix/server'
import { createLocalFilesystemAssetStorage } from 'modules/assets-api/adapters/local-filesystem-asset-storage.ts'
import {
  createFallbackObjectStorage,
  ensureLocalObjectsSynced,
  S3_ENDPOINT_ENV,
} from '@zanix/datamaster/storage'
import type { S3ObjectStorage } from '@zanix/datamaster/storage'

/** Set to the literal `'false'` to keep Assets on `LocalFilesystemAssetStorage` even though
 * `S3_ENDPOINT` is configured (e.g. it's configured for a different feature entirely). */
export const ASSETS_S3_ENABLED_ENV = 'ASSETS_S3_ENABLED'

function isAssetsS3Active(): boolean {
  return Deno.env.has(S3_ENDPOINT_ENV) &&
    Deno.env.get(ASSETS_S3_ENABLED_ENV) !== 'false'
}

/**
 * Resolves the `AssetStorage` a real application should construct `AssetService` with.
 *
 * `localDir` is used both as the pure dev/test fallback (S3 inactive) and, when S3 IS active, as
 * the fallback/migration source for `createFallbackAssetStorage` — the same directory either way,
 * so assets written while S3 was off stay reachable once it's on.
 *
 * @throws If S3 is meant to be active but the `'s3'` connector isn't actually resolvable —
 * deliberately never caught here, see this module's own top-level doc.
 */
export function resolveAssetStorage(localDir: string): AssetStorage {
  const local = createLocalFilesystemAssetStorage(localDir)

  if (!isAssetsS3Active()) {
    return local
  }

  // `S3ObjectStorage` already structurally satisfies `AssetStorage` (identical
  // put/get/delete/exists shape) — no adapter class needed, just the resolved instance itself.
  const s3 = ProgramModule.getConnectors(undefined, false).get<S3ObjectStorage>('s3')

  return createFallbackObjectStorage(
    s3,
    local,
    () => ensureLocalObjectsSynced(local, s3, localDir),
  )
}
