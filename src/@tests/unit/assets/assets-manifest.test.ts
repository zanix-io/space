import { assertEquals } from '@std/assert'
import { dirname, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import {
  getAssetsBuildOutput,
  getAssetsManifest,
  loadAssetsBuildOutput,
  loadAssetsManifest,
  resolveAssetHref,
  setAssetsManifestState,
} from 'modules/assets/assets-manifest.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

function reset() {
  setAssetsManifestState(undefined)
}

Deno.test(
  'resolveAssetHref: falls back to the stable /assets/<path> when no manifest is loaded',
  () => {
    reset()
    assertEquals(resolveAssetHref('logo.svg'), '/assets/logo.svg')
  },
)

Deno.test("resolveAssetHref: returns the manifest's hashed URL when one exists", () => {
  reset()
  setAssetsManifestState({ manifest: { 'logo.svg': '/assets/logo-a1b2c3.svg' } })
  assertEquals(resolveAssetHref('logo.svg'), '/assets/logo-a1b2c3.svg')
})

Deno.test(
  'resolveAssetHref: a manifest loaded but missing THIS specific path still falls back to the ' +
    'stable path — a stale reference, or a file assetsDir genuinely does not have',
  () => {
    reset()
    setAssetsManifestState({ manifest: { 'other.svg': '/assets/other-x.svg' } })
    assertEquals(resolveAssetHref('logo.svg'), '/assets/logo.svg')
  },
)

Deno.test('loadAssetsManifest: loads a real manifest file from disk', async () => {
  reset()
  const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    const manifestPath = join(dir, 'assets-manifest.json')
    await Deno.writeTextFile(manifestPath, JSON.stringify({ 'logo.svg': '/assets/logo-x.svg' }))

    await loadAssetsManifest(manifestPath)

    assertEquals(getAssetsManifest(), { 'logo.svg': '/assets/logo-x.svg' })
    assertEquals(resolveAssetHref('logo.svg'), '/assets/logo-x.svg')
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test(
  'loadAssetsManifest: a missing file is not an error — the normal state for an app with no ' +
    'assetsDir, or no real build yet',
  async () => {
    reset()
    await loadAssetsManifest('/nonexistent/assets-manifest.json')
    assertEquals(getAssetsManifest(), undefined)
  },
)

Deno.test('loadAssetsBuildOutput/getAssetsBuildOutput: stores and reads back the directory', () => {
  reset()
  assertEquals(getAssetsBuildOutput(), undefined)
  loadAssetsBuildOutput('./dist/client')
  assertEquals(getAssetsBuildOutput(), './dist/client')
})

Deno.test(
  'setAssetsManifestState: clears both manifest and build output via undefined',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(
        join(dir, 'm.json'),
        JSON.stringify({ 'logo.svg': '/assets/logo-x.svg' }),
      )
      await loadAssetsManifest(join(dir, 'm.json'))
      loadAssetsBuildOutput(dirname(join(dir, 'm.json')))

      setAssetsManifestState(undefined)

      assertEquals(getAssetsManifest(), undefined)
      assertEquals(getAssetsBuildOutput(), undefined)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)
