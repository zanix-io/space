// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
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

/**
 * Regression coverage for a confirmed path-traversal defect in `register-assets.ts`'s
 * `AssetsRoute.serve()`: the build-output lookup used to join `ctx.payload.params.path` — a raw,
 * caller-controlled catch-all value — straight onto `${buildOutputDir}/assets/` with no
 * containment check at all, exactly the same shape `local-filesystem-asset-storage.test.ts` (the
 * Asset API's own sibling module) already documents fixing the same way. Fixed by confining it
 * with `confinePath` (`@zanix/helpers`) before ever touching `Deno.readFile`.
 *
 * `SECRET_OUTSIDE_ASSETS` sits next to (not inside) `buildOutputDir/assets/` — this suite proves
 * no shaped `path` ever serves its content, and every rejected shape still degrades to a plain
 * 404, never a raw 500 (the blocked-traversal case is folded into the exact same fall-through as
 * a genuine miss — see `register-assets.ts`'s own doc for why that matters).
 */

const TMP_ROOT = getTemporaryFolder(import.meta.url)

console.error = () => {}

function View() {
  return <p>ok</p>
}

@Page()
class TraversalGuardPage extends SpacePageController {
  public override component = View
}
void TraversalGuardPage

function fakeImportModule() {
  return () => Promise.resolve({ default: TraversalGuardPage })
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
  name: 'assets traversal guard: no `../`-shaped or encoded-traversal-shaped request ever reads ' +
    'the secret file OUTSIDE buildOutputDir/assets — every one degrades to a plain 404, never ' +
    'a raw error or a successful read',
  fn: async () => {
    const routesDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const assetsDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const buildOutputDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await touch(join(routesDir, 'page.tsx'), 'export default null\n')
      // A real, hashed build-output asset — proves the fix never breaks the legitimate case.
      await touch(join(buildOutputDir, 'assets', 'logo-hash123.svg'), '<svg>hashed</svg>')
      // The secret a traversal attempt would try to reach — a sibling of `assets/`, still inside
      // `buildOutputDir`, and one level further out still (a sibling of `buildOutputDir` itself).
      await touch(join(buildOutputDir, 'secret.txt'), 'buildOutputDir-secret')
      await touch(join(TMP_ROOT, 'secret-outside.txt'), 'root-secret')

      setDevImportModule(fakeImportModule())
      try {
        const app = defineSpaceApp({
          name: 'assets-traversal-guard-e2e',
          routesDir,
          assetsDir,
        })
        await activateApps([app])
        loadAssetsBuildOutput(buildOutputDir)

        const servers = await bootstrapServers({
          ssr: { port: 22008, application: 'assets-traversal-guard-e2e' },
        })
        try {
          const maliciousPaths = [
            // Plain, literal traversal — the WHATWG `URL` parser `@zanix/server` builds `pathname`
            // from resolves dot-segments before routing ever sees it, so this actually 404s at the
            // ROUTING layer (no route matches `/secret.txt`) — still a real, worth-keeping
            // assertion: it must never somehow reach a live file.
            '/assets/../secret.txt',
            '/assets/../../secret-outside.txt',
            '/assets/../../../../../../../../etc/passwd',
            // Percent-encoded dots — decoded and collapsed the same way by `URL`, same outcome.
            '/assets/%2e%2e/secret.txt',
            '/assets/%2e%2e%2f%2e%2e%2fsecret-outside.txt',
            // Percent-encoded SLASH — survives `URL` parsing as a literal, non-decoded segment, so
            // this one genuinely reaches `AssetsRoute.serve()`'s `relativePath` as an opaque
            // string containing a literal `%2f` (never decoded before `confinePath`/`Deno.readFile`
            // see it) — proving that shape is equally harmless, not just the ones already stopped
            // upstream.
            '/assets/..%2Fsecret.txt',
            '/assets/..%2F..%2Fsecret-outside.txt',
          ]

          for (const path of maliciousPaths) {
            // deno-lint-ignore no-await-in-loop -- each check is independent, not a hot path
            const res = await fetch(`http://localhost:22008${path}`)
            // deno-lint-ignore no-await-in-loop
            const body = await res.text()
            assertEquals(res.status, 404, `expected 404 for ${path}, got ${res.status}: ${body}`)
            assert(
              !body.includes('buildOutputDir-secret') && !body.includes('root-secret'),
              `${path} leaked secret content: ${body}`,
            )
          }

          // The legitimate hashed lookup still works — the fix adds containment, not breakage.
          const hashedRes = await fetch('http://localhost:22008/assets/logo-hash123.svg')
          assertEquals(hashedRes.status, 200)
          assertEquals(await hashedRes.text(), '<svg>hashed</svg>')
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
      await Deno.remove(join(TMP_ROOT, 'secret-outside.txt'))
    }
  },
})
