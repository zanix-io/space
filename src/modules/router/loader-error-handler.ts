/**
 * Recovers a thrown `loader` into a real, rendered response — the module both of
 * `SpacePageController`'s own render call sites (`handleGet`, for a `GET`, and
 * `#renderInvalidAction`, re-running `loader` for a failed action's `422` re-render) reach for
 * whenever their own data-resolution/render pipeline throws. One implementation, two call sites —
 * see {@linkcode renderLoaderErrorPage}'s own doc.
 *
 * @module
 */
import { HttpError } from '@zanix/errors'
import logger from '@zanix/logger'
import type { ClassConstructor } from '@zanix/server'
import type { PageContext } from 'typings/page.ts'
import { findNearestErrorBoundary, getPageTree } from './page-tree-registry.ts'
import { getRootLayout } from './app-shell-registry.ts'
import { getActiveRenderer } from './active-renderer.ts'
import { getLoaderErrorRenderer } from './loader-error-renderer-registry.ts'
import { renderNotFoundResponse } from './not-found-handler.ts'
import type { SpacePageController } from './space-page-controller.ts'
import {
  DEFAULT_ERROR_VIEW_PREACT_SPECIFIER,
  DEFAULT_ERROR_VIEW_REACT_SPECIFIER,
} from './default-view-specifiers.ts'

/**
 * Turns a thrown `loader` — a page's own (awaited directly inside `handleGet`, or re-awaited inside
 * `#renderInvalidAction` for a failed action's `422` re-render) or a nested layout segment's own
 * (`segment-loader.ts`'s `resolveSegmentData`, reached from `renderPageResponse` and surfacing
 * through that SAME `await` chain each of those two callers already runs, so one catch per caller
 * covers both its own loader and every segment's) — into a real, rendered response instead of
 * letting it propagate to `@zanix/server`'s own generic JSON `httpErrorResponse`. Both call sites
 * share this exact function; neither has its own copy of the logic below.
 *
 * **`HttpError('NOT_FOUND')` reuses `createNotFoundHandler`'s own lookup/render path verbatim**
 * ({@linkcode renderNotFoundResponse}) — there is only one implementation of "how do we find and
 * render this app's `not-found.tsx`", shared between a genuinely unmatched route and a `loader`
 * that decided its own data doesn't exist.
 *
 * **Any other error renders this route's own nearest `error.tsx`** — {@linkcode
 * findNearestErrorBoundary}'s leaf-to-root lookup, the SAME resolution order `composeSegments`
 * already uses for a render-phase throw (`render-page-react.tsx`/`render-page-preact.ts`) — wrapped
 * directly in the app's root layout, never any intermediate `layout.tsx`: a data-phase throw means
 * this request's segment data never fully resolved at all, so there is no safe `data` prop to hand
 * any of them (see `render-loader-error-react.tsx`'s own doc for the full reasoning).
 *
 * **Falls back to this package's own built-in `DefaultErrorView` when this route declares no
 * `error.tsx` anywhere in its own composition chain** — the loader-error counterpart to
 * `renderNotFoundResponse`'s own built-in `DefaultNotFoundView` fallback (`not-found-handler.ts`):
 * a route that never opted into its own `error.tsx` still gets a real, rendered document, wrapped
 * in the app's root layout with the real HTTP status, never `@zanix/server`'s own generic JSON
 * error response leaking to the client raw. Selected per renderer (`getActiveRenderer`), same
 * lazy-import convention `renderNotFoundResponse` already uses for its own default view — see
 * `default-error-view.tsx`/`default-error-view-preact.ts` for what it renders and why it says
 * nothing about the underlying error itself.
 *
 * The real HTTP status always survives, only the response BODY changes (from raw JSON to a rendered
 * document): `error.status.value` for an `HttpError` (e.g. `502` for a `RestClient` call that failed
 * upstream), `500` for anything else — a thrown non-`HttpError` is exactly as likely to be a genuine
 * bug as a domain failure, so `500` (a server-side default) is the honest status, never `400`.
 *
 * The real error is always logged before this returns — an `error.tsx` (custom or the built-in
 * default)'s own fallback is the one place this reaches an actual end user (see
 * `zanix-observability-conventions`), and it receives only `ErrorBoundaryProps.error`, never
 * anything this framework decided is safe to persist/report on its own behalf.
 *
 * @param Target - This request's own page class — read for its composition chain (`getPageTree`),
 * same cast reasoning `SpacePageController.handleGet` itself already uses.
 * @param pageCtx - This request's own `PageContext` — read only for `url.pathname`, to log which
 * route's `loader` failed.
 * @param fragmentOnly - See `SpacePageController.handleGet`'s own doc on `ORBIT_FRAGMENT_HEADER`.
 * @param error - The value `loader`/`resolveSegmentData` threw — never assumed to be an `Error`
 * instance (a `loader` can throw anything, same as any other function).
 */
export async function renderLoaderErrorPage(
  Target: ClassConstructor<SpacePageController<never>>,
  pageCtx: PageContext<unknown>,
  fragmentOnly: boolean,
  error: unknown,
): Promise<Response> {
  if (error instanceof HttpError && error.status.code === 'NOT_FOUND') {
    return renderNotFoundResponse(fragmentOnly)
  }

  logger.error(
    `Uncaught error resolving loader data for "${pageCtx.url.pathname}"`,
    error,
  )

  const segments = getPageTree(Target)?.segments ?? []
  let ErrorFallback = findNearestErrorBoundary(segments)
  if (ErrorFallback === undefined) {
    ErrorFallback = getActiveRenderer() === 'preact'
      ? (await import(DEFAULT_ERROR_VIEW_PREACT_SPECIFIER)).DefaultErrorView
      : (await import(DEFAULT_ERROR_VIEW_REACT_SPECIFIER)).DefaultErrorView
  }

  const status = error instanceof HttpError ? error.status.value : 500
  const response = await getLoaderErrorRenderer()({
    ErrorFallback,
    RootLayout: getRootLayout(),
    error,
    fragmentOnly,
  })
  return new Response(response.body, { status, headers: response.headers })
}
