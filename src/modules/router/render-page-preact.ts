import { createElement, Fragment } from 'preact'
import type { ComponentChildren, ComponentType, VNode } from 'preact'
import type { ClassConstructor } from '@zanix/server'
import type { ErrorBoundaryProps, LayoutProps, PageContext } from 'typings/page.ts'
import logger from '@zanix/logger'
import { renderToResponse } from '../render/render-to-response-preact.ts'
import { resolveCssHrefs, resolvePageCssHrefs } from '../render/css-manifest.ts'
import { resolvePwaHead } from '../pwa/pwa-registry.ts'
import { isDevClientEnabled } from '../dev/dev-client-registry.ts'
import { SpaceErrorBoundary } from './error-boundary-preact.ts'
import { getPageTree } from './page-tree-registry.ts'
import { resolveSegmentData } from './segment-loader.ts'
import { applyDocumentShell } from './document-shell-preact.ts'
import { serializeHeadMarkup } from '../render/head-markup.ts'
import type { DocumentModel } from '../render/document-model.ts'
import { ORBIT_OUTLET_ATTR } from './orbit-protocol.ts'
import type { SpacePageController } from './space-page-controller.ts'
import { resolveHead } from './head-descriptor.ts'
import type { HeadDescriptor, ResolvedHead } from './head-descriptor.ts'
import type { StylesheetRef } from '../render/css-manifest.ts'

/**
 * Preact-core counterpart to `render-page-react.tsx` — the `PageRenderer`
 * `page-renderer-registry.ts` switches to when `--renderer=preact` is active (see
 * `runtime/define-space-app.ts`'s own wiring).
 * Reached only via a dynamic `import()`, never a static one — a React-only app (this package's
 * default) never loads Preact's module graph at all.
 *
 * @module
 */

// Registers Preact's own `createElement` as the factory `defineComet` builds its boundary markup
// with — set once, at module load, exactly like `error-boundary-preact.ts`'s own
// `options.errorBoundaries` flag and for the same reason: this module is only ever reached via
// `define-space-app.ts`'s dynamic `import()` for `renderer: 'preact'`, so a React-only app never
// runs this line and never pulls Preact in through it. Without it a Comet cannot render on the
// Preact path at all (`getCometElementFactory` throws rather than emitting empty markup) — see

/**
 * Wraps `element` in its page's composition chain — Preact counterpart to `render-page-react.tsx`'s
 * own `composeSegments`, same segment-walk, same `ORBIT_OUTLET_ATTR` marker, deliberately DIFFERENT
 * in one respect: no `Suspense` wrapping anywhere, ever.
 *
 * This isn't a simplification of the React version — it reflects a real constraint of this
 * renderer's own contract: Preact core has no `Suspense` at all, so `loading.tsx` is rejected
 * outright at `loadRoutes()` time (`load-routes.ts`'s own guard) — a page reaching this function
 * is already guaranteed to have no `loading` segment to wrap. `error.tsx` support does NOT need
 * the `Suspense`-wrapping workaround React's own version requires either: `preact-render-to-string`'s
 * synchronous render recovers a thrown error into an already-mounted `SpaceErrorBoundary` directly
 * (see `error-boundary-preact.ts`'s own doc for the `options.errorBoundaries` flag that makes this
 * true) — there is no streaming/resume-on-client mechanism to work around in the first place.
 *
 * `async` for the same one reason as React's own counterpart: `resolveSegmentData`
 * (`segment-loader.ts`) resolves every segment's own `layout.tsx` `loader` in parallel so each
 * `Layout` below receives its own `data` prop — see that function's own doc for the full contract,
 * shared verbatim between both renderers.
 */
async function composeSegments<Params>(
  // Same structural supertype this file's own `renderPageResponse` documents below.
  Target: ClassConstructor<SpacePageController<never>>,
  element: VNode,
  pageCtx: PageContext<Params>,
  fragmentOnly: boolean,
  pageHead: HeadDescriptor | undefined,
  // This page's own resolved `styles` — rendered as real `<link>` elements ONLY here, in
  // the `fragmentOnly` branch below: a full document already gets them through
  // the document model's own `cssHrefs` (see `renderPageResponse`'s own doc for why it only
  // ever passes a non-empty array when `fragmentOnly` is true). Same reasoning as
  // `render-page-react.tsx`'s own `composeSegments` — see that function's own doc for the full
  // Orbit-side story (`orbit.ts`'s `ensureStylesheetsLoaded`).
  pageCssRefs: StylesheetRef[],
  // `VNode<any>`, not `VNode`/`VNode<Record<string, unknown>>` — a real, structural TypeScript
  // limit, not a shortcut: `VNode<P>`'s own `type: ComponentType<P>` field makes `P` appear
  // CONTRAVARIANTLY (a component class's constructor takes `props: P`), so `VNode<Specific>` is
  // only ever assignable to `VNode<X>` when `X` itself is assignable TO `Specific` — no non-`any`
  // supertype satisfies that across the different concrete prop shapes this loop produces
  // (`SpaceErrorBoundary`'s own props, `Layout`'s own `LayoutProps`, the outlet `<div>`'s own DOM
  // attributes, ...).
  // deno-lint-ignore no-explicit-any
): Promise<{ element: VNode<any>; head: ResolvedHead }> {
  const segments = getPageTree(Target)?.segments ?? []
  const paramsRecord = pageCtx.params as unknown as Record<string, string>
  const segmentData = await resolveSegmentData(
    segments,
    pageCtx as unknown as PageContext,
  )

  // Most-specific-first, same reasoning/order as `render-page-react.tsx`'s own `composeSegments` —
  // the page's own head, then each segment from nearest (leaf) to farthest (root).
  const headDescriptors: Array<HeadDescriptor | undefined> = [pageHead]
  for (let i = segments.length - 1; i >= 0; i--) {
    const segmentHead = segments[i].head
    headDescriptors.push(
      typeof segmentHead === 'function' ? segmentHead(paramsRecord) : segmentHead,
    )
  }
  const head = resolveHead(headDescriptors)

  // deno-lint-ignore no-explicit-any
  let node: VNode<any> = element
  for (let i = segments.length - 1; i >= 0; i--) {
    // Cast here, not in `ResolvedSegment`'s own declared type — `page-tree-registry.ts` stores
    // these as `unknown` on purpose (shared with `render-page-react.tsx`, which casts to React's
    // own types instead); this is the one place per segment that knows they're really Preact's own
    // `ComponentType`s, because this file only ever runs under `--renderer=preact`.
    const Layout = segments[i].layout as
      | ComponentType<LayoutProps<ComponentChildren>>
      | undefined
    const ErrorFallback = segments[i].error as
      | ComponentType<ErrorBoundaryProps>
      | undefined
    if (ErrorFallback) {
      node = createElement(SpaceErrorBoundary, {
        fallback: ErrorFallback,
        children: node,
      })
    }
    if (Layout && i !== 0) {
      node = createElement(Layout, {
        params: paramsRecord,
        data: segmentData[i],
        children: node,
      })
    }
  }

  const outlet = createElement(
    'div',
    { style: { display: 'contents' }, [ORBIT_OUTLET_ATTR]: '' },
    node,
  )
  if (fragmentOnly) {
    // A real `<title>` element, never a hand-built string — same reasoning as
    // `render-page-react.tsx`'s own fragment path: `preact-render-to-string` serializes it as
    // literal, findable text, exactly what `orbit.ts`'s own `extractFragmentTitle` regex expects.
    // Never `meta`/`link` — see `head-descriptor.ts`'s own doc on why fragments stay title-only.
    //
    // `pageCssRefs` render the same way — plain `<link>` elements, no special treatment
    // (Preact never hoists anyway). `orbit.ts`'s own `ensureStylesheetsLoaded` strips every
    // `<link rel="stylesheet">` out of the fragment body before it ever reaches the live DOM, so
    // their exact position here doesn't matter, same reasoning as `<title>` above.
    const cssLinks = pageCssRefs.map((ref) => {
      const href = typeof ref === 'string' ? ref : ref.href
      const media = typeof ref === 'string' ? undefined : ref.media
      return createElement('link', { key: href, rel: 'stylesheet', href, media })
    })
    return {
      element: (head.title || cssLinks.length > 0)
        ? createElement(
          Fragment,
          null,
          head.title && createElement('title', null, head.title),
          ...cssLinks,
          outlet,
        )
        : outlet,
      head,
    }
  }

  return {
    element: applyDocumentShell(
      segments[0]?.layout as
        | ComponentType<LayoutProps<ComponentChildren>>
        | undefined,
      outlet,
      paramsRecord,
      // No `lang` slot to fill here — this composition path never resolved one before this change
      // either; `data` is the new, 5th positional argument (see `document-shell-preact.ts`'s own
      // doc for why it comes after `lang`, not before it).
      undefined,
      segmentData[0],
    ),
    head,
  }
}

/**
 * Builds and renders a page's full element tree via Preact — the Preact counterpart to
 * `render-page-react.tsx`'s own `renderPageResponse`, same public shape (this is what makes it a
 * drop-in `PageRenderer`, see `page-renderer-registry.ts`).
 *
 * `cssHrefs`/`pwaHead` are resolved here (same renderer-agnostic functions React's version calls)
 * but threaded into `composeSegments`/`applyDocumentShell` instead of into the SSR entry's own
 * options — see `document-shell-preact.ts`'s own doc for why. `devClient` is now resolved the exact
 * same way React's own `render-page-react.tsx` does (`isDevClientEnabled()` +
 * `getPageTree(Target)?.filePath`), real Prefresh HMR wired end to end
 * (`dev-vite-hot-client.ts`'s own doc has the full transport, shared with React's own dev sessions).
 */
export async function renderPageResponse<Params>(
  // `SpacePageController<never>` — identical to `render-page-react.tsx`'s own `Target`, and for the
  // same structural reason: `Params` appears CONTRAVARIANTLY inside `SpacePageExtensions`, so
  // `never` is the one type argument every page class is assignable TO. No slot is widened to
  // `any`. `TComponent` in particular needs nothing: it defaults to the renderer-neutral
  // `SpaceComponent`, which a page on either renderer satisfies, so this function — the PREACT
  // renderer — accepts a page typed for either renderer, not only React-typed ones.
  Target: ClassConstructor<SpacePageController<never>>,
  Component: unknown,
  pageCtx: PageContext<Params>,
  data: unknown,
  fragmentOnly: boolean,
  nonce: string | undefined,
  themeStyle: string | undefined,
): Promise<Response> {
  // Same cast reasoning as `rawPageHead` below (`ClassConstructor<T>` exposes no static members) —
  // read here, before `cssHrefs`, since it needs to feed into that same computation.
  const pageStyles = (Target as unknown as typeof SpacePageController).styles
  const pageCssRefs = resolvePageCssHrefs(getPageTree(Target)?.filePath, pageStyles)
  // Global first, then this page's own — preserves cascade order (global → page → comet; a
  // Comet's own CSS never appears in this list, resolved separately at its own render position).
  const cssHrefs = fragmentOnly ? undefined : [...(resolveCssHrefs() ?? []), ...pageCssRefs]
  const pwaHead = fragmentOnly ? undefined : resolvePwaHead()
  // Same reasoning as `cssHrefs`/`pwaHead` above — page-independent, already in effect on the page
  // an Orbit fragment is swapping into.
  const resolvedThemeStyle = fragmentOnly ? undefined : themeStyle

  // `SpacePageController.component`'s own declared type is `unknown` too (an author only ever
  // WRITES to it, never reads it back — see that class's own doc) — this is the one place that
  // casts it back to a real Preact `ComponentType`, because this function only ever runs under
  // `--renderer=preact`.
  const RealComponent = Component as ComponentType<Record<string, unknown>>
  // `Target.head` may be a plain descriptor or a function of `loader`'s own resolved `data` — same
  // cast reasoning as `render-page-react.tsx`'s own `renderPageResponse` (`ClassConstructor<T>`
  // exposes no static members).
  const rawPageHead = (Target as unknown as typeof SpacePageController).head
  const pageHead = typeof rawPageHead === 'function' ? rawPageHead(data) : rawPageHead
  const { element, head } = await composeSegments(
    Target,
    createElement(RealComponent, data as Record<string, unknown>),
    pageCtx,
    fragmentOnly,
    pageHead,
    // Only the fragment branch actually renders these (see `composeSegments`'s own doc) — a full
    // document gets this page's own CSS through the document model's `cssHrefs` instead, never both.
    fragmentOnly ? pageCssRefs : [],
  )

  // The renderer-agnostic description of this document (`render/document-model.ts`) — built from
  // the SAME resolution helpers React's own `renderPageResponse` calls, so both renderers start
  // from identical inputs and differ only in how they serialize them. Never built for a fragment:
  // a fragment is not a document and has no `<head>` to place anything in.
  const document: DocumentModel | undefined = fragmentOnly ? undefined : {
    head,
    cssHrefs: cssHrefs ?? [],
    themeStyle: resolvedThemeStyle,
    pwa: pwaHead,
    nonce,
    initialState: data,
    devClient: isDevClientEnabled() ? { routeFilePath: getPageTree(Target)?.filePath } : undefined,
  }

  // Same reasoning as React's own `renderPageResponse` for why a fragment skips all of this — see
  // that file's own doc. Same `onError` reasoning too — see that file's own comment on it: without
  // this, a shell-breaking render error here vanishes with zero trace, console or persisted.
  const onError = (error: unknown) =>
    logger.error(
      `Uncaught error rendering "${pageCtx.url.pathname}" (${getPageTree(Target)?.filePath})`,
      error,
    )

  return Promise.resolve(
    renderToResponse(
      element,
      document === undefined ? { onError } : {
        onError,
        initialState: document.initialState,
        nonce: document.nonce,
        doctype: true,
        devClient: document.devClient,
        // Placed into the rendered document's own `<head>` after serialization — the step that
        // replaced the old `headExtras` prop threading, and the reason a custom root `layout.tsx`
        // no longer has to cooperate for this document to carry its own metadata. See
        // `head-markup.ts`'s own module doc.
        headMarkup: serializeHeadMarkup(document),
        serviceWorkerHref: document.pwa?.serviceWorkerHref,
      },
    ),
  )
}
