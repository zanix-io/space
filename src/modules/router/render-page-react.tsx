import type { ComponentType, ReactElement, ReactNode } from 'react'
import { Fragment, Suspense } from 'react'
import type { ClassConstructor } from '@zanix/server'
import type { ErrorBoundaryProps, LayoutProps, PageContext } from 'typings/page.ts'
import logger from '@zanix/logger'
import { renderToResponse } from '../render/render-to-response.tsx'
import { resolveCssHrefs, resolvePageCssHrefs } from '../render/css-manifest.ts'
import { resolvePwaHead } from '../pwa/pwa-registry.ts'
import { isDevClientEnabled } from '../dev/dev-client-registry.ts'
import { SpaceErrorBoundary } from './error-boundary.tsx'
import { getPageTree } from './page-tree-registry.ts'
import { resolveSegmentData } from './segment-loader.ts'
import { applyDocumentShell } from './document-shell.tsx'
import { ORBIT_OUTLET_ATTR } from './orbit-protocol.ts'
import type { SpacePageController } from './space-page-controller.tsx'
import { resolveHead } from './head-descriptor.ts'
import type { DocumentModel } from '../render/document-model.ts'
import type { HeadDescriptor, ResolvedHead } from './head-descriptor.ts'
import type { StylesheetRef } from '../render/css-manifest.ts'

/**
 * React's own page-composition + render implementation — the `PageRenderer` registered by default
 * (`page-renderer-registry.ts`), unchanged from before this package had a Preact counterpart. Moved out
 * of `space-page-controller.tsx` (not rewritten) specifically so that file could become fully
 * renderer-agnostic: `handleGet` now only ever calls whatever `getPageRenderer()` returns, never
 * this function (or `render-page-preact.ts`'s own) by name — see `page-renderer-registry.ts`'s own doc
 * for why that indirection is the seam, not a per-call `if (renderer === ...)` inside shared code.
 *
 * @module
 */

/**
 * Wraps `element` in its page's composition chain (root directory first) — each segment's own
 * `error.tsx` boundary around its own `loading.tsx` Suspense fallback around its own `layout.tsx`,
 * built from the leaf directory outward so the root layout ends up outermost.
 *
 * A segment with an `error.tsx` but no `loading.tsx` still gets wrapped in a `Suspense` (with a
 * `null` fallback) — not for a loading state, but because React's server renderer only recovers a
 * thrown error into an already-mounted error boundary for content that lives *inside* a `Suspense`
 * boundary; a synchronous throw in the plain, un-suspended "shell" is always fatal to the whole
 * response, no matter how many error boundaries sit above it. See `SpaceErrorBoundary`'s own doc
 * for what actually happens once that boundary IS reachable (it isn't a same-request fallback).
 *
 * **The root layout owns the document, same contract as Next.js's own App Router**: the outermost
 * segment's `layout.tsx` (root `routesDir`, or a page never routed through `loadRoutes()` at all,
 * which has no segments to speak of) is applied by `applyDocumentShell` below, not by this loop —
 * shared with `createNotFoundHandler`'s own not-found page, which has no segment loop of its own
 * but still needs the exact same root-layout-or-default-shell decision.
 *
 * Everything below the root layout is wrapped in a marker (`ORBIT_OUTLET_ATTR`) Orbit's client
 * runtime uses as its navigation swap target — a header/footer/nav living in the root layout
 * itself stays outside that marker, so Orbit never re-fetches or re-renders it.
 *
 * @param fragmentOnly - `true` for an Orbit navigation request (see `ORBIT_FRAGMENT_HEADER`):
 * returns just the outlet's own content (plus a literal `<title>`, if `head`/`pageHead` resolved
 * one — see this function's own return type doc), skipping the root layout and document shell
 * entirely, since Orbit only ever swaps what's already inside them on the client.
 * @param pageHead - This page's own `SpacePageController.head`, already resolved against `loader`
 * data if it was a function (`renderPageResponse`'s own job, before calling this) — merged here
 * with every segment's own `head` export, most-specific-first (page, then nearest layout, ...,
 * root). See `resolveHead`'s own doc (`head-descriptor.ts`) for the full precedence contract.
 * @param pageCssRefs - This page's own resolved `styles` — rendered as real `<link>`
 * elements ONLY in the `fragmentOnly` branch, same `<title>`-style body-embedding
 * convention: a full document already gets this page's own CSS through `cssHrefs` (see
 * `renderPageResponse` below), so passing it here too would double-render it for that case —
 * `renderPageResponse` only ever passes a non-empty array when `fragmentOnly` is true. Orbit's
 * client runtime (`orbit.ts`'s own `ensureStylesheetsLoaded`) extracts these (and any Comet's own
 * already-inline `<link>`, unconditionally rendered regardless of full/fragment — see
 * `define-comet.ts`'s own doc) from the fragment body BEFORE the visual swap, moves the ones not
 * already in `document.head` there, and awaits their load — never a header, since Orbit's own
 * prefetch cache (`prefetch.ts`) stores only the response BODY TEXT, not headers.
 *
 * `async` for exactly one reason: `resolveSegmentData` (`segment-loader.ts`) resolves every
 * segment's own `layout.tsx` `loader` — all of them, in parallel, via a single `Promise.all` — so
 * each `Layout` below receives its own `data` prop. This runs AFTER the page's own `loader` (already
 * awaited by `handleGet` before this function is ever called) rather than alongside it, a deliberate
 * scope boundary: keeping `PageRenderer`'s own signature (`page-renderer-registry.ts`) completely
 * unchanged was worth the small sequential cost over threading a second loader-resolution phase
 * through that shared seam. See `LayoutProps.data`'s own doc (`typings/page.ts`) for the full
 * contract.
 */
async function composeSegments<Params>(
  // Same structural supertype this file's own `renderPageResponse` documents below.
  Target: ClassConstructor<SpacePageController<never>>,
  element: ReactElement,
  pageCtx: PageContext<Params>,
  fragmentOnly: boolean,
  pageHead: HeadDescriptor | undefined,
  pageCssRefs: StylesheetRef[],
): Promise<{ element: ReactElement; head: ResolvedHead }> {
  const segments = getPageTree(Target)?.segments ?? []
  const paramsRecord = pageCtx.params as unknown as Record<string, string>
  const segmentData = await resolveSegmentData(
    segments,
    pageCtx as unknown as PageContext,
  )

  // Most-specific-first: the page's own head, then each segment from nearest (leaf) to farthest
  // (root) — the REVERSE of `segments`' own root-first storage order.
  const headDescriptors: Array<HeadDescriptor | undefined> = [pageHead]
  for (let i = segments.length - 1; i >= 0; i--) {
    const segmentHead = segments[i].head
    headDescriptors.push(
      typeof segmentHead === 'function' ? segmentHead(paramsRecord) : segmentHead,
    )
  }
  const head = resolveHead(headDescriptors)

  let node = element
  for (let i = segments.length - 1; i >= 0; i--) {
    // Cast here, not in `ResolvedSegment`'s own declared type — `page-tree-registry.ts` stores
    // these as `unknown` on purpose (shared with `render-page-preact.ts`, which casts to Preact's
    // own types instead); this is the one place per segment that knows they're really React's own
    // `ComponentType`s, because this file only ever runs under `--renderer=react`.
    const Layout = segments[i].layout as ComponentType<LayoutProps<ReactNode>> | undefined
    const Loading = segments[i].loading as ComponentType | undefined
    const ErrorFallback = segments[i].error as
      | ComponentType<ErrorBoundaryProps>
      | undefined
    if (Loading) {
      node = <Suspense fallback={<Loading />}>{node}</Suspense>
    } else if (ErrorFallback) {
      node = <Suspense fallback={null}>{node}</Suspense>
    }
    if (ErrorFallback) {
      node = <SpaceErrorBoundary fallback={ErrorFallback}>{node}</SpaceErrorBoundary>
    }
    if (Layout && i !== 0) {
      node = (
        <Layout params={paramsRecord} data={segmentData[i]}>
          {node}
        </Layout>
      )
    }
  }

  // `display: contents` so this outlet never breaks a root layout's own `display: grid`/`flex`
  // layout by inserting an extra box between it and its real children.
  const outlet = (
    <div style={{ display: 'contents' }} {...{ [ORBIT_OUTLET_ATTR]: '' }}>
      {node}
    </div>
  )
  if (fragmentOnly) {
    // A real `<title>` element (never a hand-built string — JSX text children are HTML-escaped,
    // which would turn this into `&lt;title&gt;...` instead of a real tag) — never `meta`/`link`,
    // see `head-descriptor.ts`'s own doc on why this package's first head-management iteration
    // keeps fragments title-only. React's own hoisting still emits this as literal, unescaped text
    // even with NO `<head>`/`<html>` anywhere in the tree — confirmed empirically (a real headless
    // fragment render, not assumed) before relying on it here. `orbit.ts`'s own
    // `extractFragmentTitle` already looks for exactly this shape (a real regex match, not
    // something new this package invented for the occasion) and strips it back out before
    // inserting the remainder into the live DOM, so its exact position inside the fragment doesn't
    // matter — only that it's present, as real text, somewhere in the response.
    //
    // `pageCssRefs` renders with `precedence='space'` — the SAME resource-management prop
    // a Comet's own `<link>` already carries (`define-comet.ts`) — REQUIRED, not decorative: React
    // 19 flushes `precedence`-managed resources ahead of ordinary content regardless of tree
    // position, even with no real `<head>` in a bare fragment render. A plain `<link>` here, with
    // no `precedence`, renders AFTER a Comet's own resource-managed one despite appearing BEFORE it
    // in this very tree, silently breaking the global → page → comet cascade order this whole
    // architecture promises. With BOTH on equal footing, first-encounter order among resources is
    // preserved — this page's own `<link>`s
    // (declared here, before `outlet`) precede any Comet's own (declared inside it). Orbit's own
    // client (`orbit.ts`) still just extracts every `<link rel="stylesheet">` it finds, in
    // whatever order the response's own HTML actually has them, ignoring `precedence` entirely — it
    // never needs to hoist into a real `<head>` itself, only read this response's own already-final
    // order and strip them out before ever assigning the remainder to the live DOM.
    return {
      element: (
        <Fragment>
          {head.title && <title>{head.title}</title>}
          {pageCssRefs.map((ref) => {
            const href = typeof ref === 'string' ? ref : ref.href
            const media = typeof ref === 'string' ? undefined : ref.media
            return <link key={href} rel='stylesheet' href={href} media={media} precedence='space' />
          })}
          {outlet}
        </Fragment>
      ),
      head,
    }
  }

  return {
    element: applyDocumentShell(
      segments[0]?.layout as ComponentType<LayoutProps<ReactNode>> | undefined,
      outlet,
      paramsRecord,
      segmentData[0],
    ),
    head,
  }
}

/**
 * Builds and renders a page's full element tree via React — registered as the default
 * `PageRenderer` (`page-renderer-registry.ts`). Same public shape as `render-page-preact.ts`'s own
 * `renderPageResponse`, so `SpacePageController.handleGet` can call whichever one is active without
 * knowing which renderer it belongs to.
 */
export async function renderPageResponse<Params>(
  // `SpacePageController<never>` — the same structural supertype `page-tree-registry.ts` documents:
  // `Params` appears CONTRAVARIANTLY inside `SpacePageExtensions`, so `never` is the one type
  // argument every page class is assignable TO, whatever param shape it declared. The bare form
  // would pin `Params` to `Record<string, string>` and reject a properly-typed page; `any` would
  // stop checking that this is a page at all. `TComponent` needs no argument now that it defaults
  // to the renderer-neutral `SpaceComponent`. This function never reads `Target` as a component or
  // as a param shape — only static members off it, through the casts below.
  Target: ClassConstructor<SpacePageController<never>>,
  Component: unknown,
  pageCtx: PageContext<Params>,
  data: unknown,
  fragmentOnly: boolean,
  nonce: string | undefined,
  themeStyle: string | undefined,
): Promise<Response> {
  // `SpacePageController.component`'s own declared type is `unknown` too (an author only ever
  // WRITES to it, never reads it back — see that class's own doc) — this is the one place that
  // casts it back to a real React `ComponentType`, because this function only ever runs under
  // `--renderer=react`.
  // deno-lint-ignore no-explicit-any
  const RealComponent = Component as ComponentType<any>
  // `Target.head` may be a plain descriptor or a function of `loader`'s own resolved `data` (same
  // value `component` itself already receives as props) — resolved here, once, before composing.
  // Cast needed because `ClassConstructor<T>` (this function's own `Target` param type) exposes no
  // static members at all — same reasoning `SpacePageController.handleGet`'s own `Ctor` cast uses.
  const rawPageHead = (Target as unknown as typeof SpacePageController).head
  const pageHead = typeof rawPageHead === 'function' ? rawPageHead(data) : rawPageHead
  // Same cast reasoning as `rawPageHead` above. `resolvePageCssHrefs` is dev-aware on its own (see
  // that function's own doc) — `styles` is only ever actually read in dev; production resolves
  // purely from the manifest via this same page's own `filePath`.
  const pageStyles = (Target as unknown as typeof SpacePageController).styles
  const pageCssRefs = resolvePageCssHrefs(getPageTree(Target)?.filePath, pageStyles)
  const { element, head } = await composeSegments(
    Target,
    <RealComponent {...(data as Record<string, unknown>)} />,
    pageCtx,
    fragmentOnly,
    pageHead,
    // Only the fragment branch actually renders these (see `composeSegments`'s own doc) — a full
    // document gets this page's own CSS through `cssHrefs` below instead, never both.
    fragmentOnly ? pageCssRefs : [],
  )
  // A fragment is only ever inserted into an already-hydrated (or about to be) page by Orbit's own
  // client runtime — it never needs the initial-state script a full document's own hydration reads,
  // nor therefore the nonce that script would otherwise need, nor a stylesheet link, PWA head,
  // theme override, or dev client script: all page-independent (or, for the dev client, already
  // connected from the full document it's swapping into), already in effect on the page it's
  // swapping into. Its own resolved `<title>` (if any) is already embedded directly in `element` by
  // `composeSegments` above — `meta`/`link` stay full-document-only, same reasoning.
  // The renderer-agnostic description of this document (`render/document-model.ts`) — built from
  // the SAME resolution helpers `render-page-preact.ts` calls, in the same order, so both renderers
  // start from identical inputs and differ only in how they serialize them. Never built for a
  // fragment: a fragment is not a document and has no `<head>` for any of this to live in.
  const document: DocumentModel | undefined = fragmentOnly ? undefined : {
    head,
    // Global first, then this page's own — preserves cascade order (global → page → comet; a
    // Comet's own CSS never appears in this list at all, resolved separately at its own render
    // position — see `define-comet.ts`'s own doc). Both `undefined`-safe on their own; the
    // spread never needs an extra null check.
    cssHrefs: [...(resolveCssHrefs() ?? []), ...pageCssRefs],
    themeStyle,
    pwa: resolvePwaHead(),
    nonce,
    initialState: data,
    devClient: isDevClientEnabled() ? { routeFilePath: getPageTree(Target)?.filePath } : undefined,
  }

  // `renderToResponse`'s own default (no `onError`) is silent — this is the one place a
  // shell-breaking render error would otherwise vanish with zero trace, console or persisted (see
  // that function's own doc for exactly when it fires). `logger.error` here doesn't change the
  // response the end user sees (still the same blank 500 either way) — it's the only thing that
  // makes the failure debuggable at all.
  const onError = (error: unknown) =>
    logger.error(
      `Uncaught error rendering "${pageCtx.url.pathname}" (${getPageTree(Target)?.filePath})`,
      error,
    )

  return renderToResponse(
    element,
    document === undefined ? { onError } : {
      onError,
      initialState: document.initialState,
      nonce: document.nonce,
      cssHrefs: document.cssHrefs,
      themeStyle: document.themeStyle,
      pwaHead: document.pwa,
      title: document.head.title,
      meta: document.head.meta,
      link: document.head.link,
      devClient: document.devClient,
    },
  )
}
