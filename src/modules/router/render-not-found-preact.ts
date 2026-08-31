import { createElement, Fragment } from 'preact'
import type { ComponentChildren, ComponentType } from 'preact'
import type { LayoutProps, NotFoundProps } from 'typings/page.ts'
import { renderToResponse } from '../render/render-to-response-preact.ts'
import { resolveCssHrefs } from '../render/css-manifest.ts'
import { resolvePwaHead } from '../pwa/pwa-registry.ts'
import { isDevClientEnabled } from '../dev/dev-client-registry.ts'
import { applyDocumentShell } from './document-shell-preact.ts'
import { serializeHeadMarkup } from '../render/head-markup.ts'
import { ORBIT_OUTLET_ATTR } from './orbit-protocol.ts'
import { resolveHead } from './head-descriptor.ts'
import type { DocumentModel } from '../render/document-model.ts'
import type { NotFoundRenderContext } from './not-found-renderer-registry.ts'

/**
 * Renders a not-found response through Preact — the Preact counterpart to
 * `render-not-found-react.tsx`, registered by `defineSpaceApp({ renderer: 'preact' })`.
 *
 * Closes a real gap rather than adding a feature: before this existed, `createNotFoundHandler` was
 * React-only and threw outright under `--renderer=preact`, so a Preact app had no not-found page at
 * all and fell through to `@zanix/server`'s own JSON error response — a difference discovered only
 * on the first real 404 in production.
 *
 * Structurally identical to React's counterpart, and deliberately so: same `resolveHead`, same
 * `DocumentModel`, same `applyDocumentShell` decision. The ONLY divergence is the one that exists
 * everywhere in this package — React hoists head elements out of the tree, Preact has the resolved
 * head placed into `<head>` after serialization (see `render/head-markup.ts`). Both produce the same
 * `DocumentSemantics`, which `@tests/functional/router/not-found-parity.test.tsx` asserts directly.
 *
 * @module
 */
export function renderNotFoundResponse(
  context: NotFoundRenderContext,
): Promise<Response> {
  const { NotFound, RootLayout, head, fragmentOnly, lang, messages } = context

  const View = NotFound as ComponentType<NotFoundProps>
  // `display: contents` comes from `builtin-css.ts`'s own stylesheet rule, targeting this same
  // `ORBIT_OUTLET_ATTR` selector — never an inline `style` prop here (a strict `style-src` with
  // no `'unsafe-inline'` silently drops those).
  const outlet = createElement(
    'div',
    { [ORBIT_OUTLET_ATTR]: '' },
    createElement(View, { lang, messages }),
  )

  const resolvedHead = resolveHead([head])

  if (fragmentOnly) {
    // Same shape a page's own Orbit fragment takes (`render-page-preact.ts`): a real `<title>`
    // element as literal text for `orbit.ts`'s own `extractFragmentTitle`, nothing else.
    return Promise.resolve(
      renderToResponse(
        resolvedHead.title
          ? createElement(
            Fragment,
            null,
            createElement('title', null, resolvedHead.title),
            outlet,
          )
          : outlet,
        {},
      ),
    )
  }

  const document: DocumentModel = {
    head: resolvedHead,
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
