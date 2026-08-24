import { assert, assertEquals, assertRejects } from '@std/assert'
import { dirname, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { mockHandlerContext } from 'modules/testing/mock-handler-context.ts'
import { registerAssets } from 'modules/assets/register-assets.ts'
import { resetResolvedAssets, setResolvedAssets } from 'modules/assets/asset-registry.ts'
import { loadAssetsBuildOutput, setAssetsManifestState } from 'modules/assets/assets-manifest.ts'

/**
 * Regression coverage for a confirmed path-traversal vulnerability: the build-output lookup used
 * to join `ctx.payload.params.path` — a raw, caller-controlled catch-all value — straight onto
 * `${buildOutputDir}/assets/` with no containment check, exactly the same shape
 * `local-filesystem-asset-storage.test.ts` (the Asset API's own sibling module) already documents
 * fixing the same way. Fixed via `confinePath` (`@zanix/helpers`).
 *
 * This suite calls the registered route's `serve()` DIRECTLY, via a `mockHandlerContext` whose
 * `payload.params.path` is set by hand, rather than driving it through a real HTTP request —
 * deliberately: `@zanix/server`'s own routing already resolves every dot segment (including
 * percent-encoded ones) in `url.pathname` before any route ever matches, so a genuine HTTP request
 * structurally cannot deliver an unresolved `../` this far in the first place. Testing at the
 * `serve()` level exercises the confinement itself directly — the defense this route owns
 * regardless of what any particular transport/caller happens to guarantee upstream, the same
 * defense-in-depth reasoning `confinePath`'s own doc and `local-filesystem-asset-storage.ts`'s
 * usage of it already establish.
 *
 * `registerAssets()` is called exactly ONCE for the whole file, at module scope: it registers a
 * real, fixed route path (`/assets/:path*`) against `@zanix/server`'s own process-wide
 * `RouteContainer` under the default `"main"` application — a second call in the same file (worker
 * realm) collides with `InternalError: Route path "ssr=>/assets/:path*" is already defined`. Every
 * `Deno.test` below shares this one registered class and only varies the module-level
 * build-output/live-scan state around it, cleaning that up in its own `finally`.
 */

const TMP_ROOT = getTemporaryFolder(import.meta.url)
const AssetsRoute = registerAssets()

async function touch(path: string, content: string): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true })
  await Deno.writeTextFile(path, content)
}

Deno.test(
  'registerAssets: serve() blocks a traversal-shaped path against the build-output lookup — ' +
    'falls through to a plain 404, never leaks the sibling secret, never throws raw',
  async () => {
    const buildOutputDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await touch(join(buildOutputDir, 'assets', 'real.svg'), '<svg>real</svg>')
      // Sits OUTSIDE `buildOutputDir/assets` — what a successful traversal would have to reach.
      await touch(join(buildOutputDir, 'secret.txt'), 'buildOutputDir-secret')

      loadAssetsBuildOutput(buildOutputDir)

      const traversingPaths = [
        '../secret.txt',
        '../../secret.txt',
        'a/../../secret.txt',
        '/etc/passwd', // an absolute `path` — confinePath rejects this the same way as `../`.
      ]

      for (const path of traversingPaths) {
        const ctx = mockHandlerContext({
          payload: { params: { path }, search: {}, body: undefined },
        })
        const controller = new AssetsRoute(ctx)
        // deno-lint-ignore no-await-in-loop -- each check is independent, not a hot path
        const res = await controller.serve(ctx)
        // deno-lint-ignore no-await-in-loop
        const body = await res.text()
        assertEquals(res.status, 404, `expected 404 for path=${path}, got ${res.status}: ${body}`)
        assert(!body.includes('buildOutputDir-secret'), `path=${path} leaked the secret: ${body}`)
      }

      // The fix adds containment, not breakage — a real build-output asset still resolves fine.
      const okCtx = mockHandlerContext({
        payload: { params: { path: 'real.svg' }, search: {}, body: undefined },
      })
      const okController = new AssetsRoute(okCtx)
      const okRes = await okController.serve(okCtx)
      assertEquals(okRes.status, 200)
      assertEquals(await okRes.text(), '<svg>real</svg>')
    } finally {
      resetResolvedAssets()
      setAssetsManifestState(undefined)
      await Deno.remove(buildOutputDir, { recursive: true })
    }
  },
)

/**
 * Regression coverage for the build-output lookup's OTHER catch branch: an error that is neither
 * a blocked traversal nor a plain miss must still surface as a real error, never be silently
 * swallowed into a 404 alongside the two deliberately-quiet cases above. Forced with a real,
 * unmocked `Deno.readFile` failure (`EISDIR`, not `NotFound`) by pointing the resolved path at a
 * directory instead of a file — no stubbing of `Deno`'s own primitives needed.
 */
Deno.test(
  'registerAssets: serve() rethrows a build-output read failure that is neither a blocked ' +
    'traversal nor a genuine miss (e.g. EISDIR) — never silently degrades to a 404',
  async () => {
    const buildOutputDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      // A directory where a file is expected — `Deno.readFile` rejects with `Deno.errors.IsADirectory`,
      // never `NotFound` and never the traversal-blocked `ApplicationError`.
      await Deno.mkdir(join(buildOutputDir, 'assets', 'not-a-file'), { recursive: true })

      loadAssetsBuildOutput(buildOutputDir)

      const ctx = mockHandlerContext({
        payload: { params: { path: 'not-a-file' }, search: {}, body: undefined },
      })
      const controller = new AssetsRoute(ctx)
      await assertRejects(() => controller.serve(ctx))
    } finally {
      resetResolvedAssets()
      setAssetsManifestState(undefined)
      await Deno.remove(buildOutputDir, { recursive: true })
    }
  },
)

/**
 * Regression coverage for the LIVE-scanned (`getAssetPath`) lookup's own catch block — the
 * "build/deploy skew" graceful degradation this route's own doc describes: a path resolved at
 * `setup()` time (real, in the `resolvedAssets` map) that no longer exists on disk by the time a
 * request actually arrives degrades to a plain 404, same as a genuine miss; any OTHER read failure
 * (e.g. EISDIR) still rethrows rather than being swallowed. Reached only via `setResolvedAssets`
 * directly — this lookup is the ORIGINAL, pre-`buildOutputDir` path, so no `loadAssetsBuildOutput`
 * call here at all (falling through to it requires no build output loaded, matching real
 * dev/pre-first-build behavior).
 */
Deno.test(
  'registerAssets: serve() falls through to the live-scanned map when no build output is ' +
    'loaded — a real hit still serves its bytes, a since-removed file degrades to 404, any ' +
    'other read failure still rethrows',
  async () => {
    const liveDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      const realFile = join(liveDir, 'real.svg')
      const goneFile = join(liveDir, 'gone.svg')
      const dirAsFile = join(liveDir, 'a-directory')
      await touch(realFile, '<svg>live-scanned</svg>')
      await Deno.mkdir(dirAsFile, { recursive: true })

      setResolvedAssets(
        new Map([
          ['real.svg', realFile],
          ['gone.svg', goneFile],
          ['a-directory', dirAsFile],
        ]),
      )

      // The plain success path — a real hit still serves its real bytes, unchanged behavior.
      const realCtx = mockHandlerContext({
        payload: { params: { path: 'real.svg' }, search: {}, body: undefined },
      })
      const realRes = await new AssetsRoute(realCtx).serve(realCtx)
      assertEquals(realRes.status, 200)
      assertEquals(await realRes.text(), '<svg>live-scanned</svg>')

      const missingCtx = mockHandlerContext({
        payload: { params: { path: 'gone.svg' }, search: {}, body: undefined },
      })
      const missingRes = await new AssetsRoute(missingCtx).serve(missingCtx)
      assertEquals(missingRes.status, 404)

      const directoryCtx = mockHandlerContext({
        payload: { params: { path: 'a-directory' }, search: {}, body: undefined },
      })
      await assertRejects(() => new AssetsRoute(directoryCtx).serve(directoryCtx))
    } finally {
      resetResolvedAssets()
      await Deno.remove(liveDir, { recursive: true })
    }
  },
)
