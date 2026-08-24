import { assertThrows } from '@std/assert'
import { resolveAssetStorage } from '../../support/resolve-asset-storage.ts'

/**
 * Its own file — see `resolve-asset-storage-local.test.ts`'s own doc for why.
 *
 * The real-world misconfiguration this proves: `S3_ENDPOINT` is set (the app intends to
 * use S3), but `@zanix/datamaster/core` was never imported, so the `'s3'` slot itself was never
 * registered. `resolveAssetStorage()` must throw here — never silently fall back to
 * `LocalFilesystemAssetStorage`. A production environment that believes it configured S3 must find
 * out immediately if it's actually still writing to local disk, not discover it later from missing
 * data.
 */

Deno.test(
  'resolveAssetStorage: with S3_ENDPOINT set but the s3 connector never registered, ' +
    'throws rather than silently falling back to local disk',
  () => {
    Deno.env.set('S3_ENDPOINT', 'http://localhost:8333')
    try {
      assertThrows(() => resolveAssetStorage('/unused'))
    } finally {
      Deno.env.delete('S3_ENDPOINT')
    }
  },
)
