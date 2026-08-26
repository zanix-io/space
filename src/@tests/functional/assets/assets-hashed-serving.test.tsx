// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assertEquals } from '@std/assert'
import { dirname, join } from '@std/path'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { activateApps } from '@zanix/app/runtime'
import { getTemporaryFolder } from '@zanix/helpers'
import { defineSpaceApp } from 'modules/runtime/mod.ts'
import { Page, SpacePageController } from 'modules/router/mod.ts'
import { setDevImportModule } from 'modules/dev/dev-engine-registry.ts'
import { resetResolvedAssets } from 'modules/assets/asset-registry.ts'
import { loadAssetsBuildOutput, setAssetsManifestState } from 'modules/assets/assets-manifest.ts'
import { ZANIX_APP_RUNTIME_SERVER_SKEW_BLOCKED } from '../../support/zanix-app-runtime-server-skew.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

console.error = () => {}

function View() {
  return <p>ok</p>
}

@Page()
class HashedAssetsPage extends SpacePageController {
  public override component = View
}
void HashedAssetsPage

function fakeImportModule() {
  return () => Promise.resolve({ default: HashedAssetsPage })
}

async function touch(path: string, content: string): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true })
  await Deno.writeTextFile(path, content)
}

async function cleanup(...dirs: string[]): Promise<void> {
  await Promise.all(dirs.map((dir) => Deno.remove(dir, { recursive: true })))
}

Deno.test({
  ignore: ZANIX_APP_RUNTIME_SERVER_SKEW_BLOCKED,
  name: 'assets hashed serving end to end: a request matching the loaded build output gets ' +
    'Cache-Control: immutable + a real ETag; a request only the LIVE source has still falls ' +
    'through to the original, unhashed behavior with no special caching',
  fn: async () => {
    const routesDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const assetsDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const buildOutputDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await touch(join(routesDir, 'page.tsx'), 'export default null\n')
      // The live SOURCE directory `assetsDir` scans — used for the unhashed fallback case.
      await touch(join(assetsDir, 'live-only.svg'), '<svg>live-only</svg>')
      // The BUILD OUTPUT directory — what a real `zanix space build` + `assetsPlugin` would have
      // written; `logo-hash123.svg` stands in for a real Rollup-hashed filename.
      await touch(join(buildOutputDir, 'assets', 'logo-hash123.svg'), '<svg>hashed</svg>')

      setDevImportModule(fakeImportModule())
      try {
        const app = defineSpaceApp({
          name: 'assets-hashed-e2e',
          routesDir,
          assetsDir,
        })
        await activateApps([app])
        // Stands in for the app's own `main.ts` calling `loadAssetsBuildOutput()` before
        // `activateApps()`/`bootstrapServers()` — done here, after, only because this test also
        // needs `registerAssets()` (triggered by `activateApps()` above) to have already run; the
        // ORDER relative to real requests below is what matters, and it's identical either way.
        loadAssetsBuildOutput(buildOutputDir)

        const servers = await bootstrapServers({
          ssr: { port: 22007, application: 'assets-hashed-e2e' },
        })
        try {
          // A hashed request — served from the build output, immutable-cached, real ETag.
          const hashedRes = await fetch('http://localhost:22007/assets/logo-hash123.svg')
          assertEquals(hashedRes.status, 200)
          assertEquals(await hashedRes.text(), '<svg>hashed</svg>')
          assertEquals(
            hashedRes.headers.get('cache-control'),
            'public, max-age=31536000, immutable',
          )
          assertEquals(hashedRes.headers.get('etag'), '"logo-hash123.svg"')

          // A request the build output does NOT have, but the live source does — falls through to
          // the original, unhashed behavior: served, no special cache headers at all.
          const liveRes = await fetch('http://localhost:22007/assets/live-only.svg')
          assertEquals(liveRes.status, 200)
          assertEquals(await liveRes.text(), '<svg>live-only</svg>')
          assertEquals(liveRes.headers.get('cache-control'), null)
          assertEquals(liveRes.headers.get('etag'), null)

          // A request in NEITHER place still 404s exactly as before.
          const missingRes = await fetch('http://localhost:22007/assets/nowhere.svg')
          assertEquals(missingRes.status, 404)
        } finally {
          await webServerManager.stop(servers)
        }
      } finally {
        setDevImportModule(undefined)
        resetResolvedAssets()
        setAssetsManifestState(undefined)
      }
    } finally {
      await cleanup(routesDir, assetsDir, buildOutputDir)
    }
  },
})
