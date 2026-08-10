import type { ComponentType } from 'react'
import type { LayoutProps } from 'typings/page.ts'

// Whole-app singletons, not per-page state (unlike `page-tree-registry.ts`'s `WeakMap`) — an app
// has exactly one root layout and one not-found page, discovered once by `loadRoutes()`.
let rootLayout: ComponentType<LayoutProps> | undefined
let notFoundComponent: ComponentType | undefined

/** Set once by `loadRoutes()` after discovering `routesDir`'s own `layout.tsx`, if any. Read by
 * both `SpacePageController`'s own rendering and `createNotFoundHandler`'s not-found page, so both
 * share the same root-layout-or-default-shell decision (see `applyDocumentShell`). */
export function setRootLayout(Layout: ComponentType<LayoutProps> | undefined): void {
  rootLayout = Layout
}

export function getRootLayout(): ComponentType<LayoutProps> | undefined {
  return rootLayout
}

/** Set once by `loadRoutes()` after discovering `routesDir`'s own `not-found.tsx`, if any. Read by
 * `createNotFoundHandler` — falls back to a built-in default view when nothing was registered. */
export function setNotFoundComponent(Component: ComponentType | undefined): void {
  notFoundComponent = Component
}

export function getNotFoundComponent(): ComponentType | undefined {
  return notFoundComponent
}
