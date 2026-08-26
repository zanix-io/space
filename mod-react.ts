/**
 * `@zanix/space/react` — the React implementation of `@zanix/space`, plus the APIs that only exist
 * under React.
 *
 * **Import this once, from an app's own main module, when `defineSpaceApp({ renderer: 'react' })`.**
 * Importing it installs React's page renderer, not-found renderer, loader-error renderer and Comet
 * element factory into the core's own registries (`router/renderer-runtime.ts`). It does NOT decide
 * which renderer the project uses — `defineSpaceApp({ renderer })` remains the single answer to
 * that, and it verifies the two agree, failing loudly when a project declares one renderer and
 * imports the other's entry point.
 *
 * **Why this module exists.** `@zanix/space` itself contains no renderer implementation and no path
 * that can load one, so that a `renderer: 'preact'` app never evaluates `react` or
 * `react-dom/server` merely by importing the framework. Everything genuinely React-specific lives
 * here instead: the streaming SSR serializer, and the request-scoped promise cache that exists only
 * because React's `use()`/`Suspense` needs it (Preact core has neither — see `useRequestCache`'s own
 * doc).
 *
 * Everything else — routing, pages, layouts, Comets, head/SEO/PWA, i18n, middleware, validation —
 * is renderer-agnostic and stays in `@zanix/space`.
 *
 * @example
 * ```ts
 * // main.ts
 * import '@zanix/space/react'
 * import { defineSpaceApp } from '@zanix/space'
 *
 * export default defineSpaceApp({ name: 'storefront' }) // renderer: 'react' is the default
 * ```
 *
 * @module
 */
import { createElement } from 'react'
import { installRendererRuntime } from 'modules/router/renderer-runtime.ts'
import type { CometElementFactory } from 'modules/comets/element-factory.ts'
import { renderPageResponse } from 'modules/router/render-page-react.tsx'
import { renderNotFoundResponse } from 'modules/router/render-not-found-react.tsx'
import { renderLoaderErrorResponse } from 'modules/router/render-loader-error-react.tsx'

/**
 * Installs React's implementations into `@zanix/space`'s own registries.
 *
 * Called once automatically, when this module is first imported — an app never needs to call it.
 * It is exported for the one case importing cannot serve: a process that renders with BOTH
 * renderers at different moments (this package's own test suite, and any host booting more than one
 * app), where module-evaluation order is not a usable way to choose. Idempotent.
 *
 * This is installation, not configuration: it says which implementation is loaded, never which
 * renderer a project chose — that stays `defineSpaceApp({ renderer })`, which checks the two agree.
 */
export function installReactRuntime(): void {
  installRendererRuntime('react', {
    renderPage: renderPageResponse,
    renderNotFound: renderNotFoundResponse,
    renderLoaderError: renderLoaderErrorResponse,
    // The same single assertion the Preact entry point makes, for the same reason and in the same
    // shape: `CometElementFactory` is deliberately loose (`unknown` parameters) because no concrete
    // signature describes both renderers' `createElement`, and NEITHER renderer's own overloaded
    // signature is directly assignable to it (confirmed for both). This asserts the call shape, which
    // both really do satisfy; it hides no incompatibility.
    createElement: createElement as CometElementFactory,
  })
}

installReactRuntime()

export { renderToResponse } from 'modules/render/render-to-response.tsx'
export type { RenderToResponseOptions } from 'modules/render/render-to-response.tsx'
// `RenderToResponseOptions.devClient`'s own type — same "every type reachable from a public export
// must itself be public" doc-lint rule `@zanix/space`'s own root `mod.ts` already follows.
export type { DevClientScriptOptions } from 'modules/dev/dev-client-script.ts'
export { RequestCacheProvider, useRequestCache } from 'modules/render/request-cache.tsx'
export type { RequestCache } from 'modules/render/request-cache.tsx'
