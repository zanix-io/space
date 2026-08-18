import { InternalError } from '@zanix/errors'
import type { ClassConstructor } from '@zanix/server'
import type { PageContext } from 'typings/page.ts'
import type { SpacePageController } from './space-page-controller.tsx'

/**
 * The function `SpacePageController.handleGet` calls to turn a page's resolved data into a final
 * `Response` — composes that page's layout/error chain and renders it, all in one call. Both
 * `render-page-react.tsx` and `render-page-preact.ts` export a function of exactly this shape
 * named `renderPageResponse`; whichever one is registered here is the one `handleGet` actually
 * runs, and `handleGet` itself never imports either by name — that indirection (not a per-call
 * `if (renderer === 'preact')`) is the seam.
 *
 * `Component` is `unknown`, not `ComponentType<...>` from either 'react' or 'preact' — this type
 * has to describe BOTH `render-page-react.tsx`'s own function and `render-page-preact.ts`'s, and a
 * React `ComponentType` and a Preact one are nominally incompatible types (confirmed empirically),
 * so no single concrete type here could describe both. `unknown` (not `any`) works because both
 * concrete implementations ALSO declare their own `Component` parameter as `unknown` and cast it
 * back to their own renderer's real type internally, right before using it — see either file's own
 * `renderPageResponse` doc.
 */
export type PageRenderer = <Params>(
  // `SpacePageController<never>` — `Params` appears contravariantly inside `SpacePageExtensions`,
  // so `never` is the one type argument every page class is assignable TO. Both concrete renderers
  // declare their own `Target` identically; see `page-tree-registry.ts` for the full reasoning.
  Target: ClassConstructor<SpacePageController<never>>,
  Component: unknown,
  pageCtx: PageContext<Params>,
  data: unknown,
  fragmentOnly: boolean,
  nonce: string | undefined,
  themeStyle: string | undefined,
) => Promise<Response>

// No default. This module — and every module `@zanix/space` itself reaches — must be free of any
// path that can load a renderer, static or dynamic: an eager React default is what made a
// `renderer: 'preact'` app evaluate `react-dom/server` just by importing this package, and a lazy
// one with React as fallback would keep that path alive. The implementation arrives from
// `@zanix/space/react` or `@zanix/space/preact`, through `installRendererRuntime`
// (`renderer-runtime.ts`), which is also what `defineSpaceApp({ renderer })` checks its own value
// against.
let pageRenderer: PageRenderer | undefined

/**
 * Switches the active `PageRenderer` — called by `installRendererRuntime` when a renderer entry
 * point is imported. Never called by an app directly.
 */
export function setPageRenderer(renderPage: PageRenderer): void {
  pageRenderer = renderPage
}

/**
 * Read by `SpacePageController.handleGet` — see {@linkcode PageRenderer}'s own doc.
 *
 * @throws {InternalError} When no renderer entry point has been imported. There is deliberately no
 * fallback: `@zanix/space` ships no renderer of its own, so this is a real configuration error with
 * exactly one fix — import the entry point matching this project's own
 * `defineSpaceApp({ renderer })`.
 */
export function getPageRenderer(): PageRenderer {
  if (!pageRenderer) {
    throw new InternalError(
      'No renderer is installed: `@zanix/space` itself contains no renderer implementation, by ' +
        "design. Import this project's own renderer entry point once, from its main module — " +
        "`import '@zanix/space/react'` for `defineSpaceApp({ renderer: 'react' })`, or " +
        "`import '@zanix/space/preact'` for `renderer: 'preact'`.",
    )
  }
  return pageRenderer
}
