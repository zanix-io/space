/**
 * `@zanix/space/preact` — the Preact-core implementation of `@zanix/space`.
 *
 * **Import this once, from an app's own main module, when `defineSpaceApp({ renderer: 'preact' })`.**
 * Importing it installs Preact's page renderer, not-found renderer and Comet element factory into
 * the core's own registries (`router/renderer-runtime.ts`). It does NOT decide which renderer the
 * project uses — `defineSpaceApp({ renderer })` remains the single answer to that, and it verifies
 * the two agree, failing loudly when a project declares one renderer and imports the other's entry
 * point.
 *
 * Preact CORE, never `preact/compat`. Two capabilities are therefore absent by contract rather
 * than by omission, and both fail loudly rather than silently:
 * `loading.tsx` (rejected by `loadRoutes`) and `useRequestCache` (which does not exist on this entry
 * point at all, because Preact core has no `use()`/`Suspense` to suspend a render with — resolve the
 * data in the page's own `loader` instead). Everything else — routing, layouts, Comets, head/SEO/PWA,
 * i18n, middleware, validation — is renderer-agnostic and lives in `@zanix/space`.
 *
 * @example
 * ```ts
 * // main.ts
 * import '@zanix/space/preact'
 * import { defineSpaceApp } from '@zanix/space'
 *
 * export default defineSpaceApp({ name: 'storefront', renderer: 'preact' })
 * ```
 *
 * @module
 */
import { createElement } from 'preact'
import { installRendererRuntime } from 'modules/router/renderer-runtime.ts'
import type { CometElementFactory } from 'modules/comets/element-factory.ts'
import { renderPageResponse } from 'modules/router/render-page-preact.ts'
import { renderNotFoundResponse } from 'modules/router/render-not-found-preact.ts'

/**
 * Installs Preact's implementations into `@zanix/space`'s own registries. See
 * `@zanix/space/react`'s own `installReactRuntime` for why this is exported and what it does not
 * mean. Called once automatically on import; idempotent.
 */
export function installPreactRuntime(): void {
  installRendererRuntime('preact', {
    renderPage: renderPageResponse,
    renderNotFound: renderNotFoundResponse,
    // See `@zanix/space/react`'s own identical assertion for why this one exists and what it does
    // and does not claim.
    createElement: createElement as CometElementFactory,
  })
}

installPreactRuntime()

export { renderToResponse } from 'modules/render/render-to-response-preact.ts'
export type { RenderToResponsePreactOptions } from 'modules/render/render-to-response-preact.ts'
// `RenderToResponsePreactOptions.devClient`'s own type — same "every type reachable from a public
// export must itself be public" doc-lint rule `@zanix/space`'s own root `mod.ts` already follows.
export type {
  /** Options for `buildDevClientScript`. */
  DevClientScriptOptions,
} from 'modules/dev/dev-client-script.ts'
// `renderToResponse`'s own `element: VNode<any>` parameter references `preact`'s own `VNode` —
// not re-exported here, same accepted `deno doc --lint` finding as `spacePlugin`'s/`cometPlugin`'s
// own `vite`-owned `Plugin`/`PluginOption` (see `bundler/comet-plugin.ts`'s own doc): a third-party
// renderer type this package doesn't own and has no business re-publishing as its own API surface.
