import { assertEquals, assertRejects } from '@std/assert'
import { InternalError } from '@zanix/errors'
import {
  getSitemapManifest,
  loadSitemapManifest,
  setSitemapManifest,
} from 'modules/seo/sitemap-manifest.ts'

Deno.test('getSitemapManifest: undefined until a manifest is loaded or set', () => {
  setSitemapManifest(undefined)
  assertEquals(getSitemapManifest(), undefined)
})

Deno.test('loadSitemapManifest: loads and installs the manifest from disk', async () => {
  const path = await Deno.makeTempFile({ suffix: '.json' })
  try {
    await Deno.writeTextFile(path, JSON.stringify([{ loc: '/about' }]))
    await loadSitemapManifest(path)

    assertEquals(getSitemapManifest(), [{ loc: '/about' }])
  } finally {
    setSitemapManifest(undefined)
    await Deno.remove(path)
  }
})

Deno.test(
  'loadSitemapManifest: a missing manifest file is not an error — no sitemap route registers',
  async () => {
    setSitemapManifest(undefined)
    await loadSitemapManifest('/nonexistent/path/sitemap-manifest.json')

    assertEquals(getSitemapManifest(), undefined)
  },
)

/**
 * Regression coverage: `loadCometManifest`'s own equivalent used to rethrow a non-`NotFound` error
 * raw — this proves the shared `InternalError` wrapping applies here too, not just there.
 */
Deno.test(
  'loadSitemapManifest: a non-NotFound error (e.g. malformed JSON) is wrapped into InternalError, never rethrown raw',
  async () => {
    const path = await Deno.makeTempFile({ suffix: '.json' })
    try {
      await Deno.writeTextFile(path, '{ not valid json')
      const error = await assertRejects(() => loadSitemapManifest(path), InternalError)
      assertEquals(error.cause instanceof SyntaxError, true)
    } finally {
      await Deno.remove(path)
    }
  },
)
