import { assertEquals, assertRejects } from '@std/assert'
import { getTemporaryFolder } from '@zanix/helpers'
import { InternalError } from '@zanix/errors'
import {
  CLIENT_ENTRY_VIRTUAL_ID,
  getClientEntry,
  loadClientEntryManifest,
  loadClientEntryProductionKey,
  resolveClientEntryFilePath,
  resolveClientEntrySpecifier,
  resolveClientEntryUrl,
  setClientEntry,
  setClientEntryManifest,
  setClientEntryProductionKey,
} from 'modules/render/client-entry.ts'
import { setDevClientEnabled } from 'modules/dev/dev-client-registry.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

function reset() {
  setClientEntry(undefined)
  setClientEntryManifest(undefined)
  setClientEntryProductionKey(undefined)
  setDevClientEnabled(false)
}

Deno.test('getClientEntry: reflects whatever setClientEntry last set', () => {
  try {
    assertEquals(getClientEntry(), undefined)
    setClientEntry('./main.client.ts')
    assertEquals(getClientEntry(), './main.client.ts')
  } finally {
    reset()
  }
})

Deno.test(
  'setClientEntry: a hard replace, not a composition — the second call fully discards the first',
  () => {
    try {
      setClientEntry('./base.client.ts')
      setClientEntry('./host.client.ts')
      assertEquals(getClientEntry(), './host.client.ts')
    } finally {
      reset()
    }
  },
)

Deno.test(
  'resolveClientEntrySpecifier: no override configured resolves to the virtual default id',
  () => {
    try {
      assertEquals(resolveClientEntrySpecifier(), CLIENT_ENTRY_VIRTUAL_ID)
    } finally {
      reset()
    }
  },
)

Deno.test(
  'resolveClientEntrySpecifier: an explicit override wins over the virtual default',
  () => {
    try {
      setClientEntry('./main.client.ts')
      assertEquals(resolveClientEntrySpecifier(), './main.client.ts')
    } finally {
      reset()
    }
  },
)

Deno.test(
  'resolveClientEntryUrl: in dev, no override resolves directly to the virtual id — no manifest, no hashing',
  () => {
    try {
      setDevClientEnabled(true)
      assertEquals(resolveClientEntryUrl(), CLIENT_ENTRY_VIRTUAL_ID)
    } finally {
      reset()
    }
  },
)

Deno.test(
  'resolveClientEntryUrl: in dev, an override path is root-relative-ified, same transform CSS hrefs use minus ?direct',
  () => {
    try {
      setClientEntry('./src/main.client.ts')
      setDevClientEnabled(true)
      assertEquals(resolveClientEntryUrl(), '/src/main.client.ts')
    } finally {
      reset()
    }
  },
)

Deno.test(
  'resolveClientEntryUrl: outside dev, no manifest loaded resolves to undefined',
  () => {
    try {
      assertEquals(resolveClientEntryUrl(), undefined)
    } finally {
      reset()
    }
  },
)

Deno.test(
  'resolveClientEntryUrl: outside dev, resolves the default virtual id through the loaded manifest',
  () => {
    try {
      setClientEntryManifest({ [CLIENT_ENTRY_VIRTUAL_ID]: '/client-entry-abc123.js' })
      assertEquals(resolveClientEntryUrl(), '/client-entry-abc123.js')
    } finally {
      reset()
    }
  },
)

Deno.test(
  'resolveClientEntryUrl: outside dev, an override entry keyed by its own raw config string never resolves once the production key is resolved to its real, different realpath — the exact mismatch a real production build produces',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(`${dir}/main.client.ts`, '')
      setClientEntry('./main.client.ts')
      await loadClientEntryProductionKey(dir)
      // Exactly what `client-entry-plugin.ts`'s own `generateBundle` would NEVER actually write —
      // it keys by the realpath, same as the production key just resolved above — but a manifest
      // keyed by the literal, un-resolved override string (as `resolveClientEntrySpecifier()`
      // alone would look it up by) is precisely the mismatch this cache exists to avoid.
      setClientEntryManifest({ './main.client.ts': '/main-client-def456.js' })
      assertEquals(resolveClientEntryUrl(), undefined)
    } finally {
      await Deno.remove(dir, { recursive: true })
      reset()
    }
  },
)

Deno.test(
  "resolveClientEntryUrl: outside dev, resolves an override entry through the loaded manifest by its cached, realpath'd production key",
  () => {
    try {
      setClientEntry('./main.client.ts')
      setClientEntryProductionKey('/real/project/main.client.ts')
      setClientEntryManifest({ '/real/project/main.client.ts': '/main-client-def456.js' })
      assertEquals(resolveClientEntryUrl(), '/main-client-def456.js')
    } finally {
      reset()
    }
  },
)

Deno.test(
  'resolveClientEntryFilePath: no override resolves to undefined — no file to realpath',
  async () => {
    assertEquals(await resolveClientEntryFilePath('/any/root', undefined), undefined)
  },
)

Deno.test(
  "resolveClientEntryFilePath: an override resolves relative to root, then realpath'd",
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const filePath = `${dir}/main.client.ts`
    try {
      await Deno.writeTextFile(filePath, '')
      assertEquals(
        await resolveClientEntryFilePath(dir, './main.client.ts'),
        await Deno.realPath(filePath),
      )
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'loadClientEntryProductionKey: no override caches the virtual default id, matching what build-client.ts keys the manifest by for a zero-config app',
  async () => {
    try {
      await loadClientEntryProductionKey('/any/root')
      setClientEntryManifest({ [CLIENT_ENTRY_VIRTUAL_ID]: '/client-entry-abc123.js' })
      assertEquals(resolveClientEntryUrl(), '/client-entry-abc123.js')
    } finally {
      reset()
    }
  },
)

Deno.test(
  'loadClientEntryProductionKey: an override caches its realpath, closing the exact gap a raw-string lookup left open in production',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const filePath = `${dir}/main.client.ts`
    try {
      await Deno.writeTextFile(filePath, '')
      const realPath = await Deno.realPath(filePath)
      setClientEntry('./main.client.ts')
      await loadClientEntryProductionKey(dir)
      setClientEntryManifest({ [realPath]: '/main-client-def456.js' })
      assertEquals(resolveClientEntryUrl(), '/main-client-def456.js')
    } finally {
      await Deno.remove(dir, { recursive: true })
      reset()
    }
  },
)

Deno.test(
  'loadClientEntryManifest: a valid manifest file is read and parsed, reflected by resolveClientEntryUrl',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const path = `${dir}/client-entry-manifest.json`
    try {
      const manifest = { [CLIENT_ENTRY_VIRTUAL_ID]: '/client-entry-abc123.js' }
      await Deno.writeTextFile(path, JSON.stringify(manifest))
      await loadClientEntryManifest(path)
      assertEquals(resolveClientEntryUrl(), '/client-entry-abc123.js')
    } finally {
      await Deno.remove(dir, { recursive: true })
      reset()
    }
  },
)

Deno.test(
  'loadClientEntryManifest: a genuinely missing file resolves silently, without clobbering the previously loaded manifest',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const path = `${dir}/does-not-exist.json`
    try {
      setClientEntryManifest({ [CLIENT_ENTRY_VIRTUAL_ID]: '/already-loaded.js' })
      await loadClientEntryManifest(path)
      assertEquals(resolveClientEntryUrl(), '/already-loaded.js')
    } finally {
      await Deno.remove(dir, { recursive: true })
      reset()
    }
  },
)

Deno.test(
  'loadClientEntryManifest: a file that exists but holds invalid JSON is wrapped into InternalError — never rethrown raw',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const path = `${dir}/client-entry-manifest.json`
    try {
      await Deno.writeTextFile(path, '{ not valid json')
      const error = await assertRejects(() => loadClientEntryManifest(path), InternalError)
      assertEquals(error.cause instanceof SyntaxError, true)
    } finally {
      await Deno.remove(dir, { recursive: true })
      reset()
    }
  },
)
