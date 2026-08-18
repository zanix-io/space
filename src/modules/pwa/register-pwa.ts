import type { HandlerContext } from '@zanix/server'
import { Get, SsrController, ZanixSsrController } from '@zanix/server'
import type { PwaConfig } from 'typings/pwa.ts'
import { buildWebManifest, iconRoute, MANIFEST_ROUTE, SW_ROUTE } from './web-manifest.ts'
import { DEFAULT_ICON_SIZES, iconFileName, SW_FILE_NAME } from './icon-naming.ts'
import { getPwaBuildOutput } from './pwa-registry.ts'

/**
 * Registers a single fixed-path GET route outside `@zanix/space`'s own file-based page
 * convention — the exact same decorator-application mechanism `Page()`'s `registerPage` already
 * uses internally (`Get(path)(method)` + `SsrController()(Target)`, applied to real TC39 decorator
 * functions as plain calls, never `@`-syntax), generalized to a method named `serve` instead of
 * `handleGet`/`handlePost`. `@zanix/server` has no generic static-file-serving mode at all — every
 * response needs an explicit registered route, which is exactly what this gives `registerPwa`
 * without needing a whole `SpacePageController` (React rendering, layouts, `loader`) for what's
 * really just "return these exact bytes."
 */
function registerFixedRoute(
  path: string,
  handler: (ctx: HandlerContext) => Promise<Response> | Response,
): void {
  class FixedRoute extends ZanixSsrController {
    public async serve(ctx: HandlerContext): Promise<Response> {
      return await handler(ctx)
    }
  }
  Get(path)(FixedRoute.prototype.serve)
  SsrController()(FixedRoute)
}

/** Serves `filePath`'s bytes with `contentType`, once per request (no in-memory cache — see
 * `registerPwa`'s own doc for why). A missing file degrades to a `404`, never a crash. */
function registerFileRoute(
  path: string,
  filePath: string,
  contentType: string,
): void {
  registerFixedRoute(path, async () => {
    try {
      const bytes = await Deno.readFile(filePath)
      return new Response(bytes, { headers: { 'content-type': contentType } })
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return new Response('Not Found', { status: 404 })
      }
      throw error
    }
  })
}

/**
 * Registers this app's PWA routes: {@linkcode MANIFEST_ROUTE} (the Web App Manifest, computed
 * once from `config` and served as-is on every request) always, and — only when
 * `getPwaBuildOutput()` (`pwa-registry.ts`) already has a build output directory registered — one
 * route per configured icon size (`iconRoute`, reading the file `pwaPlugin` wrote under
 * `<buildOutput>/icons/`) and {@linkcode SW_ROUTE} (reading `<buildOutput>/sw.js`).
 *
 * Call from `defineSpaceApp`'s own `setup`, same timing as `loadRoutes()` — route registration
 * only works during app composition, never after it's finished. This reads
 * {@linkcode getPwaBuildOutput} exactly ONCE, right here, to resolve real, static file paths —
 * not per-request — so `loadPwaBuildOutput` (this app's own `main.ts`) MUST already have run by
 * the time `setup()` fires (see that function's own doc for why this ordering is required, and
 * why a lazy per-request path lookup isn't needed once that ordering holds).
 *
 * No build output registered at all (dev, or prod before the first real `zanix space build`) is
 * not an error — icon/service-worker routes are simply never registered; `/manifest.webmanifest`
 * alone still works, since it needs no built file.
 *
 * @throws Nothing of its own — a missing file at request time (a real build/deploy skew) degrades
 * to a `404` `Response` for that one route, never crashes the process.
 */
export function registerPwa(config: PwaConfig): void {
  const manifestBody = JSON.stringify(buildWebManifest(config))
  registerFixedRoute(
    MANIFEST_ROUTE,
    () =>
      new Response(manifestBody, {
        headers: { 'content-type': 'application/manifest+json' },
      }),
  )

  const buildOutput = getPwaBuildOutput()
  if (!buildOutput) return

  const sizes = config.iconSizes ?? DEFAULT_ICON_SIZES
  for (const size of sizes) {
    registerFileRoute(
      iconRoute(size),
      `${buildOutput}/icons/${iconFileName(size)}`,
      'image/png',
    )
  }

  registerFileRoute(
    SW_ROUTE,
    `${buildOutput}/${SW_FILE_NAME}`,
    'application/javascript',
  )
}
