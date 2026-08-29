// Installs a renderer, exactly as a real app does — same precedent
// `define-space-app-activation.test.tsx` already establishes.
import '../../../../mod-react.ts'
import { assertEquals, assertFalse } from '@std/assert'
import { getTemporaryFolder } from '@zanix/helpers'
import { activateApps, deactivateApps } from '@zanix/app/runtime'
import { defineSpaceApp } from 'modules/runtime/mod.ts'
import { getCometManifest, setCometManifest } from 'modules/comets/comet-manifest.ts'
import { getClientEntryManifest, setClientEntryManifest } from 'modules/render/client-entry.ts'
import { getCssManifest, setCssManifest } from 'modules/render/css-manifest.ts'
import {
  getAssetsBuildOutput,
  getAssetsManifest,
  setAssetsManifestState,
} from 'modules/assets/assets-manifest.ts'
import { getPwaBuildOutput, setPwaBuildOutput } from 'modules/pwa/pwa-registry.ts'
import { setDevClientEnabled } from 'modules/dev/dev-client-registry.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

/**
 * Confirms `SpaceAppConfig.clientBuildDir` genuinely replaces a production `main.ts`'s own manual
 * `loadXManifest`/`loadXBuildOutput` calls (see that option's own doc) — a real directory with real
 * manifest files on disk, loaded purely by passing `clientBuildDir` to `defineSpaceApp`, with no
 * `loadCometManifest`/`loadClientEntryManifest`/`loadCssManifest`/`loadAssetsManifest`/
 * `loadAssetsBuildOutput`/`loadPwaBuildOutput` call written anywhere in this test. Does not assert
 * `loadSitemapManifest` — `sitemap-manifest.test.ts` covers that loader in isolation, but nothing
 * today exercises it through THIS integration path (`clientBuildDir` + `sitemap: 'auto'` together).
 */
Deno.test(
  'defineSpaceApp({ clientBuildDir }) + activateApps: production manifests load ' +
    'automatically from real files on disk — no manual loadXManifest call anywhere in this test',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(
        `${dir}/comets-manifest.json`,
        JSON.stringify({ '/project/comets/counter.tsx': '/assets/counter-hash.js' }),
      )
      await Deno.writeTextFile(
        `${dir}/client-entry-manifest.json`,
        JSON.stringify({ '/@zanix/client-entry.ts': '/assets/client-entry-hash.js' }),
      )
      await Deno.writeTextFile(
        `${dir}/css-manifest.json`,
        JSON.stringify({ global: ['/assets/global-hash.css'] }),
      )
      await Deno.writeTextFile(
        `${dir}/assets-manifest.json`,
        JSON.stringify({ 'logo.svg': '/assets/logo-hash.svg' }),
      )

      const app = defineSpaceApp({ name: 'fixture-client-build-dir-app', clientBuildDir: dir })
      const activated = await activateApps([app])
      try {
        assertEquals(getCometManifest(), {
          '/project/comets/counter.tsx': '/assets/counter-hash.js',
        })
        assertEquals(getClientEntryManifest(), {
          '/@zanix/client-entry.ts': '/assets/client-entry-hash.js',
        })
        assertEquals(getCssManifest(), { global: ['/assets/global-hash.css'] })
        assertEquals(getAssetsManifest(), { 'logo.svg': '/assets/logo-hash.svg' })
        assertEquals(getAssetsBuildOutput(), dir)
        assertEquals(getPwaBuildOutput(), dir)
      } finally {
        await deactivateApps(activated)
      }
    } finally {
      setCometManifest(undefined)
      setClientEntryManifest(undefined)
      setCssManifest(undefined)
      setAssetsManifestState(undefined)
      setPwaBuildOutput(undefined)
      await Deno.remove(dir, { recursive: true })
    }
  },
)

/**
 * The real bug this test pins shut: `znx space dev` and a real `zanix space build` commonly point
 * at the same `clientBuildDir` on the same machine — an earlier build's real manifest already
 * sitting on disk is the common case during local development, not a rare one. Confirms the whole
 * auto-load block is skipped entirely under `isDevClientEnabled()`, even with real, valid manifest
 * files genuinely present — never partially loaded, never a stale value some getter still exposes.
 */
Deno.test(
  'defineSpaceApp({ clientBuildDir }) + activateApps: skipped entirely under znx space dev ' +
    '(isDevClientEnabled), even with real manifest files already on disk from an earlier build',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    setDevClientEnabled(true)
    try {
      await Deno.writeTextFile(
        `${dir}/comets-manifest.json`,
        JSON.stringify({ '/project/comets/counter.tsx': '/assets/counter-hash.js' }),
      )

      const app = defineSpaceApp({ name: 'fixture-dev-client-build-dir-app', clientBuildDir: dir })
      const activated = await activateApps([app])
      try {
        assertEquals(getCometManifest(), undefined)
        assertFalse(getAssetsBuildOutput())
        assertFalse(getPwaBuildOutput())
      } finally {
        await deactivateApps(activated)
      }
    } finally {
      setDevClientEnabled(false)
      setCometManifest(undefined)
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'defineSpaceApp: omitting clientBuildDir never loads any manifest — no file is read, at zero ' +
    'cost, same convention as assetsDir/pwa',
  async () => {
    const app = defineSpaceApp({ name: 'fixture-no-client-build-dir-app' })
    const activated = await activateApps([app])
    try {
      assertEquals(getCometManifest(), undefined)
      assertEquals(getClientEntryManifest(), undefined)
      assertEquals(getCssManifest(), undefined)
      assertEquals(getAssetsManifest(), undefined)
      assertFalse(getAssetsBuildOutput())
      assertFalse(getPwaBuildOutput())
    } finally {
      await deactivateApps(activated)
    }
  },
)
