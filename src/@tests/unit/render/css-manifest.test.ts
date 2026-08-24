import { assertEquals, assertRejects } from '@std/assert'
import { getTemporaryFolder } from '@zanix/helpers'
import { InternalError } from '@zanix/errors'
import {
  addGlobalCssPaths,
  getCssManifest,
  getGlobalCssPaths,
  loadCssManifest,
  resolveCssHrefs,
  setCssManifest,
  setGlobalCssPaths,
} from 'modules/render/css-manifest.ts'
import { setDevClientEnabled } from 'modules/dev/dev-client-registry.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

function reset() {
  setCssManifest(undefined)
  setGlobalCssPaths(undefined)
  setDevClientEnabled(false)
}

Deno.test(
  'resolveCssHrefs: outside dev, returns the production manifest unchanged',
  () => {
    try {
      setCssManifest({ global: ['/assets/app-abc123.css'] })
      assertEquals(resolveCssHrefs(), ['/assets/app-abc123.css'])
    } finally {
      reset()
    }
  },
)

Deno.test(
  'resolveCssHrefs: in dev, resolves globalCss paths instead of the production manifest',
  () => {
    try {
      setCssManifest({ global: ['/assets/app-abc123.css'] }) // present but must be ignored in dev
      setGlobalCssPaths(['./styles/app.css'])
      setDevClientEnabled(true)
      assertEquals(resolveCssHrefs(), ['/styles/app.css?direct'])
    } finally {
      reset()
    }
  },
)

Deno.test(
  'resolveCssHrefs: in dev, no globalCss declared resolves to an empty list, not undefined',
  () => {
    try {
      setDevClientEnabled(true)
      assertEquals(resolveCssHrefs(), [])
    } finally {
      reset()
    }
  },
)

Deno.test(
  'resolveCssHrefs: outside dev, no manifest loaded resolves to undefined',
  () => {
    try {
      assertEquals(resolveCssHrefs(), undefined)
    } finally {
      reset()
    }
  },
)

Deno.test('getGlobalCssPaths: reflects whatever setGlobalCssPaths last set', () => {
  try {
    assertEquals(getGlobalCssPaths(), undefined)
    setGlobalCssPaths(['./a.css'])
    assertEquals(getGlobalCssPaths(), ['./a.css'])
  } finally {
    reset()
  }
})

Deno.test(
  "addGlobalCssPaths: a base app's paths, contributed first, are preserved when a host app " +
    "appends its own afterward — neither needs to know the other's paths",
  () => {
    try {
      addGlobalCssPaths(['./base.css']) // the base app's own defineSpaceApp() call
      addGlobalCssPaths(['./custom.css']) // the host's own defineSpaceApp() call, activated after
      assertEquals(getGlobalCssPaths(), ['./base.css', './custom.css'])
    } finally {
      reset()
    }
  },
)

Deno.test('addGlobalCssPaths: a single call behaves exactly like setGlobalCssPaths would', () => {
  try {
    addGlobalCssPaths(['./only.css'])
    assertEquals(getGlobalCssPaths(), ['./only.css'])
  } finally {
    reset()
  }
})

Deno.test({
  name: 'addGlobalCssPaths: an empty array contributes nothing, leaving prior paths untouched',
  fn: () => {
    try {
      addGlobalCssPaths(['./base.css'])
      addGlobalCssPaths([])
      assertEquals(getGlobalCssPaths(), ['./base.css'])
    } finally {
      reset()
    }
  },
})

Deno.test(
  "setGlobalCssPaths: still a hard replace/reset, unaffected by addGlobalCssPaths's own accumulation",
  () => {
    try {
      addGlobalCssPaths(['./base.css'])
      addGlobalCssPaths(['./custom.css'])
      setGlobalCssPaths(['./only-this.css'])
      assertEquals(getGlobalCssPaths(), ['./only-this.css'])
      setGlobalCssPaths(undefined)
      assertEquals(getGlobalCssPaths(), undefined)
    } finally {
      reset()
    }
  },
)

Deno.test(
  'resolveCssHrefs: in dev, resolves the COMPOSED globalCss (base + host) in contribution order',
  () => {
    try {
      addGlobalCssPaths(['./base.css'])
      addGlobalCssPaths(['./custom.css'])
      setDevClientEnabled(true)
      assertEquals(resolveCssHrefs(), [
        '/base.css?direct',
        '/custom.css?direct',
      ])
    } finally {
      reset()
    }
  },
)

Deno.test('getCssManifest: reflects whatever setCssManifest last set', () => {
  try {
    assertEquals(getCssManifest(), undefined)
    setCssManifest({ global: ['/assets/app-abc123.css'] })
    assertEquals(getCssManifest(), { global: ['/assets/app-abc123.css'] })
  } finally {
    reset()
  }
})

Deno.test(
  'loadCssManifest: a valid manifest file is read and parsed, reflected by getCssManifest',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const path = `${dir}/css-manifest.json`
    try {
      const manifest = { global: ['/assets/app-abc123.css'], pages: { '/page.tsx': [] } }
      await Deno.writeTextFile(path, JSON.stringify(manifest))
      await loadCssManifest(path)
      assertEquals(getCssManifest(), manifest)
    } finally {
      await Deno.remove(dir, { recursive: true })
      reset()
    }
  },
)

Deno.test(
  'loadCssManifest: a genuinely missing file resolves silently, without clobbering the ' +
    'previously loaded manifest',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const path = `${dir}/does-not-exist.json`
    try {
      setCssManifest({ global: ['/assets/already-loaded.css'] })
      await loadCssManifest(path)
      assertEquals(getCssManifest(), { global: ['/assets/already-loaded.css'] })
    } finally {
      await Deno.remove(dir, { recursive: true })
      reset()
    }
  },
)

/**
 * Regression coverage: `loadCssManifest` used to rethrow a non-`NotFound` error (e.g. a
 * `SyntaxError` from malformed JSON) completely raw. Boot-time-only (never reaches an HTTP
 * response), so this proves the shared `InternalError` class specifically — not `code`/
 * `userMessage`, which the real exemption (`WebServerManager`'s own `readSslFile`) deliberately
 * skips for a boot-time-only failure.
 */
Deno.test(
  'loadCssManifest: a file that exists but holds invalid JSON is wrapped into InternalError — not the NotFound branch, never rethrown raw',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const path = `${dir}/css-manifest.json`
    try {
      await Deno.writeTextFile(path, '{ not valid json')
      const error = await assertRejects(() => loadCssManifest(path), InternalError)
      assertEquals(error.cause instanceof SyntaxError, true)
    } finally {
      await Deno.remove(dir, { recursive: true })
      reset()
    }
  },
)
