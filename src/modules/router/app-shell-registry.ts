import type { HeadDescriptor } from './head-descriptor.ts'

// `unknown`, not `ComponentType<...>` from either 'react' or 'preact' — `Layout`/`Component` hold
// either a React or a Preact component depending on `defineSpaceApp({ renderer })`, and this module
// (internal wiring, never part of the public `router/mod.ts` barrel) has no reason to pick one
// renderer's own `ComponentType` over the other's: the two are nominally incompatible types
// (confirmed empirically — a React `ComponentType` and a Preact one fail to structurally unify,
// even both instantiated with the same props type). `unknown` (not `any`) is deliberate: every real
// reader of these values (`not-found-handler.ts`, `render-page-react.tsx`/`render-page-preact.ts`)
// already casts back to its OWN renderer's real type before using it as a component — `unknown`
// forces that cast to happen at the point of use instead of silently trusting an unchecked value in
// between.

// Whole-app singletons, not per-page state (unlike `page-tree-registry.ts`'s `WeakMap`) — an app
// has exactly one root layout and one not-found page, discovered once by `loadRoutes()`.
let rootLayout: unknown
let notFoundComponent: unknown
let notFoundHead: HeadDescriptor | undefined

/** Set once by `loadRoutes()` after discovering `routesDir`'s own `layout.tsx`, if any. Read by
 * both `SpacePageController`'s own rendering and `createNotFoundHandler`'s not-found page, so both
 * share the same root-layout-or-default-shell decision (see `applyDocumentShell`). */
export function setRootLayout(Layout: unknown): void {
  rootLayout = Layout
}

export function getRootLayout(): unknown {
  return rootLayout
}

/** Set once by `loadRoutes()` after discovering `routesDir`'s own `not-found.tsx`, if any. Read by
 * `createNotFoundHandler` — falls back to a built-in default view when nothing was registered. */
export function setNotFoundComponent(Component: unknown): void {
  notFoundComponent = Component
}

export function getNotFoundComponent(): unknown {
  return notFoundComponent
}

/**
 * Set by `loadRoutes()` from `routesDir`'s own `not-found.tsx` named `head` export, if it declares
 * one — the SAME mechanism a `layout.tsx` already uses to contribute a head, applied to the one
 * other document this framework renders on its own.
 *
 * Typed, unlike the component values above: a `HeadDescriptor` is plain data with no renderer
 * involvement at all, so there is nothing here for a cast at the point of use to protect against.
 */
export function setNotFoundHead(head: HeadDescriptor | undefined): void {
  notFoundHead = head
}

/** Read by `createNotFoundHandler` — `undefined` when the app's `not-found.tsx` declares no `head`
 * export (or when there is no `not-found.tsx`), in which case that handler falls back to
 * `DEFAULT_NOT_FOUND_HEAD`. */
export function getNotFoundHead(): HeadDescriptor | undefined {
  return notFoundHead
}
