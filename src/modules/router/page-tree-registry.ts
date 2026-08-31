import type { ClassConstructor } from '@zanix/server'
import type { SpacePageController } from './space-page-controller.ts'
import type { HeadDescriptor } from './head-descriptor.ts'
import type { PageContext } from 'typings/page.ts'

/** A single directory level's own `layout.tsx`/`loading.tsx`/`error.tsx`, already imported.
 * `unknown`, not `ComponentType<...>` from either 'react' or 'preact' — this registry is shared,
 * populated and read regardless of `defineSpaceApp({ renderer })`'s own value, and a React
 * `ComponentType` and a Preact one are nominally incompatible types, so no single concrete type
 * here could describe both. `unknown` (not `any`) is deliberate: nothing in
 * this module ever calls these as components — only `render-page-react.tsx`/`render-page-preact.ts`
 * do, each casting back to its OWN renderer's real `ComponentType` at the point of use (see either
 * file's own `composeSegments`) — `unknown` forces exactly that cast to happen there, where the real
 * type is actually known again, instead of silently allowing any misuse in between.
 *
 * `head`/`loader` are typed precisely (never `unknown`) — unlike `layout`/`loading`/`error`,
 * neither is a component, so there's no React-vs-Preact incompatibility to route around. `head` is
 * `layout.tsx`'s own named `head` export, exactly as `load-routes.ts` found it — a plain object, or
 * a function of `params` when the layout's head depends on them. `loader` is that same file's own
 * named `loader` export — see `typings/page.ts`'s own `LayoutProps.data` doc for what it resolves
 * to and how (parallel across the whole chain, resolved by `segment-loader.ts`'s own
 * `resolveSegmentData`, called from each renderer's own `composeSegments`). */
export type ResolvedSegment = {
  layout?: unknown
  loading?: unknown
  error?: unknown
  /**
   * This segment's own `error.tsx`, real (symlink-resolved) filesystem path — set by
   * `load-routes.ts` alongside `error` itself, `undefined` whenever `error` is. Never the raw,
   * `scanPageFiles`-reported path: this is fed straight into `resolveCometModuleUrl`
   * (`modules/comets/comet-manifest.ts`), which keys its production manifest lookup by the SAME
   * realpath `buildSpaceClient` computes for the identical file at build time — an un-realpath'd
   * path here would silently never match on a filesystem where the project root is itself a
   * symlink (see that function's own doc, and `comet-manifest.ts`'s `normalizeSourceKey`).
   *
   * Read by both renderers' own `composeSegments` to resolve this segment's `error.tsx` client
   * module URL — see `error-boundary-marker.ts`'s own module doc for why an `error.tsx` boundary
   * needs one at all (client-side hydration recovery), and why it isn't just treated as a plain
   * Comet.
   */
  errorFilePath?: string
  head?: HeadDescriptor | ((params: Record<string, string>) => HeadDescriptor)
  loader?: (ctx: PageContext) => unknown | Promise<unknown>
}

/** A page's full composition chain, root directory first, its own directory last. */
export type PageTree = {
  segments: ResolvedSegment[]
  /**
   * This page's own source file path, exactly as `scanPageFiles` reported it — read by
   * `SpacePageController` to pass along as `DevClientScriptOptions.routeFilePath`, so the
   * injected dev client script (when enabled) only reloads THIS page for a change that actually
   * affects it. Present for every page routed through `loadRoutes()` (the only real caller of
   * `setPageTree`); no other meaning is attached to it.
   */
  filePath: string
}

// Keyed by the page's own class, not an instance — a `SpacePageController` is constructed fresh
// per request (transient lifetime, same as any other Zanix handler), but its composition chain
// (which layouts/loading/error apply to it) is fixed at `loadRoutes()` time and shared by every
// request that class ever serves. A `WeakMap` (rather than a static class field) keeps this
// entirely internal to the router module — nothing here is part of `SpacePageController`'s own
// public shape, so it never has to satisfy `HandlerBaseClass`'s instance-member index signature.
// Keyed by `SpacePageController<never>`, not the bare form: `Params` appears CONTRAVARIANTLY inside
// `SpacePageExtensions` (a page's own `loader` takes `PageContext<Params>`), so `never` — assignable
// to every param shape — is the one type argument every page class is assignable TO. That is a real
// structural supertype, not a widening: a value that is not a page is still rejected.
const registry = new WeakMap<ClassConstructor<SpacePageController<never>>, PageTree>()

/** Called by `loadRoutes()` once a page's composition chain has been resolved. Not meant to be
 * called directly — a page never registers its own tree. */
export function setPageTree(
  // `SpacePageController<never>` — the registry's own key type, see the `WeakMap` above. Neither
  // slot is widened to `any`: `never` is a real structural supertype for `Params`, and
  // `TComponent` needs nothing at all — its default is the renderer-neutral `SpaceComponent`
  // (`typings/renderable.ts`), which a page on EITHER renderer satisfies, and this plain `WeakMap`
  // keyed by page class never reads a component at all.
  Target: ClassConstructor<SpacePageController<never>>,
  tree: PageTree,
): void {
  registry.set(Target, tree)
}

/** Read by `SpacePageController.handleGet` to compose a page's render tree. Returns `undefined`
 * for a page that was never routed through `loadRoutes()` (e.g. registered programmatically). */
export function getPageTree(
  // Same reasoning as `setPageTree` above.
  Target: ClassConstructor<SpacePageController<never>>,
): PageTree | undefined {
  return registry.get(Target)
}

/**
 * Finds this route's nearest `error.tsx` — leaf (this page's own directory) first, walking toward
 * the root, the FIRST segment declaring one wins. The exact same resolution order
 * `render-page-react.tsx`'s/`render-page-preact.ts`'s own `composeSegments` already establishes for
 * a RENDER-phase throw (their own segment-walk wraps every ancestor's `error.tsx` in a boundary, most
 * specific innermost); this is that same "nearest wins" rule, factored out so a DATA-phase throw
 * (`loader-error-handler.ts`, reached when a page's own `loader` or a segment's own `loader` throws)
 * shares one implementation with it instead of a second, independently-maintained lookup.
 *
 * Deliberately returns only the SINGLE nearest match rather than every ancestor's own `error.tsx`
 * (unlike `composeSegments`, which wraps all of them): a data-phase throw means this request's own
 * segment data never fully resolved at all, so there is no partial tree to nest an outer boundary
 * around — only the one nearest fallback is ever rendered, wrapped directly in the app's root layout
 * (see `loader-error-handler.ts`'s own doc).
 *
 * @param segments - A page's own composition chain, root-first — same shape `getPageTree` returns.
 * @returns The nearest segment's own `error.tsx` default export (still `unknown` — a renderer casts
 * it to its own real `ComponentType<ErrorBoundaryProps>` at the point of use), or `undefined` when no
 * segment in this chain declares one.
 */
export function findNearestErrorBoundary(segments: ResolvedSegment[]): unknown {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].error !== undefined) return segments[i].error
  }
  return undefined
}
