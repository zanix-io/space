import { assert, assertEquals, assertFalse, assertRejects } from '@std/assert'
import { InternalError } from '@zanix/errors'
import {
  hashSourceKey,
  loadCometManifest,
  normalizeSourceKey,
  resolveCometModuleUrl,
  setCometManifest,
} from 'modules/comets/comet-manifest.ts'

Deno.test('hashSourceKey: deterministic — the same input always hashes the same', () => {
  const key = '/Users/someone/project/comets/counter.tsx'
  assertEquals(hashSourceKey(key), hashSourceKey(key))
})

Deno.test('hashSourceKey: a different input hashes differently', () => {
  const a = hashSourceKey('/Users/someone/project/comets/counter.tsx')
  const b = hashSourceKey('/Users/someone/project/comets/widget.tsx')
  assert(a !== b)
})

Deno.test('hashSourceKey: never contains the original path — the entire point of hashing it', () => {
  const key = '/Users/someone/project/comets/counter.tsx'
  const hash = hashSourceKey(key)
  assertFalse(hash.includes('someone'))
  assertFalse(hash.includes('counter'))
})

Deno.test('hashSourceKey: always an 8-character lowercase hex string', () => {
  const hash = hashSourceKey('/Users/someone/project/comets/counter.tsx')
  assertEquals(hash.length, 8)
  assert(/^[0-9a-f]{8}$/.test(hash), hash)
})

Deno.test('normalizeSourceKey: a path that is not a file:// url passes through unchanged', () => {
  assertEquals(normalizeSourceKey('/already/plain/path.tsx'), '/already/plain/path.tsx')
})

Deno.test('resolveCometModuleUrl: with no manifest, strips the project root prefix', () => {
  setCometManifest(undefined)

  const url = resolveCometModuleUrl(
    'file:///project/comets/counter.tsx',
    '/project',
  )

  assertEquals(url, '/comets/counter.tsx')
})

Deno.test(
  "resolveCometModuleUrl: with no manifest, a source OUTSIDE the root resolves via Vite's own " +
    '/@fs/ convention — confirmed as a real, reproduced 404 before this branch existed (this ' +
    "package's own built-in DefaultErrorView, which lives outside an app's own devRoot)",
  () => {
    setCometManifest(undefined)

    const url = resolveCometModuleUrl(
      'file:///elsewhere/counter.tsx',
      '/project',
    )

    assertEquals(url, '/@fs/elsewhere/counter.tsx')
  },
)

Deno.test('resolveCometModuleUrl: with a manifest, resolves via the source path lookup', () => {
  setCometManifest({
    '/project/comets/counter.tsx': '/assets/counter-hash.js',
  })
  try {
    const url = resolveCometModuleUrl(
      'file:///project/comets/counter.tsx',
      '/project',
    )

    assertEquals(url, '/assets/counter-hash.js')
  } finally {
    setCometManifest(undefined)
  }
})

Deno.test(
  'resolveCometModuleUrl: with a manifest, an unlisted source falls back to the raw url',
  () => {
    setCometManifest({ '/project/comets/other.tsx': '/assets/other-hash.js' })
    try {
      const url = resolveCometModuleUrl(
        'file:///project/comets/counter.tsx',
        '/project',
      )

      assertEquals(url, 'file:///project/comets/counter.tsx')
    } finally {
      setCometManifest(undefined)
    }
  },
)

Deno.test(
  'resolveCometModuleUrl: with no manifest, a devRoot already given as a file:// url is used as-is',
  () => {
    setCometManifest(undefined)

    const url = resolveCometModuleUrl(
      'file:///project/comets/counter.tsx',
      'file:///project',
    )

    assertEquals(url, '/comets/counter.tsx')
  },
)

Deno.test('loadCometManifest: loads and installs the manifest from disk', async () => {
  const path = await Deno.makeTempFile({ suffix: '.json' })
  try {
    await Deno.writeTextFile(
      path,
      JSON.stringify({ '/project/comets/counter.tsx': '/assets/counter-hash.js' }),
    )
    await loadCometManifest(path)

    const url = resolveCometModuleUrl('file:///project/comets/counter.tsx', '/project')
    assertEquals(url, '/assets/counter-hash.js')
  } finally {
    setCometManifest(undefined)
    await Deno.remove(path)
  }
})

Deno.test(
  'loadCometManifest: a missing manifest file is not an error — the dev-mode fallback stays in effect',
  async () => {
    setCometManifest(undefined)
    await loadCometManifest('/nonexistent/path/comets-manifest.json')

    const url = resolveCometModuleUrl('file:///project/comets/counter.tsx', '/project')
    assertEquals(url, '/comets/counter.tsx')
  },
)

/**
 * Regression coverage: `loadCometManifest` used to rethrow a non-`NotFound` error (e.g. a
 * `SyntaxError` from malformed JSON) completely raw. Boot-time-only (never reaches an HTTP
 * response), so this proves the shared `InternalError` class specifically — not `code`/
 * `userMessage`, which the real exemption (`WebServerManager`'s own `readSslFile`) deliberately
 * skips for a boot-time-only failure.
 */
Deno.test(
  'loadCometManifest: a non-NotFound error (e.g. malformed JSON) is wrapped into InternalError, never rethrown raw',
  async () => {
    const path = await Deno.makeTempFile({ suffix: '.json' })
    try {
      await Deno.writeTextFile(path, '{ not valid json')
      const error = await assertRejects(() => loadCometManifest(path), InternalError)
      assertEquals(error.cause instanceof SyntaxError, true)
    } finally {
      await Deno.remove(path)
    }
  },
)
