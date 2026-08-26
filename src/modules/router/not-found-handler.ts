import { HttpError } from '@zanix/errors'
import { getRequestFromError } from '@zanix/server'
import { getActiveRenderer } from './active-renderer.ts'
import { getNotFoundComponent, getNotFoundHead, getRootLayout } from './app-shell-registry.ts'
import { DEFAULT_NOT_FOUND_HEAD, getNotFoundRenderer } from './not-found-renderer-registry.ts'
import { ORBIT_FRAGMENT_HEADER } from './orbit-protocol.ts'
import {
  DEFAULT_NOT_FOUND_VIEW_PREACT_SPECIFIER,
  DEFAULT_NOT_FOUND_VIEW_REACT_SPECIFIER,
} from './default-view-specifiers.ts'

// Renderer-agnostic. This file used to import React's own `renderToResponse`/`applyDocumentShell`
// directly and throw outright under `--renderer=preact`, which meant a Preact app had no not-found
// page at all — it fell through to `@zanix/server`'s own JSON error response, and only discovered
// that on the first real 404 in production. It now resolves the not-found component, the root
// layout and the head, and hands all three to whichever `NotFoundRenderer` is registered
// (`not-found-renderer-registry.ts`) — the same indirection `page-renderer-registry.ts` already
// uses for pages, and the reason no renderer-specific type appears in this file any more.
//
// A 404 is an ordinary document, built from an ordinary `DocumentModel`. Nothing about its
// `<title>` or its headings is special-cased here or anywhere else in this package: the head comes
// from the app's own `not-found.tsx` `head` export when it declares one, and from
// `DEFAULT_NOT_FOUND_HEAD` when it does not, resolved through the same `resolveHead` every page
// uses.

/** The exact shape Deno's own `Deno.serve()` expects for `ServeOptions.onError` — `@zanix/server`'s
 * `ServerOptions<K>['onError']` inherits this unchanged, so this is what `bootstrapServers`'s own
 * `ssr` option slot requires too. */
export type OnErrorHandler = NonNullable<Deno.ServeOptions['onError']>

/**
 * Renders this app's own not-found document — the app's `not-found.tsx` (if `loadRoutes()` found
 * one) or this package's built-in fallback view, wrapped in the root layout, with a real `404`
 * status. The one real implementation of "how do we find and render this app's `not-found.tsx`" —
 * `createNotFoundHandler` (below) calls this after extracting `fragmentOnly` from the original
 * unmatched request; `loader-error-handler.ts`'s own recovery path calls it directly with the
 * `fragmentOnly` it already has, for an `HttpError('NOT_FOUND')` thrown by a page's own `loader` or
 * a nested layout segment's own `loader` — so there is only ever one lookup/render path for a 404
 * document, never two independently-maintained ones.
 *
 * @param fragmentOnly - `true` renders just the outlet fragment (an Orbit navigation) — see
 * {@linkcode createNotFoundHandler}'s own doc for the full Orbit-aware contract.
 */
export async function renderNotFoundResponse(fragmentOnly: boolean): Promise<Response> {
  // Resolved here, renderer-agnostically, and handed to whichever renderer is active. The
  // built-in fallback view is selected per renderer for the same reason every other component in
  // this package is: a React component and a Preact one are not interchangeable values.
  let NotFound = getNotFoundComponent()
  if (NotFound === undefined) {
    NotFound = getActiveRenderer() === 'preact'
      ? (await import(DEFAULT_NOT_FOUND_VIEW_PREACT_SPECIFIER)).DefaultNotFoundView
      : (await import(DEFAULT_NOT_FOUND_VIEW_REACT_SPECIFIER)).DefaultNotFoundView
  }

  const response = await getNotFoundRenderer()({
    NotFound,
    RootLayout: getRootLayout(),
    // The app's own `not-found.tsx` `head` export when it declares one, this package's default
    // otherwise — resolved through the same `resolveHead` a page's head goes through, with no
    // not-found-specific mechanism anywhere.
    head: getNotFoundHead() ?? DEFAULT_NOT_FOUND_HEAD,
    fragmentOnly,
  })

  const headers = new Headers(response.headers)
  // Same reasoning as `SpacePageController.handleGet`'s own unconditional `Vary` — this
  // response's body shape depends on `ORBIT_FRAGMENT_HEADER` (full document vs. bare outlet
  // fragment) whenever `attachRequestToErrors` is on, so a shared HTTP cache must be told, not
  // just Orbit's own client runtime (which never relies on caching to get this right).
  headers.set('vary', ORBIT_FRAGMENT_HEADER)

  return new Response(response.body, {
    status: 404,
    headers,
  })
}

/**
 * Builds the `onError` handler `bootstrapServers({ ssr: { onError } })` needs to serve a real,
 * rendered not-found page instead of the generic JSON error response `@zanix/server` falls back to
 * by default.
 *
 * Renders `routesDir`'s own `not-found.tsx`, if `loadRoutes()` found one, or a minimal built-in
 * default otherwise — wrapped in the app's root layout (or the default document shell) exactly like
 * any other page, via {@linkcode renderNotFoundResponse}.
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
  const handleNotFound = (
    error: unknown,
  ): Promise<Response | undefined> => {
    if (!(error instanceof HttpError) || error.status.code !== 'NOT_FOUND') {
      return Promise.resolve(undefined)
    }

    const request = getRequestFromError(error)
    const fragmentOnly = request?.headers.has(ORBIT_FRAGMENT_HEADER) ?? false

    return renderNotFoundResponse(fragmentOnly)
  }

  return handleNotFound as OnErrorHandler
}
