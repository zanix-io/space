import { assert, assertEquals } from '@std/assert'
import { getTemporaryFolder } from '@zanix/helpers'
import { resolveAssetStorage } from '../../support/resolve-asset-storage.ts'

/**
 * `resolveAssetStorage()`'s own file — see that module's doc for the full composition rationale.
 * Its own file (not a shared one with the S3-configured case) because that OTHER case dynamically
 * imports `@zanix/datamaster/core`, a module-level side effect that, once registered, stays
 * registered for the rest of the process — `deno test` isolates each file into its own worker, so
 * this file's own "S3 isn't configured" scenario is never contaminated by that.
 */

Deno.test(
  'resolveAssetStorage: with no S3_ENDPOINT, resolves to a real, working ' +
    'LocalFilesystemAssetStorage',
  async () => {
    Deno.env.delete('S3_ENDPOINT')
    const dir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      const storage = resolveAssetStorage(dir)
      const bytes = new TextEncoder().encode('local dev bytes')
      const put = await storage.put('assets/a/original', bytes, { contentType: 'text/plain' })
      assertEquals(put.size, bytes.byteLength)

      const fetched = await storage.get('assets/a/original')
      assert(fetched, 'expected the object just written to disk to be found')
      const streamed = new Uint8Array(await new Response(fetched.stream).arrayBuffer())
      assertEquals(streamed, bytes)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)
