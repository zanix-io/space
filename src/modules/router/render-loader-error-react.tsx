import type { ComponentType, ReactNode } from 'react'
import type { ErrorBoundaryProps, LayoutProps } from 'typings/page.ts'
import { renderToResponse } from '../render/render-to-response.tsx'
import { resolveCssHrefs } from '../render/css-manifest.ts'
import { resolvePwaHead } from '../pwa/pwa-registry.ts'
import { isDevClientEnabled } from '../dev/dev-client-registry.ts'
import { applyDocumentShell } from './document-shell.tsx'
import { ORBIT_OUTLET_ATTR } from './orbit-protocol.ts'
import { resolveHead } from './head-descriptor.ts'
import type { DocumentModel } from '../render/document-model.ts'
import type { LoaderErrorRenderContext } from './loader-error-renderer-registry.ts'

/**
 * Renders a loader-thrown error's fallback response through React — the default
 * `LoaderErrorRenderer` (`loader-error-renderer-registry.ts`).
 *
 * **An ordinary document, exactly like `render-not-found-react.tsx`'s own not-found page.** The
 * route's own nearest `error.tsx` (`ErrorFallback`) is wrapped directly in the app's root layout (or
 * the default shell) — never any intermediate `layout.tsx` between it and the root, since this is
 * only ever reached from a data-phase throw (`loader-error-handler.ts`): this request's own segment
 * data never fully resolved, so there is no safe `data` prop to hand any of them. `error.tsx`
 * declares no `head` export of its own, so this document carries none beyond the app's own PWA/CSS
 * contribution — unlike the not-found page, which resolves one from `not-found.tsx`.
 *
 * @module
 */
export function renderLoaderErrorResponse(
  context: LoaderErrorRenderContext,
): Promise<Response> {
  const { ErrorFallback, RootLayout, error, fragmentOnly } = context

  const Fallback = ErrorFallback as ComponentType<ErrorBoundaryProps>
  // `reset` is a no-op here, deliberately: this response is a fresh server render, not a client-side
  // retry — the same `ErrorBoundaryProps` contract `SpaceErrorBoundary` already uses, just with
  // nothing (yet) for `reset` to meaningfully clear on the server.
  const outlet = (
    <div style={{ display: 'contents' }} {...{ [ORBIT_OUTLET_ATTR]: '' }}>
      <Fallback error={error} reset={() => {}} />
    </div>
  )

  if (fragmentOnly) {
    // Same shape a page's own Orbit fragment takes (`render-page-react.tsx`) — no `<title>` here,
    // since `error.tsx` contributes no head of its own.
    return renderToResponse(outlet, {})
  }

  const document: DocumentModel = {
    head: resolveHead([]),
    cssHrefs: resolveCssHrefs() ?? [],
    pwa: resolvePwaHead(),
    devClient: isDevClientEnabled() ? {} : undefined,
  }

  return renderToResponse(
    applyDocumentShell(RootLayout as ComponentType<LayoutProps<ReactNode>> | undefined, outlet),
    {
      cssHrefs: document.cssHrefs,
      pwaHead: document.pwa,
      devClient: document.devClient,
    },
  )
}
