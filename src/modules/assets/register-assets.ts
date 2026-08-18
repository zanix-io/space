import type { HandlerContext } from '@zanix/server'
import { Get, SsrController, ZanixSsrController } from '@zanix/server'
import { getAssetPath } from './asset-registry.ts'
import { getAssetsBuildOutput } from './assets-manifest.ts'
import { contentTypeFor } from './content-type.ts'

/**
 * The one route every `assetsDir`-declaring app registers — `@zanix/server`'s own trailing
 * catch-all (`:name*`, see that package's own CHANGELOG for the full contract), which this
 * package's `defineSpaceApp()` composes over an already-resolved `Map` (`scanAssets`/
 * `asset-registry.ts`) instead of Vite's own build-time-only `publicDir` convention — see the
 * design doc's own §16 for why: this codebase's dev server never mounts Vite middleware, so a
 * build-time-only mechanism would never work in `znx space dev`, only in production. This ONE
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
 * old one. This is a real fix over the legacy server this replaces (`server-core`): confirmed by
 * reading its source, its own static-asset handler set `Cache-Control: max-age=31536000` with
 * NEITHER `immutable` NOR a real per-file `ETag` (only a `Last-Modified` timestamped once at
 * process startup, not per file) — despite its own assets already being content-hashed by that
 * stack's own build tool, the exact same missed opportunity this closes.
 *
 * A miss there (no build output loaded at all — dev, or prod before the first real build; or a
 * `path` the hashed output genuinely doesn't have) falls through to the ORIGINAL, unchanged
 * lookup: `ctx.payload.params.path` (case-preserved, per `@zanix/server`'s own catch-all contract)
 * against {@linkcode getAssetPath}'s live-scanned `Map` — no special caching, since that content
 * could change without its stable URL changing (unlike the hashed path, this one is NOT
 * content-addressed). A `path` that's a key in neither place was never a real, resolved asset —
 * 404s exactly like any other unmatched route, no different handling needed.
 *
 * Called from `defineSpaceApp()`'s own `setup()` (same timing as `loadRoutes()`/`registerPwa()`),
 * and ONLY when `assetsDir` was actually declared — an app that never opts in never registers
 * this route at all, at zero cost.
 */
export function registerAssets(): void {
  class AssetsRoute extends ZanixSsrController {
    public async serve(ctx: HandlerContext): Promise<Response> {
      const relativePath = ctx.payload.params.path as string

      const buildOutputDir = getAssetsBuildOutput()
      if (buildOutputDir) {
        try {
          const bytes = await Deno.readFile(`${buildOutputDir}/assets/${relativePath}`)
          return new Response(bytes, {
            headers: {
              'content-type': contentTypeFor(relativePath),
              'cache-control': 'public, max-age=31536000, immutable',
              etag: `"${relativePath}"`,
            },
          })
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error
          // Not a hashed asset (or no build ever produced one at this path) — fall through below.
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
}
