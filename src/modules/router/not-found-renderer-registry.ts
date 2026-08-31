import { InternalError } from '@zanix/errors'
import type { HeadDescriptor } from './head-descriptor.ts'
import type { Messages } from '../i18n/load-messages.ts'

/**
 * Everything a `NotFoundRenderer` needs to produce a not-found document, with no renderer-specific
 * type in sight — the same separation `DocumentModel` (`render/document-model.ts`) establishes for
 * pages, applied to the one other document this framework renders on its own.
 *
 * `NotFound`/`RootLayout` are `unknown` for the reason `app-shell-registry.ts` already documents:
 * each holds either a React or a Preact component depending on `defineSpaceApp({ renderer })`, and
 * the two are nominally incompatible types. Each concrete renderer casts them back to its own real
 * type at the point of use.
 */
export type NotFoundRenderContext = {
  /** The app's own `not-found.tsx` default export, or this package's built-in fallback view. */
  NotFound: unknown
  /** The app's own root `layout.tsx`, if `loadRoutes()` found one. */
  RootLayout: unknown
  /** The head to resolve for this document — the app's own `not-found.tsx` named `head` export when
   * it declares one, otherwise this package's own default. Resolved by the renderer through the
   * SAME `resolveHead` every page uses; there is no not-found-specific head mechanism. */
  head: HeadDescriptor | undefined
  /** `true` for an Orbit navigation that hit a 404 — returns just the outlet fragment. */
  fragmentOnly: boolean
  /** This request's resolved language, if this app calls `langPreHandler(...)` — resolved via
   * `resolveRequestLang` (cookie → `Accept-Language` → `defaultLang`), since a 404 has no matched
   * route to read a `:lang` param from. `undefined` when no `langPreHandler` is registered at
   * all. Passed straight through to the app's own `not-found.tsx`, if it accepts it. */
  lang: string | undefined
  /** `not-found-handler.ts`'s own `loadMessages({ lang })` result, resolved lazily — only once a
   * 404 is actually being rendered. See `NotFoundProps.messages`'s own doc for the full contract. */
  messages?: Messages
}

/**
 * Renders a not-found response. Both `render-not-found-react.tsx` and `render-not-found-preact.ts`
 * export a function of exactly this shape named `renderNotFoundResponse`; whichever is registered
 * here is what `createNotFoundHandler` runs, and that handler never imports either by name.
 *
 * The same indirection `page-renderer-registry.ts` uses for pages, and for the same reason: it is
 * what makes "a 404 is just another document" true structurally rather than by convention. Before
 * it, `createNotFoundHandler` imported React's renderer directly and threw outright under
 * `--renderer=preact`, so a Preact app had no not-found page at all — it fell through to
 * `@zanix/server`'s own JSON error response, and only discovered that on the first real 404 in
 * production.
 */
export type NotFoundRenderer = (context: NotFoundRenderContext) => Promise<Response>

// No default, for the reason `page-renderer-registry.ts` states in full: `@zanix/space` ships no
// renderer implementation at all, so neither registry may name one. Installed from
// `@zanix/space/react` or `@zanix/space/preact` via `installRendererRuntime`.
let notFoundRenderer: NotFoundRenderer | undefined

/**
 * Switches the active `NotFoundRenderer` — called by `installRendererRuntime` when a renderer entry
 * point is imported, alongside the page renderer and the Comet element factory. Never called by an
 * app directly.
 */
export function setNotFoundRenderer(renderNotFound: NotFoundRenderer): void {
  notFoundRenderer = renderNotFound
}

/**
 * Read by `createNotFoundHandler` — see {@linkcode NotFoundRenderer}'s own doc.
 *
 * @throws {InternalError} When no renderer entry point has been imported — the same single fix as
 * `getPageRenderer`'s own, and deliberately no fallback.
 */
export function getNotFoundRenderer(): NotFoundRenderer {
  if (!notFoundRenderer) {
    throw new InternalError(
      'No renderer is installed, so a not-found document cannot be rendered: `@zanix/space` ' +
        "itself contains no renderer implementation, by design. Import this project's own " +
        "renderer entry point once, from its main module — `import '@zanix/space/react'` or " +
        "`import '@zanix/space/preact'`, matching `defineSpaceApp({ renderer })`.",
    )
  }
  return notFoundRenderer
}

/** This package's own default not-found head, used when the app's `not-found.tsx` declares no
 * `head` export of its own (and when it has no `not-found.tsx` at all).
 *
 * A plain default value, not a rule: nothing in this framework requires a 404 document to carry a
 * title, and no validation treats it differently from any other document. This exists only so the
 * built-in fallback produces a complete document rather than an untitled one, and any app can
 * replace it by exporting `head` from its own `not-found.tsx`. */
export const DEFAULT_NOT_FOUND_HEAD: HeadDescriptor = { title: 'Page not found' }
