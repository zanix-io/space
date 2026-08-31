import { assertEquals, assertRejects } from '@std/assert'
import { getTemporaryFolder } from '@zanix/helpers'
import { InternalError } from '@zanix/errors'
import {
  CLIENT_ENTRY_VIRTUAL_ID,
  getClientEntry,
  loadClientEntryManifest,
  resolveClientEntrySpecifier,
  resolveClientEntryUrl,
  setClientEntry,
  setClientEntryManifest,
} from 'modules/render/client-entry.ts'
import { setDevClientEnabled } from 'modules/dev/dev-client-registry.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

function reset() {
  setClientEntry(undefined)
  setClientEntryManifest(undefined)
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
  'resolveClientEntryUrl: outside dev, resolves an override entry through the loaded manifest by its own realpath key',
  () => {
    try {
      setClientEntry('./main.client.ts')
      setClientEntryManifest({ './main.client.ts': '/main-client-def456.js' })
      assertEquals(resolveClientEntryUrl(), '/main-client-def456.js')
    } finally {
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
