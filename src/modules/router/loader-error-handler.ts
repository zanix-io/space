/**
 * Recovers a thrown `loader` into a real, rendered response — the module both of
 * `SpacePageController`'s own render call sites (`handleGet`, for a `GET`, and
 * `#renderInvalidAction`, re-running `loader` for a failed action's `422` re-render) reach for
 * whenever their own data-resolution/render pipeline throws. One implementation, two call sites —
 * see {@linkcode renderLoaderErrorPage}'s own doc.
 *
 * @module
 */
import { HttpError, serializeError } from '@zanix/errors'
import logger from '@zanix/logger'
import { httpErrorResponse } from '@zanix/server'
import type { ClassConstructor } from '@zanix/server'
import type { PageContext } from 'typings/page.ts'
import { resolveRequestLang } from 'modules/middleware/lang-pre-handler.ts'
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
import { getErrorResponseFormat } from './error-response-format-registry.ts'
import { loadMessages } from '../i18n/load-messages.ts'
import { DEFAULT_IMPLICIT_LANG, getMessagesDir } from '../i18n/messages-registry.ts'

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
 * **Unless `defineSpaceApp({ errorResponse: 'json' })`** — checked in that exact same "no
 * `error.tsx` anywhere" branch, never when the route has its own: `httpErrorResponse(error)`
 * (`@zanix/server`) instead of `DefaultErrorView`, for an app that never wants to serve a rendered
 * HTML page at all. Deliberately NOT `serializeError(error)` directly, unlike `formattedError`
 * below — this body reaches an external caller with no `error.tsx`/app code in between to decide
 * what's safe to show, so it goes through the SAME safe-by-default allowlist (`name`/`message`/
 * `status`/... , never `stack`, `meta`/`cause` only when the error opts in) every other unhandled
 * error in the ecosystem already gets from `@zanix/server`'s own `getPublicErrorResponse`, instead
 * of re-deciding that policy here. See {@linkcode getErrorResponseFormat}'s own doc for the full
 * contract, including why this decision is safe to make right here (nothing has started rendering
 * yet) but is deliberately NOT extended to a render-phase failure with no `error.tsx`.
 *
 * The real HTTP status always survives, only the response BODY changes (from raw JSON to a rendered
 * document): `error.status.value` for an `HttpError` (e.g. `502` for a `RestClient` call that failed
 * upstream), `500` for anything else — a thrown non-`HttpError` is exactly as likely to be a genuine
 * bug as a domain failure, so `500` (a server-side default) is the honest status, never `400`.
 *
 * The real error is always logged before this returns — an `error.tsx` (custom or the built-in
 * default)'s own fallback is the one place this reaches an actual end user (see
 * `zanix-observability-conventions`). It receives the raw, untouched `error` (`ErrorBoundaryProps.error`)
 * and, additively, `formattedError` — `serializeError(error)` (`@zanix/errors`), the same
 * structured, redacted shape `logger.error` and `@zanix/server`'s own HTTP error responses already
 * use, computed once, right here. Never a replacement: this package still never decides on an
 * app's own behalf what's safe to SHOW an end user (the built-in `DefaultErrorView` renders neither
 * field — see its own doc) — `formattedError` is only ever there for an `error.tsx` that opts into
 * reading it.
 *
 * @param Target - This request's own page class — read for its composition chain (`getPageTree`),
 * same cast reasoning `SpacePageController.handleGet` itself already uses.
 * @param pageCtx - This request's own `PageContext` — `url.pathname` to log which route's `loader`
 * failed, `request` to resolve `lang` for a `NOT_FOUND` throw (`resolveRequestLang`), and `params`
 * to thread through to the nearest `error.tsx`'s own `ErrorBoundaryProps` for any other error.
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
    // Unlike `createNotFoundHandler`'s own `onError` path, this request DOES have a matched
    // route — `pageCtx.request` is always the real, original request (no `attachRequestToErrors`
    // gate needed here).
    return renderNotFoundResponse(fragmentOnly, resolveRequestLang(pageCtx.request))
  }

  logger.error(
    `Uncaught error resolving loader data for "${pageCtx.url.pathname}"`,
    error,
  )

  const segments = getPageTree(Target)?.segments ?? []
  const status = error instanceof HttpError ? error.status.value : 500
  let ErrorFallback = findNearestErrorBoundary(segments)
  if (ErrorFallback === undefined) {
    // `defineSpaceApp({ errorResponse: 'json' })` — an app that opted out of ever serving this
    // package's own built-in HTML fallback. Checked ONLY here, never when the route HAS its own
    // `error.tsx` (that's already an explicit choice to render a real page) — see
    // `SpaceAppConfig.errorResponse`'s own doc for the full contract, including why this is safe
    // to decide right here: nothing has been rendered yet for this response.
    if (getErrorResponseFormat() === 'json') {
      return httpErrorResponse(error)
    }
    ErrorFallback = getActiveRenderer() === 'preact'
      ? (await import(DEFAULT_ERROR_VIEW_PREACT_SPECIFIER)).DefaultErrorView
      : (await import(DEFAULT_ERROR_VIEW_REACT_SPECIFIER)).DefaultErrorView
  }

  // `toPageContext` (`space-page-controller.ts`) already defaults `params` to `{}` for a route with
  // no dynamic segments at all — this `?? {}` is defensive redundancy, not the primary fix.
  const params = (pageCtx.params as Record<string, string> | undefined) ?? {}
  // Lazy — only ever resolved once we already know this request's `loader` failed, unlike the
  // render-phase path's eager resolution (`composeSegments`). Free for the overwhelming majority
  // of requests, whose `loader` never throws at all. See `LoaderErrorRenderContext.messages`'s own
  // doc for the full contract.
  const messages = getMessagesDir() !== undefined
    ? await loadMessages({
      lang: params.lang ?? DEFAULT_IMPLICIT_LANG,
      population: pageCtx.population,
    })
    : undefined

  const response = await getLoaderErrorRenderer()({
    ErrorFallback,
    RootLayout: getRootLayout(),
    error,
    // The real error is available right here, synchronously — computed once, not left to each
    // renderer's own render function to redo. See `ErrorBoundaryProps.formattedError`'s own doc
    // for why this is additive, never a replacement for `error` above.
    formattedError: serializeError(error),
    fragmentOnly,
    params,
    messages,
  })
  return new Response(response.body, { status, headers: response.headers })
}
