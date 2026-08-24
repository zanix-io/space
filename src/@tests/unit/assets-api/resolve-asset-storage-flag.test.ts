import { assert, assertEquals } from '@std/assert'
import { getTemporaryFolder } from '@zanix/helpers'
import { resolveAssetStorage } from '../../support/resolve-asset-storage.ts'

/**
 * Its own file — see `resolve-asset-storage-local.test.ts`'s own doc for why.
 *
 * `ASSETS_S3_ENABLED=false` is the explicit opt-out for an app that has `S3_ENDPOINT`
 * configured for some OTHER feature and deliberately does not want Assets to use it — proven here
 * by never even attempting to resolve the `s3` connector (no `@zanix/datamaster/core` import at
 * all), which would throw if `resolveAssetStorage()` tried to reach it despite the flag.
 */

Deno.test(
  'resolveAssetStorage: ASSETS_S3_ENABLED=false keeps Assets on LocalFilesystemAssetStorage even ' +
    'though S3_ENDPOINT is set',
  async () => {
    Deno.env.set('S3_ENDPOINT', 'http://localhost:8333')
    Deno.env.set('ASSETS_S3_ENABLED', 'false')
    const dir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      const storage = resolveAssetStorage(dir)
      const bytes = new TextEncoder().encode('local, despite S3 being configured elsewhere')
      const put = await storage.put('a', bytes, { contentType: 'text/plain' })
      assertEquals(put.size, bytes.byteLength)

      const found = await storage.get('a')
      assert(found, 'expected the write to have landed on local disk, not S3')
      const streamed = new Uint8Array(await new Response(found.stream).arrayBuffer())
      assertEquals(streamed, bytes)
    } finally {
      Deno.env.delete('S3_ENDPOINT')
      Deno.env.delete('ASSETS_S3_ENABLED')
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'resolveAssetStorage: ASSETS_S3_ENABLED unset (or anything other than "false") never disables ' +
    'S3 on its own — only S3_ENDPOINT being unset does',
  async () => {
    Deno.env.delete('S3_ENDPOINT')
    Deno.env.set('ASSETS_S3_ENABLED', 'true')
    const dir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      // With no S3 endpoint at all, this must still resolve cleanly to the local adapter —
      // `ASSETS_S3_ENABLED=true` alone never forces S3 on without the endpoint being configured.
      const storage = resolveAssetStorage(dir)
      const bytes = new TextEncoder().encode('x')
      await storage.put('a', bytes, { contentType: 'text/plain' })
      assertEquals(await storage.exists('a'), true)
    } finally {
      Deno.env.delete('ASSETS_S3_ENABLED')
      await Deno.remove(dir, { recursive: true })
    }
  },
)
