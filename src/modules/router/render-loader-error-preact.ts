import { createElement } from 'preact'
import type { ComponentChildren, ComponentType } from 'preact'
import type { ErrorBoundaryProps, LayoutProps } from 'typings/page.ts'
import { renderToResponse } from '../render/render-to-response-preact.ts'
import { resolveCssHrefs } from '../render/css-manifest.ts'
import { resolvePwaHead } from '../pwa/pwa-registry.ts'
import { isDevClientEnabled } from '../dev/dev-client-registry.ts'
import { applyDocumentShell } from './document-shell-preact.ts'
import { serializeHeadMarkup } from '../render/head-markup.ts'
import { ORBIT_OUTLET_ATTR } from './orbit-protocol.ts'
import { resolveHead } from './head-descriptor.ts'
import type { DocumentModel } from '../render/document-model.ts'
import type { LoaderErrorRenderContext } from './loader-error-renderer-registry.ts'

/**
 * Renders a loader-thrown error's fallback response through Preact — the Preact counterpart to
 * `render-loader-error-react.tsx`, registered by `defineSpaceApp({ renderer: 'preact' })`.
 *
 * Structurally identical to React's counterpart, and deliberately so: same `resolveHead` (an empty
 * one — `error.tsx` declares no `head` of its own), same `DocumentModel`, same `applyDocumentShell`
 * decision, the route's own nearest `error.tsx` wrapped directly in the root layout with no
 * intermediate `layout.tsx` between them (see that file's own doc for why). The only divergence is
 * the one that exists everywhere in this package — React hoists head elements out of the tree,
 * Preact serializes the resolved head into `<head>` after rendering (`render/head-markup.ts`).
 *
 * @module
 */
export function renderLoaderErrorResponse(
  context: LoaderErrorRenderContext,
): Promise<Response> {
  const { ErrorFallback, RootLayout, error, fragmentOnly } = context

  const Fallback = ErrorFallback as ComponentType<ErrorBoundaryProps>
  // Same no-op `reset` reasoning as React's own counterpart — a fresh server render, not a
  // client-side retry.
  // `display: contents` comes from `builtin-css.ts`'s own stylesheet rule, targeting this same
  // `ORBIT_OUTLET_ATTR` selector — never an inline `style` prop here (a strict `style-src` with
  // no `'unsafe-inline'` silently drops those).
  const outlet = createElement(
    'div',
    { [ORBIT_OUTLET_ATTR]: '' },
    createElement(Fallback, { error, reset: () => {} }),
  )

  if (fragmentOnly) {
    // Same shape a page's own Orbit fragment takes (`render-page-preact.ts`) — no `<title>` here,
    // since `error.tsx` contributes no head of its own.
    return Promise.resolve(renderToResponse(outlet, {}))
  }

  const document: DocumentModel = {
    head: resolveHead([]),
    cssHrefs: resolveCssHrefs() ?? [],
    pwa: resolvePwaHead(),
    devClient: isDevClientEnabled() ? {} : undefined,
  }

  return Promise.resolve(
    renderToResponse(
      applyDocumentShell(
        RootLayout as ComponentType<LayoutProps<ComponentChildren>> | undefined,
        outlet,
        {},
      ),
      {
        doctype: true,
        devClient: document.devClient,
        headMarkup: serializeHeadMarkup(document),
        serviceWorkerHref: document.pwa?.serviceWorkerHref,
      },
    ),
  )
}
