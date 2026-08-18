/**
 * The request-scoped context every `SpacePageController` method receives — a narrower, page-shaped
 * view over the underlying request (`req`/`url`/route `params`), independent of the specific server
 * kernel serving it.
 *
 * @module
 */
import type { SpaceChildren } from './renderable.ts'

/**
 * **There is deliberately no `kind` / `PageKind` on a page, and this note exists so the question is
 * not reopened without new information.**
 *
 * A `static kind = 'endpoint'` was implemented, to let a route declare itself "not a document" and
 * be exempted from document-level build validation. It was removed on review, because the state it
 * described cannot occur:
 *
 * - `SpacePageController.handleGet` has exactly four exits — a redirect, a `304`, and two render
 *   paths — and every one of them produces an HTML document or a response standing in for one.
 *   There is no path by which a page's `GET` returns something that is not a document. A page that
 *   exists only for its `action` still serves a real document on `GET`, and that document wants a
 *   title as much as any other.
 * - It could not have been inferred either, had it been needed: `component`/`action` are instance
 *   class fields, so nothing about them is readable from the class at discovery time (see this
 *   package's own note on why `handlePost` checks for `action` per-request).
 *
 * So it would have been a public API, written by hand, expressing a condition the framework cannot
 * produce — a second source of truth for a question that has no second answer. The two real
 * exemption needs are already met without it: an unconditional `redirect` is INFERRED during
 * discovery (that page never renders), and a project excludes anything else by route pattern
 * through `defineSpaceApp({ validation: { exempt } })`, which is policy and belongs to the project
 * rather than to each page.
 */

/**
 * Context passed to a page's `loader()`.
 *
 * @template Params - The shape of the route's dynamic segments (e.g. `{ id: string }` for a
 * `[id]/page.tsx` file), as declared on the `SpacePageController` subclass.
 */
export type PageContext<Params = Record<string, string>> = {
  /** The raw incoming request. */
  request: Request
  /** The route's dynamic segments, extracted from the file-based route path. */
  params: Params
  /** The full request URL, already parsed. */
  url: URL
  /** The CSRF token issued for this request, if `csrfGuard` ran (via `defineMiddleware`/`@Guard` —
   * it's opt-in, not applied by `Page()`'s own defaults) — `undefined` otherwise. Hand it to
   * `component` (via `loader`'s return value) to render as a hidden `_csrf` form field; see
   * `csrfGuard`'s own doc for the full pattern. */
  csrfToken?: string
  /** The population (segment/tenant variant) resolved for this request, if `populationGuard` ran
   * (same opt-in mechanism as `csrfGuard`) — `undefined` otherwise. Use it in `loader` to pick the
   * right content override; see `populationGuard`'s own doc for the resolution order. */
  population?: string
  /**
   * Present ONLY when this render is the response to an `action` whose payload failed validation —
   * a real POST that came back as the re-rendered page with status `422`. **Always `undefined` on
   * a GET, and on any successful action.**
   *
   * The page's own `loader` receives it and decides how to surface it, exactly the way it already
   * forwards {@linkcode PageContext.csrfToken} into its component's props. That reuse is
   * deliberate: no flash, no session, no redirect and no second mechanism.
   *
   * **This is not a form-state system.** It is one field on the page context, populated for one
   * render, carrying the validator's own output. There is no form store, no submission lifecycle,
   * no client-side binding and no action-result protocol behind it — and none is planned.
   */
  fieldErrors?: PageFieldErrors
  /**
   * The values the user actually submitted, alongside {@linkcode PageContext.fieldErrors}, so the
   * re-rendered form can be filled back in rather than cleared — the user never retypes what they
   * already sent.
   *
   * Exactly the submitted string fields, as parsed from the request body; file entries are not
   * included. Same lifetime and delivery path as `fieldErrors`: present only on a `422` action
   * re-render, **`undefined` on every GET and on any successful action**.
   */
  submitted?: Record<string, string>
}

/**
 * `@zanix/validator`'s own formatted validation failures, passed through untouched.
 *
 * Space deliberately does NOT define this shape. It is whatever the validator produced — keyed by
 * the RTO property that failed, each entry carrying that property's own `constraints` messages
 * plus the offending `value`/`plainValue`, and nesting under `{ message, properties }` for a
 * nested RTO. Reproducing it here would mean owning a format the ecosystem already owns, and it
 * would drift the first time the validator changed.
 *
 * ```ts
 * { email: [{ constraints: ["'email' must be a valid email address."], value: 'nope', plainValue: 'nope' }] }
 * ```
 */
export type PageFieldErrors = Record<string, unknown>

/**
 * Context passed to a page's `action()` — a `PageContext` extended with access to the submitted
 * form data, since an action only ever runs in response to a real HTTP `POST`.
 *
 * @template Params - See {@linkcode PageContext}.
 */
export type PageActionContext<Params = Record<string, string>, Body = unknown> =
  & PageContext<Params>
  & {
    /** Reads the submitted form data. Lazy — only parses the body once actually called. */
    formData: () => Promise<FormData>
    /**
     * The submitted body, already validated and transformed by the RTO the page declared in
     * `@Page({ action: { Body } })` — a real instance of that RTO class, not raw `FormData` and
     * not `FormDataEntryValue | null`.
     *
     * `undefined` when the page declared no RTO, which is the unchanged default: an action without
     * validation keeps using `formData()` exactly as before. The validation itself is
     * `@zanix/validator`'s (`classValidation`), never a second implementation living here — see
     * `SpacePageController.handlePost` for the seam and why it runs there rather than as a pipe.
     */
    body?: Body
  }

/**
 * A page's static `redirect` — evaluated by `SpacePageController.handleGet` before `loader`/
 * `component` ever run, so a redirected request never pays for data fetching or rendering.
 */
export type RedirectConfig = {
  /** The path or URL to redirect to. Resolved against the incoming request's own URL when relative. */
  to: string
  /** The HTTP redirect status code. Defaults to `301`. */
  code?: 301 | 302 | 307 | 308
  /** Evaluated against the request before redirecting. The redirect applies whenever this returns
   * `true`, or unconditionally when omitted. */
  condition?: (ctx: PageContext<unknown>) => boolean
}

/**
 * Props passed to a `layout.tsx` file's default export — a plain component wrapping every page
 * (and every nested layout) under its own directory. Never a route of its own.
 *
 * A `layout.tsx` may ALSO export a named `head` — a `HeadDescriptor` (`router/head-descriptor.ts`),
 * or a function of this SAME `params` receiving it — merged with every other segment's own `head`
 * and the page's own `SpacePageController.head` (most specific wins, see `resolveHead`'s own doc):
 * ```ts
 * // routes/products/layout.tsx
 * export const head = () => ({ title: 'Products' })
 * export default function ProductsLayout({ children }: LayoutProps) { ... }
 * ```
 *
 * @template TChildren - What this layout receives as `children`. Defaults to
 * {@linkcode SpaceChildren} — the renderer-neutral renderable type, assignable to React's own
 * `ReactNode` and to Preact's own `ComponentChildren` alike, so `export default function
 * RootLayout({ children }: LayoutProps)` type-checks unchanged under EITHER renderer, with no type
 * argument and no cast. It used to default to React's `ReactNode`, which made a Preact layout the
 * only one that had to spell the parameter out, and made this module — a description of what a
 * page is — import React.
 *
 * Naming a renderer's own type explicitly (`LayoutProps<ReactNode>`, `LayoutProps<ComponentChildren>`)
 * still works and is exactly what this package's own renderer boundaries do (`document-shell.tsx`,
 * `document-shell-preact.ts`). A layout needs it only for something the neutral type deliberately
 * cannot express — see {@linkcode SpaceChildren}'s own doc for the one such case (a bare `Promise`
 * child under React 19).
 */
export type LayoutProps<TChildren = SpaceChildren> = {
  children: TChildren
  /** The route's dynamic segments, as raw strings — never narrowed to a specific page's own
   * `Params` generic, since a single layout can wrap pages with different param shapes. */
  params: Record<string, string>
}

/**
 * Props passed to an `error.tsx` file's default export — the fallback UI for the nearest error
 * boundary above a segment that threw during render.
 */
export type ErrorBoundaryProps = {
  /** The error that was thrown. */
  error: unknown
  /** Clears the error and re-renders the segment's children — usually wired to a "try again" button. */
  reset: () => void
}
