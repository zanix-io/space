import type { HandlerContext } from '@zanix/server'
import { Get, SsrController, ZanixSsrController } from '@zanix/server'
import { InternalError } from '@zanix/errors'
import { resolve } from '@std/path'
import type { PwaConfig } from 'typings/pwa.ts'
import { buildServiceWorkerSource } from '../bundler/service-worker-source.ts'
import { buildWebManifest, iconRoute, MANIFEST_ROUTE, SW_ROUTE } from './web-manifest.ts'
import { DEFAULT_ICON_SIZES, iconFileName, SW_FILE_NAME } from './icon-naming.ts'
import { requestsServiceWorkerLogic, resolvePwaPush } from './push-config.ts'
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

/** The response for a PWA file that could not be read: a missing file degrades to a `404`, never
 * a crash. Any other failure is thrown wrapped. */
function readFailureResponse(path: string, filePath: string, error: unknown): Response {
  if (error instanceof Deno.errors.NotFound) {
    return new Response('Not Found', { status: 404 })
  }
  // A native `Deno.errors.*` besides `NotFound` (permission denied, disk failure, ...) must
  // never cross this live route handler unwrapped: its raw `.message` routinely embeds the
  // real, absolute `filePath` on disk — `@zanix/server`'s own `getPublicErrorResponse`
  // allowlists `message` by default, so an unwrapped native error reaching this route would
  // hand that path straight to the client. The real error detail still reaches the log via
  // `cause`.
  throw new InternalError(`Failed to read a PWA file for route "${path}" from disk.`, {
    code: 'SPACE_PWA_FILE_READ_FAILED',
    meta: { source: 'zanix', path, filePath },
    cause: error,
  })
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
      return readFailureResponse(path, filePath, error)
    }
  })
}

/**
 * Serves a service worker generated on each request, for an app that has no client build output but
 * asks for Web Push or a script of its own. It has no precache and no `fetch` handler
 * (`caching: false`), and carries `cache-control: no-cache`: a worker that cached would hide an
 * edit from the developer who just made it. `serviceWorkerScript` is read on each request, so an
 * edit to it reaches the next page load, resolved against the process's working directory like
 * every other runtime path in the app's configuration. No generated icons exist without a build,
 * so a notification uses the browser's default icon.
 */
function registerRuntimeServiceWorkerRoute(config: PwaConfig): void {
  registerFixedRoute(SW_ROUTE, async () => {
    const scriptPath = config.serviceWorkerScript
      ? resolve(Deno.cwd(), config.serviceWorkerScript)
      : undefined
    try {
      const source = buildServiceWorkerSource({
        precacheUrls: [],
        offlineFallback: null,
        caching: false,
        push: resolvePwaPush(config),
        extraScript: scriptPath ? await Deno.readTextFile(scriptPath) : undefined,
      })
      return new Response(source, {
        headers: { 'content-type': 'application/javascript', 'cache-control': 'no-cache' },
      })
    } catch (error) {
      return readFailureResponse(SW_ROUTE, scriptPath ?? SW_ROUTE, error)
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
 * not an error — icon routes are never registered and `/manifest.webmanifest` alone still works,
 * since it needs no built file. The service-worker route is registered only when `config` asks for
 * `push` or a `serviceWorkerScript`: it then serves a worker generated on each request, with the
 * same handlers the built one has and no caching, so those features behave the same with or
 * without a build.
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
  if (!buildOutput) {
    if (requestsServiceWorkerLogic(config)) registerRuntimeServiceWorkerRoute(config)
    return
  }

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
