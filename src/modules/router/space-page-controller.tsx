import type { ComponentType, ReactElement } from 'react'
import { Suspense } from 'react'
import type {
  ClassConstructor,
  GuardContext,
  HandlerContext,
  ZanixInteractorGeneric,
} from '@zanix/server'
import type { PageActionContext, PageContext, RedirectConfig } from 'typings/page.ts'

import { ZanixSsrController } from '@zanix/server'
import { HttpError } from '@zanix/errors'
import { renderToResponse } from '../render/render-to-response.tsx'
import { resolveCssHrefs } from '../render/css-manifest.ts'
import { resolvePwaHead } from '../pwa/pwa-registry.ts'
import { isDevClientEnabled } from '../dev/dev-client-registry.ts'
import { computeEtag } from './etag.ts'
import { SpaceErrorBoundary } from './error-boundary.tsx'
import { getPageTree } from './page-tree-registry.ts'
import { applyDocumentShell } from './document-shell.tsx'
import { ORBIT_FRAGMENT_HEADER, ORBIT_OUTLET_ATTR } from './orbit-protocol.ts'
import type { CspDirectives } from '../middleware/csp-guard.ts'
import { CSP_NONCE_LOCALS_KEY, cspGuard } from '../middleware/csp-guard.ts'
import type { SecurityHeadersOptions } from '../middleware/security-headers-guard.ts'
import { securityHeadersGuard } from '../middleware/security-headers-guard.ts'
import { CSRF_TOKEN_LOCALS_KEY } from '../middleware/csrf-guard.ts'
import { resolvePageHeaders } from './default-page-headers.ts'

/** `Page()`'s combined header options — `SecurityHeadersOptions`'s own flat fields (`frameOptions`,
 * `referrerPolicy`, ...) plus `csp`, all under one `headers` option. `csp` is kept as its own field
 * rather than flattened further only because it needs its own nested shape (a full
 * `Content-Security-Policy` directive map, or a nonce-generating function) — everything that's
 * genuinely just "one response header, one value" already lives directly on `SecurityHeadersOptions`. */
export type PageHeaderOptions = SecurityHeadersOptions & {
  /**
   * `Content-Security-Policy` for this page. Omit for the default nonce-based policy
   * (`default-src 'self'; script-src 'self' 'nonce-<per-request>'`) — safe with this framework's
   * own inline initial-state script, since the nonce is coordinated automatically (see `cspGuard`'s
   * own doc). Pass a `CspDirectives` object for a fully custom, static policy — note that a custom
   * policy loses the automatic nonce coordination: if it restricts `script-src`, either permit
   * `'unsafe-inline'` or build your own nonce-based policy with `cspGuard`'s function form. `false`
   * disables CSP for this page while leaving the rest of `headers` in effect.
   */
  csp?: CspDirectives | ((nonce: string) => CspDirectives) | false
}

/** `Page()`'s own default CSP, applied whenever `headers.csp` is left unset — nonce-based (not
 * `'unsafe-inline'`) specifically so it doesn't conflict with `renderToResponse`'s own inline
 * initial-state script; see `cspGuard`'s nonce-generating form for how the two stay in sync. */
const DEFAULT_CSP_DIRECTIVES = (nonce: string): CspDirectives => ({
  'default-src': ["'self'"],
  'script-src': ["'self'", `'nonce-${nonce}'`],
})

/**
 * Applies this page's `headers` choice to `ctx`/the eventual response — calls
 * `cspGuard`/`securityHeadersGuard` as plain functions, deliberately NOT via `@Guard`/
 * `registerGlobalGuard`: those require a real TC39 decorator `context` to know they're registering
 * a class-level guard, which `Page()` (an imperative call, not `@Guard` class-decorator syntax)
 * never has — see `registerPage`'s own doc in `page-decorator.ts` for the full explanation. A guard
 * is, at the end of the day, just a plain function; nothing about calling it directly is unusual.
 *
 * Returns the headers to merge into the response, and the nonce (if any) to forward to
 * `renderToResponse`. `headers: false` skips everything (CSP included) for this page.
 */
async function applySecurityGuards(
  ctx: HandlerContext,
  headers: PageHeaderOptions | false | undefined,
): Promise<{ headers: Record<string, string>; nonce: string | undefined }> {
  if (headers === false) return { headers: {}, nonce: undefined }

  const { csp, ...securityHeaderOptions } = headers ?? {}
  const merged: Record<string, string> = {}

  if (csp !== false) {
    // `cspGuard` only ever reads `ctx.locals` — a plain `HandlerContext` already satisfies that,
    // the extra `GuardContext` fields (interactors/providers/connectors) are never touched. Both
    // guards below are actually synchronous, but `MiddlewareGuard`'s own type allows an async
    // implementation too, so this awaits rather than assuming.
    const { headers: cspHeaders } = await cspGuard(csp ?? DEFAULT_CSP_DIRECTIVES)(
      ctx as GuardContext,
    )
    Object.assign(merged, cspHeaders)
  }

  const { headers: securityHeaders } = await securityHeadersGuard(securityHeaderOptions)(
    ctx as GuardContext,
  )
  Object.assign(merged, securityHeaders)

  return { headers: merged, nonce: ctx.locals[CSP_NONCE_LOCALS_KEY] as string | undefined }
}

// Re-exported (not just imported) because this class's own public signature references both:
// `handleGet`'s `ctx` parameter is a `HandlerContext`, and — via `ZanixSsrController`'s own extends
// clause — `ZanixSsrController` itself is this class's base. `HandlerContext`'s own chain (its
// payload/session/base-context shapes) terminates cleanly — verified via `deno doc --lint`, not
// assumed. `ZanixSsrController`'s does not: its `Interactor` generic reaches (through
// `ZanixInteractorGeneric`) `ZanixInteractor`, whose base class exposes a getter for every concrete
// core connector/provider `@zanix/server` ships (cache, database, search, KV, worker, async queue —
// a dozen-plus types with no natural stopping point). Re-exporting that entire surface here just to
// silence one class's inherited base would mean this package re-publishing a large slice of
// `@zanix/server`'s own API surface it doesn't otherwise use — accepted as a structural limit of
// extending a base class from another package, the same category as `spacePlugin`'s own accepted
// `Plugin` finding (see `bundler/space-plugin.ts`).
export type { HandlerContext }
export { ZanixSsrController }

function toPageContext<Params>(ctx: HandlerContext): PageContext<Params> {
  return {
    request: ctx.req,
    params: ctx.payload.params as Params,
    url: ctx.url,
    csrfToken: ctx.locals[CSRF_TOKEN_LOCALS_KEY] as string | undefined,
  }
}

function buildRedirectResponse(redirect: RedirectConfig, requestUrl: URL): Response {
  const location = new URL(redirect.to, requestUrl).href
  return new Response(null, { status: redirect.code ?? 301, headers: { location } })
}

/**
 * Wraps `element` in its page's composition chain (root directory first) — each segment's own
 * `error.tsx` boundary around its own `loading.tsx` Suspense fallback around its own `layout.tsx`,
 * built from the leaf directory outward so the root layout ends up outermost.
 *
 * A segment with an `error.tsx` but no `loading.tsx` still gets wrapped in a `Suspense` (with a
 * `null` fallback) — not for a loading state, but because React's server renderer only recovers a
 * thrown error into an already-mounted error boundary for content that lives *inside* a `Suspense`
 * boundary; a synchronous throw in the plain, un-suspended "shell" is always fatal to the whole
 * response, no matter how many error boundaries sit above it. See `SpaceErrorBoundary`'s own doc
 * for what actually happens once that boundary IS reachable (it isn't a same-request fallback).
 *
 * **The root layout owns the document, same contract as Next.js's own App Router**: the outermost
 * segment's `layout.tsx` (root `routesDir`, or a page never routed through `loadRoutes()` at all,
 * which has no segments to speak of) is applied by `applyDocumentShell` below, not by this loop —
 * shared with `createNotFoundHandler`'s own not-found page, which has no segment loop of its own
 * but still needs the exact same root-layout-or-default-shell decision.
 *
 * Everything below the root layout is wrapped in a marker (`ORBIT_OUTLET_ATTR`) Orbit's client
 * runtime uses as its navigation swap target — a header/footer/nav living in the root layout
 * itself stays outside that marker, so Orbit never re-fetches or re-renders it.
 *
 * @param fragmentOnly - `true` for an Orbit navigation request (see `ORBIT_FRAGMENT_HEADER`):
 * returns just the outlet's own content, skipping the root layout and document shell entirely,
 * since Orbit only ever swaps what's already inside them on the client.
 */
function composeSegments<Params>(
  Target: ClassConstructor<SpacePageController>,
  element: ReactElement,
  params: Params,
  fragmentOnly: boolean,
): ReactElement {
  const segments = getPageTree(Target)?.segments ?? []

  let node = element
  for (let i = segments.length - 1; i >= 0; i--) {
    const { layout: Layout, loading: Loading, error: ErrorFallback } = segments[i]
    if (Loading) {
      node = <Suspense fallback={<Loading />}>{node}</Suspense>
    } else if (ErrorFallback) {
      node = <Suspense fallback={null}>{node}</Suspense>
    }
    if (ErrorFallback) {
      node = <SpaceErrorBoundary fallback={ErrorFallback}>{node}</SpaceErrorBoundary>
    }
    if (Layout && i !== 0) {
      node = <Layout params={params as unknown as Record<string, string>}>{node}</Layout>
    }
  }

  // `display: contents` so this outlet never breaks a root layout's own `display: grid`/`flex`
  // layout by inserting an extra box between it and its real children.
  const outlet = <div style={{ display: 'contents' }} {...{ [ORBIT_OUTLET_ATTR]: '' }}>{node}</div>
  if (fragmentOnly) return outlet

  return applyDocumentShell(
    segments[0]?.layout,
    outlet,
    params as unknown as Record<string, string>,
  )
}

/**
 * Builds and renders a page's full element tree — a plain function, never a class member (`private`
 * doesn't exempt a method from `HandlerBaseClass`'s instance-member index signature; only moving it
 * off the class entirely does).
 */
function renderPageResponse<Params>(
  Target: ClassConstructor<SpacePageController>,
  // deno-lint-ignore no-explicit-any
  Component: ComponentType<any>,
  pageCtx: PageContext<Params>,
  data: unknown,
  fragmentOnly: boolean,
  nonce: string | undefined,
): Promise<Response> {
  const element = composeSegments(
    Target,
    <Component {...(data as Record<string, unknown>)} />,
    pageCtx.params,
    fragmentOnly,
  )
  // A fragment is only ever inserted into an already-hydrated (or about to be) page by Orbit's own
  // client runtime — it never needs the initial-state script a full document's own hydration reads,
  // nor therefore the nonce that script would otherwise need, nor a stylesheet link, PWA head, or
  // dev client script: all page-independent (or, for the dev client, already connected from the
  // full document it's swapping into), already in effect on the page it's swapping into.
  return renderToResponse(
    element,
    fragmentOnly ? {} : {
      initialState: data,
      nonce,
      cssHrefs: resolveCssHrefs(),
      pwaHead: resolvePwaHead(),
      devClient: isDevClientEnabled()
        ? { routeFilePath: getPageTree(Target)?.filePath }
        : undefined,
    },
  )
}

/**
 * The extra instance-member shapes `SpacePageController` needs beyond what `ZanixSsrController`
 * already allows (`HandlerContext`-shaped dispatch methods) — passed as `ZanixSsrController`'s own
 * `Extensions` type parameter. `HandlerBaseClass` (the root of every Zanix handler, REST/Socket/SSR
 * alike) constrains every instance member to a closed set of shapes via a string-indexed type, so
 * declaring `loader`/`action`/`component` at all requires naming their shapes here explicitly —
 * including `undefined`, since `loader`/`action` are optional members. `redirect`/`cacheControl`
 * (below) don't need a place here: they're declared `static`, and `HandlerBaseClass`'s index
 * signature only constrains instance members, never a class's own static properties.
 */
export type SpacePageExtensions<Params> =
  | undefined
  | ((ctx: PageContext<Params>) => unknown | Promise<unknown>)
  | ((ctx: PageActionContext<Params>) => Promise<Response>)
  // deno-lint-ignore no-explicit-any
  | ComponentType<any>

/**
 * Base class for a file-based page — the shape a `routes/**\/page.tsx` file's default export
 * extends. Separates a page's three concerns into distinct, independently testable members instead
 * of fusing them into one handler function:
 *
 * - `loader` (optional) — fetches the data the page needs. A plain async function, testable without
 *   rendering anything.
 * - `component` (required) — the actual UI, receiving whatever `loader` returned as props. Testable
 *   with any standard React testing setup.
 * - `action` (optional) — handles a form submission (`POST`) to this same route. Real HTTP, not an
 *   RPC — a plain `<form>` posting to this route works even without client-side JavaScript.
 *
 * Register a subclass with the `Page()` decorator, which wires `handleGet`/`handlePost` (below) to
 * `GET`/`POST` — a page never calls or overrides them directly. Both are always registered,
 * regardless of whether the page declares `action`: `loader`/`action`/`component` must be declared
 * as class-field arrow functions (`loader = (ctx) => {}`), not methods (`async loader(ctx) {}`) —
 * TypeScript requires an optional member's shape to stay consistent between a base class and its
 * subclasses, and this base class declares them as fields — so whether a page's `action` exists
 * can only be checked per-request, from a real instance (see `handlePost`), never at the class level
 * the moment `Page()` runs. A `POST` to a page with no `action` responds `405`.
 *
 * A page's `layout.tsx`/`loading.tsx`/`error.tsx` (sibling files in the same `routesDir` directory,
 * or any ancestor of it) are never declared on the class itself — `loadRoutes()` discovers them
 * from the file tree and `handleGet` composes them around `component` automatically.
 *
 * @template Params - The shape of the route's dynamic segments (e.g. `{ id: string }` for a
 * `[id]/page.tsx` file).
 * @template Interactor - A `ZanixInteractor` subclass, made available as `this.interactor` — the
 * correct place for a page's own data/cache access beyond what a plain `loader` needs (e.g. its
 * own `this.cache` sugar getter, resolving `@zanix/server`'s abstract `ZanixCacheProvider`, from
 * inside the interactor's own methods; a `SpacePageController` is a Handler, and Handlers never
 * resolve Providers/Connectors directly — same layering every other Zanix handler already
 * follows). Defaults to `never` (no interactor), same as a bare `ZanixSsrController`. Pass one via
 * `@Page({ Interactor })` — see that decorator's own doc.
 */
export abstract class SpacePageController<
  Params = Record<string, string>,
  Interactor extends ZanixInteractorGeneric = never,
> extends ZanixSsrController<Interactor, SpacePageExtensions<Params>> {
  /**
   * Redirects the request before `loader`/`component` ever run — declared once per page, evaluated
   * on every `GET`. Omit for a page that never redirects.
   */
  public static redirect?: RedirectConfig
  /**
   * Sets the `Cache-Control` header on this page's response and enables an automatic `ETag`,
   * computed from `loader`'s resolved data (see `computeEtag`'s own doc for why not the rendered
   * HTML). A request whose `If-None-Match` matches gets a bodyless `304` instead of a full render.
   * Omit for a page with no HTTP caching.
   */
  public static cacheControl?: string
  /**
   * Response headers for this page — `Content-Security-Policy` (via the `csp` field, defaulting to
   * a nonce-based policy safe with this framework's own inline initial-state script — see
   * `PageHeaderOptions.csp`'s own doc) plus common security headers (`X-Frame-Options`,
   * `Referrer-Policy`, `X-Content-Type-Options`, ...), defaulting to `securityHeadersGuard`'s own
   * defaults. Set `false` to disable every one of these for this page (CSP included); set
   * `{ csp: false, ... }` to disable just CSP while keeping the rest. Set via `Page({ headers })`,
   * not assigned by hand.
   */
  public static headers?: PageHeaderOptions | false

  /** Fetches this page's data. Runs before `component` renders — never touches React itself. */
  public loader?: (ctx: PageContext<Params>) => unknown | Promise<unknown>
  /** Handles a `POST` to this route (typically a `<form>` submission). Real HTTP, not an RPC. */
  public action?: (ctx: PageActionContext<Params>) => Promise<Response>
  /** The page's UI — receives `loader`'s return value (or `undefined`, if there's no loader) as props. */
  // deno-lint-ignore no-explicit-any
  public abstract component: ComponentType<any>

  /**
   * Wired to `GET` by `Page()` — evaluates `redirect`, then runs `loader` (if declared), then
   * renders `component` (wrapped in this page's layout/loading/error composition chain, if any).
   * When `cacheControl` is set, a matching `If-None-Match` short-circuits to `304` before any
   * rendering happens. A request carrying `ORBIT_FRAGMENT_HEADER` (Orbit's own client-side
   * navigation, never something an app sends by hand) gets just the outlet fragment instead of a
   * full document — see `composeSegments`'s own doc. Not meant to be called or overridden directly.
   */
  public async handleGet(ctx: HandlerContext): Promise<Response> {
    const Ctor = this.constructor as typeof SpacePageController
    const pageCtx = toPageContext<Params>(ctx)
    const fragmentOnly = ctx.req.headers.has(ORBIT_FRAGMENT_HEADER)
    // Precedence: this page's own `headers` field by field > the app-wide default (set via
    // `defineSpaceApp({ headers })`) field by field > `applySecurityGuards`'s own built-in default
    // — see `resolvePageHeaders`'s own doc for why this has to be a field-by-field merge, not a
    // whole-object fallback (a page overriding one field would otherwise silently lose every other
    // field the app configured).
    const headers = resolvePageHeaders(Ctor.headers)
    // `nonce` is `undefined` when CSP is disabled for this page, or a custom static policy (no
    // nonce coordination) is set — see `SpacePageController.headers`'s own doc.
    const { headers: securityHeaders, nonce } = await applySecurityGuards(ctx, headers)
    const applySecurity = (response: Response): Response => {
      for (const [key, value] of Object.entries(securityHeaders)) response.headers.set(key, value)
      return response
    }

    const { redirect } = Ctor
    if (redirect && (redirect.condition?.(pageCtx as PageContext<unknown>) ?? true)) {
      return applySecurity(buildRedirectResponse(redirect, pageCtx.url))
    }

    const data = await this.loader?.(pageCtx)

    const Target = Ctor as unknown as ClassConstructor<SpacePageController>

    const { cacheControl } = Ctor
    if (cacheControl) {
      const etag = await computeEtag(data)
      // A full document and an Orbit fragment share the same ETag (both derive it from the same
      // loader data) but never the same body — `Vary` is what keeps a cache (browser or otherwise)
      // from serving one shape to a request that asked for the other.
      const headers = { etag, 'cache-control': cacheControl, vary: ORBIT_FRAGMENT_HEADER }
      if (ctx.req.headers.get('if-none-match') === etag) {
        return applySecurity(new Response(null, { status: 304, headers }))
      }
      const response = await renderPageResponse(
        Target,
        this.component,
        pageCtx,
        data,
        fragmentOnly,
        nonce,
      )
      for (const [key, value] of Object.entries(headers)) response.headers.set(key, value)
      return applySecurity(response)
    }

    return applySecurity(
      await renderPageResponse(Target, this.component, pageCtx, data, fragmentOnly, nonce),
    )
  }

  /**
   * Wired to `POST` by `Page()` — always registered, even for a page with no `action`, since that
   * can only be known from a real instance (see this class's own doc). Not meant to be called or
   * overridden directly.
   *
   * @throws {HttpError} `'METHOD_NOT_ALLOWED'` if the page declares no `action`.
   */
  public async handlePost(ctx: HandlerContext): Promise<Response> {
    const { action } = this
    if (!action) {
      throw new HttpError('METHOD_NOT_ALLOWED', {
        id: ctx.id,
        meta: { target: this.constructor.name },
      })
    }
    const pageCtx: PageActionContext<Params> = {
      ...toPageContext<Params>(ctx),
      formData: () => ctx.req.formData(),
    }
    return await action(pageCtx)
  }
}
