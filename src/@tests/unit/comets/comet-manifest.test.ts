import { assertEquals } from '@std/assert'
import { resolveCometModuleUrl, setCometManifest } from 'modules/comets/comet-manifest.ts'

Deno.test('resolveCometModuleUrl: with no manifest, strips the project root prefix', () => {
  setCometManifest(undefined)

  const url = resolveCometModuleUrl('file:///project/comets/counter.tsx', '/project')

  assertEquals(url, '/comets/counter.tsx')
})

Deno.test(
  'resolveCometModuleUrl: with no manifest, falls back to the raw url if it is outside the root',
  () => {
    setCometManifest(undefined)

    const url = resolveCometModuleUrl('file:///elsewhere/counter.tsx', '/project')

    assertEquals(url, 'file:///elsewhere/counter.tsx')
  },
)

Deno.test('resolveCometModuleUrl: with a manifest, resolves via the source path lookup', () => {
  setCometManifest({ '/project/comets/counter.tsx': '/assets/counter-hash.js' })
  try {
    const url = resolveCometModuleUrl('file:///project/comets/counter.tsx', '/project')

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
      const url = resolveCometModuleUrl('file:///project/comets/counter.tsx', '/project')

      assertEquals(url, 'file:///project/comets/counter.tsx')
    } finally {
      setCometManifest(undefined)
    }
  },
)
