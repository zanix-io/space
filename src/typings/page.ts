/**
 * The request-scoped context every `SpacePageController` method receives — a narrower, page-shaped
 * view over the underlying request (`req`/`url`/route `params`), independent of the specific server
 * kernel serving it.
 *
 * @module
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
}

/**
 * Context passed to a page's `action()` — a `PageContext` extended with access to the submitted
 * form data, since an action only ever runs in response to a real HTTP `POST`.
 *
 * @template Params - See {@linkcode PageContext}.
 */
export type PageActionContext<Params = Record<string, string>> = PageContext<Params> & {
  /** Reads the submitted form data. Lazy — only parses the body once actually called. */
  formData: () => Promise<FormData>
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
 */
export type LayoutProps = {
  children: import('react').ReactNode
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
