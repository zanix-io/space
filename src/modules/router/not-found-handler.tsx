import { HttpError } from '@zanix/errors'
import { getRequestFromError } from '@zanix/server'
import { renderToResponse } from '../render/render-to-response.tsx'
import { resolveCssHrefs } from '../render/css-manifest.ts'
import { resolvePwaHead } from '../pwa/pwa-registry.ts'
import { isDevClientEnabled } from '../dev/dev-client-registry.ts'
import { applyDocumentShell } from './document-shell.tsx'
import { getNotFoundComponent, getRootLayout } from './app-shell-registry.ts'
import { DefaultNotFoundView } from './default-not-found-view.tsx'
import { ORBIT_FRAGMENT_HEADER, ORBIT_OUTLET_ATTR } from './orbit-protocol.ts'

/** The exact shape Deno's own `Deno.serve()` expects for `ServeOptions.onError` — `@zanix/server`'s
 * `ServerOptions<K>['onError']` inherits this unchanged, so this is what `bootstrapServers`'s own
 * `ssr` option slot requires too. */
export type OnErrorHandler = NonNullable<Deno.ServeOptions['onError']>

/**
 * Builds the `onError` handler `bootstrapServers({ ssr: { onError } })` needs to serve a real,
 * rendered not-found page instead of the generic JSON error response `@zanix/server` falls back to
 * by default.
 *
 * Renders `routesDir`'s own `not-found.tsx`, if `loadRoutes()` found one, or a minimal built-in
 * default otherwise — wrapped in the app's root layout (or the default document shell) exactly like
 * any other page, via {@linkcode applyDocumentShell}.
 *
 * **Orbit-aware, when opted in**: a 404 hit via an Orbit navigation (`ORBIT_FRAGMENT_HEADER`) gets
 * just the outlet fragment, same as any other page's own `fragmentOnly` branch in
 * `SpacePageController.handleGet` — but only when `bootstrapServers({ ssr: { attachRequestToErrors:
 * true } })` is also set. `@zanix/server`'s own `onError` never receives the original `Request` by
 * default (that would mean handing every `onError` a value that can carry `Authorization`/cookies,
 * whether or not the handler actually needs it) — `attachRequestToErrors` is what makes
 * {@linkcode getRequestFromError} return it here instead of `undefined`. Without that flag, this
 * always renders the full document — the same degrade Orbit's own client runtime already falls back
 * to for any non-`ok` fragment response, just resolved on the server instead of after a wasted
 * round-trip.
 *
 * `@zanix/server`'s own `onError` type (inherited from `Deno.ServeOptions`) is declared as always
 * returning a `Response` — but its actual runtime contract (`onErrorListener`, undocumented in the
 * type itself) treats a falsy return as "not handled, fall through to the default response," which
 * is exactly what this needs for any error that isn't a 404. The cast below reflects that real
 * contract, not the type as literally written.
 *
 * @returns A handler to pass directly as `bootstrapServers({ ssr: { onError: createNotFoundHandler() } } })`.
 * Never wired up automatically — `@zanix/space` never calls `bootstrapServers` itself (see this
 * package's own docs on why `Deno.serve()` stays `@zanix/server`'s exclusive responsibility), so an
 * app opts in explicitly, the same way it already passes `application` there.
 *
 * @example
 * ```ts
 * // main.ts
 * import { createNotFoundHandler } from '@zanix/space'
 * import { bootstrapServers } from '@zanix/server'
 *
 * await bootstrapServers({
 *   ssr: {
 *     application: 'storefront',
 *     onError: createNotFoundHandler(),
 *     attachRequestToErrors: true, // opt-in — needed for Orbit-aware 404 fragments, see above
 *   },
 * })
 * ```
 */
export function createNotFoundHandler(): OnErrorHandler {
  const handleNotFound = async (error: unknown): Promise<Response | undefined> => {
    if (!(error instanceof HttpError) || error.status.code !== 'NOT_FOUND') return undefined

    const NotFound = getNotFoundComponent() ?? DefaultNotFoundView
    const request = getRequestFromError(error)
    const fragmentOnly = request?.headers.has(ORBIT_FRAGMENT_HEADER) ?? false

    const outlet = (
      <div style={{ display: 'contents' }} {...{ [ORBIT_OUTLET_ATTR]: '' }}>
        <NotFound />
      </div>
    )
    const element = fragmentOnly ? outlet : applyDocumentShell(getRootLayout(), outlet)
    const response = await renderToResponse(
      element,
      fragmentOnly ? {} : {
        cssHrefs: resolveCssHrefs(),
        pwaHead: resolvePwaHead(),
        // No specific page/route identity for a not-found response — `routeFilePath` omitted
        // on purpose, so the dev client (when enabled) reloads on ANY SSR change, not just one
        // matching a route that doesn't exist here in the first place. See
        // `DevClientScriptOptions.routeFilePath`'s own doc.
        devClient: isDevClientEnabled() ? {} : undefined,
      },
    )

    return new Response(response.body, { status: 404, headers: response.headers })
  }

  return handleNotFound as OnErrorHandler
}
