import type { ComponentType, ReactNode } from 'react'
import type { LayoutProps } from 'typings/page.ts'
import { renderToResponse } from '../render/render-to-response.tsx'
import { resolveCssHrefs } from '../render/css-manifest.ts'
import { resolvePwaHead } from '../pwa/pwa-registry.ts'
import { isDevClientEnabled } from '../dev/dev-client-registry.ts'
import { applyDocumentShell } from './document-shell.tsx'
import { ORBIT_OUTLET_ATTR } from './orbit-protocol.ts'
import { resolveHead } from './head-descriptor.ts'
import type { DocumentModel } from '../render/document-model.ts'
import type { NotFoundRenderContext } from './not-found-renderer-registry.ts'

/**
 * Renders a not-found response through React — the default `NotFoundRenderer`
 * (`not-found-renderer-registry.ts`).
 *
 * **A 404 is an ordinary document here, not a special case.** It builds a {@linkcode DocumentModel}
 * exactly like a page does (`render-page-react.tsx`), from the same `resolveHead`, the same
 * `resolveCssHrefs`/`resolvePwaHead`, and hands it to the same `renderToResponse`. Nothing about
 * `<title>` or `<h1>` is treated specially for this route: whatever head the app declared for its
 * not-found document flows through the normal resolution, and if it declared none the built-in
 * default supplies one the same way any other document's would.
 *
 * @module
 */
export function renderNotFoundResponse(
  context: NotFoundRenderContext,
): Promise<Response> {
  const { NotFound, RootLayout, head, fragmentOnly } = context

  const View = NotFound as ComponentType
  const outlet = (
    <div style={{ display: 'contents' }} {...{ [ORBIT_OUTLET_ATTR]: '' }}>
      <View />
    </div>
  )

  const resolvedHead = resolveHead([head])

  if (fragmentOnly) {
    // Same shape a page's own Orbit fragment takes (`render-page-react.tsx`): the resolved title as
    // literal text for `orbit.ts`'s own `extractFragmentTitle`, and nothing else — a fragment is
    // never a document.
    return renderToResponse(
      <>
        {resolvedHead.title && <title>{resolvedHead.title}</title>}
        {outlet}
      </>,
      {},
    )
  }

  const document: DocumentModel = {
    head: resolvedHead,
    cssHrefs: resolveCssHrefs() ?? [],
    pwa: resolvePwaHead(),
    devClient: isDevClientEnabled() ? {} : undefined,
  }

  return renderToResponse(
    applyDocumentShell(RootLayout as ComponentType<LayoutProps<ReactNode>> | undefined, outlet),
    {
      cssHrefs: document.cssHrefs,
      pwaHead: document.pwa,
      title: document.head.title,
      meta: document.head.meta,
      link: document.head.link,
      devClient: document.devClient,
    },
  )
}
