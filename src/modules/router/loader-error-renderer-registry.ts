import { InternalError } from '@zanix/errors'

/**
 * Everything a `LoaderErrorRenderer` needs to produce a fallback document for a thrown `loader`,
 * with no renderer-specific type in sight — the same separation `NotFoundRenderContext`
 * (`not-found-renderer-registry.ts`) establishes for a 404, applied to the other document
 * `loader-error-handler.ts` renders on its own (a page's own `loader`, or a nested layout segment's
 * own `loader`, throwing something other than an `HttpError('NOT_FOUND')`).
 *
 * `ErrorFallback`/`RootLayout` are `unknown` for the reason `app-shell-registry.ts` already
 * documents: each holds either a React or a Preact component depending on
 * `defineSpaceApp({ renderer })`, and the two are nominally incompatible types. Each concrete
 * renderer casts them back to its own real type at the point of use.
 */
export type LoaderErrorRenderContext = {
  /** This route's own nearest `error.tsx` default export — `findNearestErrorBoundary`'s own result
   * (`page-tree-registry.ts`), or `loader-error-handler.ts`'s own built-in `DefaultErrorView` when
   * no `error.tsx` exists anywhere in this route's own composition chain. Never `undefined` by the
   * time this context is built (see `loader-error-handler.ts`'s own doc for that fallback). */
  ErrorFallback: unknown
  /** The app's own root `layout.tsx`, if `loadRoutes()` found one. */
  RootLayout: unknown
  /** The value `loader`/`resolveSegmentData` threw — passed through unchanged as
   * `ErrorBoundaryProps.error`, never assumed to be an `Error` instance. */
  error: unknown
  /** `true` for an Orbit navigation whose `loader` threw — returns just the outlet fragment. */
  fragmentOnly: boolean
}

/**
 * Renders a loader-thrown error's fallback response. Both `render-loader-error-react.tsx` and
 * `render-loader-error-preact.ts` export a function of exactly this shape named
 * `renderLoaderErrorResponse`; whichever is registered here is what `loader-error-handler.ts` runs,
 * and that module never imports either by name.
 *
 * The same indirection `page-renderer-registry.ts`/`not-found-renderer-registry.ts` use, and for the
 * same reason: it is what makes a data-phase throw's own recovery path renderer-agnostic, exactly
 * like every other document this package renders on its own.
 */
export type LoaderErrorRenderer = (context: LoaderErrorRenderContext) => Promise<Response>

// No default, for the reason `page-renderer-registry.ts` states in full: `@zanix/space` ships no
// renderer implementation at all, so neither registry may name one. Installed from
// `@zanix/space/react` or `@zanix/space/preact` via `installRendererRuntime`.
let loaderErrorRenderer: LoaderErrorRenderer | undefined

/**
 * Switches the active `LoaderErrorRenderer` — called by `installRendererRuntime` when a renderer
 * entry point is imported, alongside the page renderer, the not-found renderer and the Comet element
 * factory. Never called by an app directly.
 */
export function setLoaderErrorRenderer(renderLoaderError: LoaderErrorRenderer): void {
  loaderErrorRenderer = renderLoaderError
}

/**
 * Read by `loader-error-handler.ts` — see {@linkcode LoaderErrorRenderer}'s own doc.
 *
 * @throws {InternalError} When no renderer entry point has been imported — the same single fix as
 * `getPageRenderer`'s/`getNotFoundRenderer`'s own, and deliberately no fallback.
 */
export function getLoaderErrorRenderer(): LoaderErrorRenderer {
  if (!loaderErrorRenderer) {
    throw new InternalError(
      'No renderer is installed, so a loader-error document cannot be rendered: `@zanix/space` ' +
        "itself contains no renderer implementation, by design. Import this project's own " +
        "renderer entry point once, from its main module — `import '@zanix/space/react'` or " +
        "`import '@zanix/space/preact'`, matching `defineSpaceApp({ renderer })`.",
    )
  }
  return loaderErrorRenderer
}
