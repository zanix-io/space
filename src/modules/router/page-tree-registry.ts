import type { ClassConstructor } from '@zanix/server'
import type { SpacePageController } from './space-page-controller.tsx'
import type { HeadDescriptor } from './head-descriptor.ts'

/** A single directory level's own `layout.tsx`/`loading.tsx`/`error.tsx`, already imported.
 * `unknown`, not `ComponentType<...>` from either 'react' or 'preact' — this registry is shared,
 * populated and read regardless of `defineSpaceApp({ renderer })`'s own value, and a React
 * `ComponentType` and a Preact one are nominally incompatible types (confirmed empirically), so no
 * single concrete type here could describe both. `unknown` (not `any`) is deliberate: nothing in
 * this module ever calls these as components — only `render-page-react.tsx`/`render-page-preact.ts`
 * do, each casting back to its OWN renderer's real `ComponentType` at the point of use (see either
 * file's own `composeSegments`) — `unknown` forces exactly that cast to happen there, where the real
 * type is actually known again, instead of silently allowing any misuse in between.
 *
 * `head` is typed precisely (never `unknown`) — unlike `layout`/`loading`/`error`, it's pure data
 * (or a function returning pure data), never a component, so there's no React-vs-Preact
 * incompatibility to route around. This is `layout.tsx`'s own named `head` export, exactly as
 * `load-routes.ts` found it — a plain object, or a function of `params` when the layout's head
 * depends on them. */
export type ResolvedSegment = {
  layout?: unknown
  loading?: unknown
  error?: unknown
  head?: HeadDescriptor | ((params: Record<string, string>) => HeadDescriptor)
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
  // slot is widened to `any` any more: `never` is a real structural supertype for `Params`, and
  // `TComponent` needs nothing at all now that its default is the renderer-neutral `SpaceComponent`
  // (`typings/renderable.ts`), which a page on EITHER renderer satisfies. It used to be React's own
  // `ComponentType`, which is why this renderer-neutral registry — a plain `WeakMap` keyed by page
  // class, which never reads a component at all — once had to widen both away.
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
