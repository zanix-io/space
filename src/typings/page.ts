/**
 * The request-scoped context every `SpacePageController` method receives — a narrower, page-shaped
 * view over the underlying request (`req`/`url`/route `params`), independent of the specific server
 * kernel serving it.
 *
 * @module
 */
import type { SpaceChildren } from './renderable.ts'
import type { serializeError } from '@zanix/errors'
import type { Messages } from '../modules/i18n/load-messages.ts'

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
   * Dedupes an async fetch, by `key`, across every `loader` this SAME request's composition chain
   * runs — the page's own AND every `layout.tsx`'s own (see `LayoutProps.data`'s own doc for how
   * segment-level loaders share this exact `ctx` object). The first call for a given `key` runs
   * `fetcher()` and caches its promise; every later call for that key, from ANY of those loaders,
   * gets that same promise back instead of triggering a second fetch.
   *
   * This exists because segment-level loaders made a real duplicate-fetch case possible that could
   * not occur before them: two independent loaders — a page's own and a `layout.tsx` wrapping it —
   * each wanting the same underlying data, with no shared scope between two separate files to
   * coordinate through by hand. Renderer-neutral by construction: a `loader` is a plain async
   * function that always runs BEFORE rendering starts, on EITHER renderer, so nothing here needs to
   * know or care which one is active.
   *
   * **Not** `render/request-cache.tsx`'s `useRequestCache` — that dedupes a fetch issued FROM
   * INSIDE COMPONENT RENDER, via React's `use()`/`Suspense` (deliberately React-only — see that
   * function's own doc for why no Preact counterpart is possible, not just unbuilt). This solves a
   * different problem than that one: across LOADERS, not across components, which is exactly what
   * makes it renderer-neutral where that one cannot be.
   *
   * Request-scoped only — discarded once this request finishes, same lifetime as `csrfToken`/
   * `population` above. Not a general application cache; for anything that should outlive a single
   * request, use `@zanix/server`'s own cache provider (`this.cache`, reached through a page's own
   * `Interactor` — see `PageOptions.Interactor`'s own example, `router/page-decorator.ts`).
   *
   * @template T - The fetcher's own resolved type — inferred from `fetcher`, never declared by hand.
   * @param key - Unique within this request; two loaders wanting the SAME key must mean the SAME
   * underlying data (e.g. `'current-user'`), the same responsibility a cache key always carries.
   * @param fetcher - Invoked at most once per request for a given `key` — never called again once
   * something (a resolved value OR a rejection) is cached under it.
   * @returns `fetcher()`'s own resolved value — its rejection, unchanged, propagates identically to
   * every caller of the same `key`, exactly as an un-deduped `await fetcher()` would to its own
   * single caller.
   */
  dedupe: <T>(key: string, fetcher: () => Promise<T>) => Promise<T>
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
    /**
     * The real, underlying request's `locals` — the SAME object `@zanix/server` itself reads/
     * writes throughout the request pipeline, not a copy (unlike `csrfToken`/`population` above,
     * which are one-way SNAPSHOTS read out of it at context-build time). Exposed specifically for
     * an action that needs to issue or mutate a session mid-request (a login/OTP/OAuth2 callback
     * page calling `@zanix/auth`'s `generateSessionTokens(ctx, ...)`/`refreshSessionTokens`/etc.,
     * all of which write onto `ctx.locals.session` and expect `sessionHeadersInterceptor` —
     * registered globally by that package's own `/core` entrypoint — to read it back afterward and
     * set the response cookie). Confirmed there is no other way to reach this from a page's own
     * `action`: `PageContext`'s other fields are all curated, read-only snapshots by design.
     */
    locals: Record<string, unknown>
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
 * A `layout.tsx` may ALSO export a named `loader` — a function of {@linkcode PageContext} (the
 * exact same context shape a page's own `loader` receives, including `request`/`url`/`csrfToken`),
 * resolving to whatever this layout wants as its own {@linkcode LayoutProps.data}:
 * ```ts
 * // routes/dashboard/layout.tsx
 * export const loader = (ctx: PageContext) => getCurrentUser(ctx.request)
 * export default function DashboardLayout({ children, data }: LayoutProps<SpaceChildren, User>) { ... }
 * ```
 * Every segment's own `loader` in a page's composition chain resolves in PARALLEL — via a single
 * `Promise.all`, never sequentially, and never depending on another segment's own `data` — the same
 * "no waterfalls" property the page's own single loader already has, just extended per segment
 * rather than reproducing RSC's arbitrary-depth per-component fetching. A segment's `loader`
 * throwing behaves exactly like a page's own `loader` throwing: no per-segment try/catch, no
 * partial-render fallback — the throw propagates past `resolveSegmentData` up through the same
 * `await` chain `handleGet` itself runs, where {@linkcode SpacePageController.handleGet}'s own
 * recovery path (`loader-error-handler.ts`) catches it, renders this route's nearest `error.tsx` (or
 * `not-found.tsx`, for an `HttpError('NOT_FOUND')`) with the real HTTP status, falling back to this
 * package's own built-in `DefaultErrorView` when this route declares no `error.tsx` anywhere in its
 * own composition chain. **Root-layout-only exception**: the app-wide root `layout.tsx` used by
 * `createNotFoundHandler`'s own not-found page
 * never runs its `loader` — that page has no route `params`/matched segment chain to build a real
 * `PageContext` from, so its root layout always receives `data: undefined`, whatever `loader` it
 * declares for every OTHER page that shares it.
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
 *
 * @template TData - What this layout's own `loader` resolves to, if it declares one. Defaults to
 * `unknown` — a layout with no `loader` still receives `data: undefined`, never an absent prop (an
 * input's own `value` flipping between present/absent across renders is the same footgun
 * `getActionFieldValue`'s own doc already documents for a page's `submitted`); it simply has nothing
 * useful typed to read from it.
 */
export type LayoutProps<TChildren = SpaceChildren, TData = unknown> = {
  children: TChildren
  /** The route's dynamic segments, as raw strings — never narrowed to a specific page's own
   * `Params` generic, since a single layout can wrap pages with different param shapes. */
  params: Record<string, string>
  /** This layout's own resolved `loader` data — `undefined` when the layout declares no `loader`
   * (the common case), or for the not-found page's own use of the root layout (see this type's own
   * doc). */
  data: TData
}

/**
 * Props passed to an `error.tsx` file's default export — the fallback UI for the nearest error
 * boundary above a segment that threw during render, OR for a page's own `loader` (or a nested
 * layout segment's own `loader`) that threw before render ever started (see
 * `loader-error-handler.ts`'s own doc for the full data-phase recovery contract). `reset` is a
 * client-side retry in the render-phase case (`SpaceErrorBoundary`); for a data-phase throw it is a
 * no-op, since that response is already a fresh server render rather than something to re-render
 * client-side.
 */
export type ErrorBoundaryProps = {
  /** The error that was thrown — always the raw, original value (never assumed to be an `Error`
   * instance; a `loader`/component can throw anything). This package never decides on an app's
   * behalf what's "safe" to do with it — see {@linkcode ErrorBoundaryProps.formattedError} for the
   * one thing it DOES pre-compute, additively, without ever replacing this field. */
  error: unknown
  /**
   * Wired to a "try again" button. By the time this is callable (after `hydrateErrorBoundaries`
   * mounts the Fallback client-side — see that function's own doc for both renderers), this is
   * always `retryOutlet` (`modules/client/orbit.ts`): a real re-fetch/swap of the current page, not
   * a local, in-place re-render of the segment's original children. That's deliberate, not a
   * shortcut — this Fallback was mounted fresh, with no live reference to whatever originally threw,
   * so there is nothing of its own left to retry in-place; only a real round-trip to the server can
   * actually recover.
   */
  reset: () => void
  /** This segment's own resolved route params (e.g. `{ lang: 'en' }`) — the SAME object `Layout`
   * already receives; an `error.tsx` under a `[lang]/...` segment reads `params.lang` from here. */
  params: Record<string, string>
  /**
   * This request's own resolved message catalog (`loadMessages({ lang: params.lang, population })`),
   * already awaited — read `messages['some/key']` directly, no `await` needed inside `error.tsx`
   * itself. `undefined` when this app never declared `messagesDir` in `defineSpaceApp()` at all
   * (`getMessagesDir()` returns nothing to resolve against) — an app with no i18n never pays for
   * this resolution.
   *
   * Resolved and threaded EAGERLY, for every segment that has an `error.tsx`, whether or not that
   * segment actually fails — the same reason `params` above already is: `composeSegments`
   * (`render-page-react.tsx`/`render-page-preact.ts`) writes this segment's postponed-recovery
   * marker BEFORE React/Preact attempts to render it, so by the time a failure is known, it's
   * already too late to resolve anything more for the client-side recovery path
   * (`hydrate-error-boundaries.ts`) to read back. In practice this costs little: `loadMessages`
   * caches per `lang:population` key, so every call after the first for a given combination is a
   * plain in-memory lookup, not a re-read from disk. The one path that IS genuinely lazy is a
   * data-phase (`loader`) failure (`loader-error-handler.ts`) — resolved only inside its own catch,
   * with zero cost for a request whose `loader` never throws.
   */
  messages?: Messages
  /**
   * `error`, run through `@zanix/errors`' own `serializeError` — the EXACT same structured,
   * redacted shape (`name`/`message`/`stack`/`cause`/any own enumerable field like `code`/`meta`)
   * `logger.error(...)` itself logs an error with, and the same one `@zanix/server`'s own HTTP
   * error responses are built from. A convenience, never a replacement for `error` above: an
   * `error.tsx` that wants the exact raw value (a custom `instanceof` check, a non-`Error` payload
   * some app code threw on purpose) still has it; one that just wants something safe and
   * presentable — sensitive fields (tokens, passwords, cookies, `X-Znx-*` headers, ...) already
   * redacted the same way everywhere else in this ecosystem — reads this instead.
   *
   * Completeness varies by WHICH recovery path produced this render, not by renderer:
   * - A data-phase (`loader`) failure, or a Preact render-phase one: the real, original error was
   *   available at render time, so this carries everything `serializeError` can find on it
   *   (`cause` chain, `meta`, `code`, ...).
   * - A React render-phase failure recovered via the client (`hydrateErrorBoundaries` —see
   *   `error-boundary.tsx`'s own doc for why React never renders this Fallback with the real error
   *   in hand): only `name`/`message`/`stack` are ever present, reconstructed from what React's own
   *   postponed-recovery protocol exposes (nothing at all outside a development build — see
   *   `hydrate-error-boundaries.ts`'s own doc) — never a fabricated `cause`/`meta` this package
   *   never actually had.
   */
  formattedError: ReturnType<typeof serializeError>
}

/**
 * Props passed to a `not-found.tsx` file's default export. Unlike `error.tsx`, a 404 has no
 * matched route to draw a `:lang` param from — `lang` is resolved instead via `resolveRequestLang`
 * (cookie → `Accept-Language` → `defaultLang`, the same priority `langPreHandler` itself applies)
 * when this app calls `langPreHandler(...)`; `undefined` when it doesn't. A `not-found.tsx` that
 * doesn't declare this prop at all keeps working unchanged — it's optional, never required.
 */
export type NotFoundProps = {
  /** This request's resolved language, or `undefined` when this app has no `langPreHandler(...)`
   * registered at all. */
  lang?: string
  /**
   * This request's own resolved message catalog (`loadMessages({ lang })`), already awaited — read
   * `messages['some/key']` directly, no `await` needed inside `not-found.tsx` itself. `undefined`
   * when this app never declared `messagesDir` in `defineSpaceApp()` at all.
   *
   * Unlike {@linkcode ErrorBoundaryProps.messages}, this one IS genuinely lazy — a 404 has no
   * Suspense/streaming-recovery mechanism to work around (it always renders synchronously, in the
   * same response, never postponed to the client), so `not-found-handler.ts` only ever resolves
   * this once it already knows a 404 is actually happening, with zero cost otherwise. Resolved
   * from `lang` alone, never `population` — a genuinely unmatched route has no route param/guard
   * result to read one from the way a matched page's own `ctx.population` does.
   */
  messages?: Messages
}
