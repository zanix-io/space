import type { ComponentType } from 'react'
import type { ClassConstructor } from '@zanix/server'
import type { ErrorBoundaryProps, LayoutProps } from 'typings/page.ts'
import type { SpacePageController } from './space-page-controller.tsx'

/** A single directory level's own `layout.tsx`/`loading.tsx`/`error.tsx`, already imported. */
export type ResolvedSegment = {
  layout?: ComponentType<LayoutProps>
  loading?: ComponentType
  error?: ComponentType<ErrorBoundaryProps>
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
const registry = new WeakMap<ClassConstructor<SpacePageController>, PageTree>()

/** Called by `loadRoutes()` once a page's composition chain has been resolved. Not meant to be
 * called directly — a page never registers its own tree. */
export function setPageTree(Target: ClassConstructor<SpacePageController>, tree: PageTree): void {
  registry.set(Target, tree)
}

/** Read by `SpacePageController.handleGet` to compose a page's render tree. Returns `undefined`
 * for a page that was never routed through `loadRoutes()` (e.g. registered programmatically). */
export function getPageTree(
  Target: ClassConstructor<SpacePageController>,
): PageTree | undefined {
  return registry.get(Target)
}
