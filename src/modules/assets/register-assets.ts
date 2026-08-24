import type { HandlerContext } from '@zanix/server'
import { Get, SsrController, ZanixSsrController } from '@zanix/server'
import { ApplicationError } from '@zanix/errors'
import { confinePath } from '@zanix/helpers'
import logger from '@zanix/logger'
import { getAssetPath } from './asset-registry.ts'
import { getAssetsBuildOutput } from './assets-manifest.ts'
import { contentTypeFor } from './content-type.ts'

/**
 * The one route every `assetsDir`-declaring app registers — `@zanix/server`'s own trailing
 * catch-all (`:name*`, see that package's own CHANGELOG for the full contract), which this
 * package's `defineSpaceApp()` composes over an already-resolved `Map` (`scanAssets`/
 * `asset-registry.ts`) instead of Vite's own build-time-only `publicDir` convention: this
 * codebase's dev server never mounts Vite middleware, so a build-time-only mechanism would never
 * work in `znx space dev`, only in production. This ONE
 * route, resolved once at `setup()` time and read per-request, works identically in both.
 */
const ASSETS_ROUTE = '/assets/:path*'

/**
 * Registers {@linkcode ASSETS_ROUTE} — mirrors `register-pwa.ts`'s own `registerFixedRoute`
 * pattern (a plain `ZanixSsrController` subclass, `Get`/`SsrController` applied directly as plain
 * calls rather than `@`-decorator syntax) for the same reason: this is a single utility route
 * outside `@zanix/space`'s own file-based page convention, so it needs no `SpacePageController`
 * machinery (React rendering, layouts, `loader`) — just bytes in, bytes out.
 *
 * **Two independent lookups, tried in order — a hashed request never falls through to a live
 * filesystem scan, and a live/stable request never needs a manifest.** When
 * `loadAssetsBuildOutput()` was called (a real `zanix space build` ran and this app's own `main.ts`
 * loaded its output directory), a request is first checked directly against
 * `${buildOutputDir}/assets/<path>` — the exact same real, hashed bytes `assetsPlugin` wrote during
 * the build. A hit there is served with `Cache-Control: public, max-age=31536000, immutable` and a
 * strong `ETag` derived from the requested path itself (the hash IS the filename — genuinely free,
 * no separate computation), since a hashed filename can only ever mean one exact byte sequence: if
 * the content ever changes, the build produces a NEW hashed filename, never silently reusing the
 * old one. Both `immutable` and a real per-file `ETag` matter here: a hashed filename is safe to
 * cache forever precisely because the content behind it can never change without the filename
 * itself changing, so there is no missed opportunity in declaring that guarantee explicitly
 * instead of relying on a coarser, timestamp-based validator.
 *
 * A miss there (no build output loaded at all — dev, or prod before the first real build; or a
 * `path` the hashed output genuinely doesn't have) falls through to the ORIGINAL, unchanged
 * lookup: `ctx.payload.params.path` (case-preserved, per `@zanix/server`'s own catch-all contract)
 * against {@linkcode getAssetPath}'s live-scanned `Map` — no special caching, since that content
 * could change without its stable URL changing (unlike the hashed path, this one is NOT
 * content-addressed). A `path` that's a key in neither place was never a real, resolved asset —
 * 404s exactly like any other unmatched route, no different handling needed.
 *
 * `relativePath` is `ctx.payload.params.path` — a raw, caller-controlled catch-all value.
 * `@zanix/server`'s own `cleanRoute` only normalizes structure (slashes/case), it never protects
 * against path traversal, so the build-output lookup confines it with `confinePath` (`@zanix/
 * helpers`, the same pattern `local-filesystem-asset-storage.ts` already establishes) before ever
 * touching disk. A blocked traversal attempt is treated exactly like a genuine miss — same
 * fall-through, same eventual 404 — so a caller can never tell the two apart from the response
 * alone; it's only noted server-side via `logger.warn`.
 *
 * Called from `defineSpaceApp()`'s own `setup()` (same timing as `loadRoutes()`/`registerPwa()`),
 * and ONLY when `assetsDir` was actually declared — an app that never opts in never registers
 * this route at all, at zero cost.
 *
 * Returns the registered route class — a test-only escape hatch (same convention `asset-registry.ts`/
 * `assets-manifest.ts` already establish for their own test hooks): the real caller
 * (`define-space-app.ts`) has nothing to do with the return value, so a test can construct an
 * instance directly and call `serve()` with a `mockHandlerContext` (`@zanix/space/testing`)
 * whose `payload.params.path` is set to an arbitrary value, bypassing HTTP/`URL` parsing
 * entirely — the only way to exercise this route's own traversal confinement directly, since a
 * genuine HTTP request can never itself carry an unresolved `../` this far (`@zanix/server`'s own
 * `new URL(req.url).pathname` already resolves every dot segment, including percent-encoded ones,
 * before any route ever matches).
 */
export function registerAssets(): new (ctx: HandlerContext) => ZanixSsrController {
  class AssetsRoute extends ZanixSsrController {
    public async serve(ctx: HandlerContext): Promise<Response> {
      const relativePath = ctx.payload.params.path as string

      const buildOutputDir = getAssetsBuildOutput()
      if (buildOutputDir) {
        try {
          const bytes = await Deno.readFile(confinePath(`${buildOutputDir}/assets`, relativePath))
          return new Response(bytes, {
            headers: {
              'content-type': contentTypeFor(relativePath),
              'cache-control': 'public, max-age=31536000, immutable',
              etag: `"${relativePath}"`,
            },
          })
        } catch (error) {
          const isBlockedTraversal = error instanceof ApplicationError &&
            error.code === 'UTILS_PATHS_TRAVERSAL_BLOCKED'
          if (isBlockedTraversal) {
            // Never surface a distinguishable error for this — an attacker iterating on a blocked
            // traversal attempt must see the exact same outcome as a genuine miss below. Worth
            // noting for an operator, but not an application error: `warn`, not `error`.
            logger.warn('Blocked a path traversal attempt on the assets route', {
              path: relativePath,
            })
          } else if (!(error instanceof Deno.errors.NotFound)) throw error
          // Not a hashed asset (or no build ever produced one at this path), or a blocked
          // traversal attempt — fall through below either way, indistinguishably.
        }
      }

      const absolutePath = getAssetPath(relativePath)
      if (!absolutePath) return new Response('Not Found', { status: 404 })

      try {
        const bytes = await Deno.readFile(absolutePath)
        return new Response(bytes, {
          headers: { 'content-type': contentTypeFor(absolutePath) },
        })
      } catch (error) {
        // A build/deploy skew (resolved at setup() time, missing by the time it's served) — same
        // graceful degradation `register-pwa.ts`'s own `registerFileRoute` already has.
        if (error instanceof Deno.errors.NotFound) {
          return new Response('Not Found', { status: 404 })
        }
        throw error
      }
    }
  }

  Get(ASSETS_ROUTE)(AssetsRoute.prototype.serve)
  SsrController()(AssetsRoute)

  return AssetsRoute
}
