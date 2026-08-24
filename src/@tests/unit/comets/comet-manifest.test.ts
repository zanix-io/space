import { assertEquals, assertRejects } from '@std/assert'
import { InternalError } from '@zanix/errors'
import {
  loadCometManifest,
  normalizeSourceKey,
  resolveCometModuleUrl,
  setCometManifest,
} from 'modules/comets/comet-manifest.ts'

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
  'resolveCometModuleUrl: with no manifest, falls back to the raw url if it is outside the root',
  () => {
    setCometManifest(undefined)

    const url = resolveCometModuleUrl(
      'file:///elsewhere/counter.tsx',
      '/project',
    )

    assertEquals(url, 'file:///elsewhere/counter.tsx')
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
