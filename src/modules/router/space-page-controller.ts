import type { ClassConstructor, HandlerContext, ZanixInteractorGeneric } from '@zanix/server'
import { ZanixSsrController } from '@zanix/server'
import type { PageActionContext, PageContext, RedirectConfig } from 'typings/page.ts'
import type { SpaceComponent } from 'typings/renderable.ts'
import type { HeadDescriptor } from './head-descriptor.ts'
import type { StylesheetRef } from '../render/css-manifest.ts'

import { HttpError } from '@zanix/errors'
import type { RtoTypes } from '@zanix/types'
import type { PageFieldErrors } from 'typings/page.ts'
import { validateActionBody } from './action-validation.ts'
import { renderPageResponse, resolvePageChrome } from './render-page-response.ts'
import { computeEtag } from './etag.ts'
import { ORBIT_FRAGMENT_HEADER } from './orbit-protocol.ts'
import { getPageRenderer } from './page-renderer-registry.ts'
import { CSP_NONCE_LOCALS_KEY, type CspDirectives } from '../middleware/csp-guard.ts'
import type { SecurityHeadersOptions } from '../middleware/security-headers-guard.ts'
import { CSRF_TOKEN_LOCALS_KEY } from '../middleware/csrf-guard.ts'
import { POPULATION_LOCALS_KEY } from '../middleware/population-guard.ts'
import { getThemeResolver } from '../theme/theme-registry.ts'
import { createDedupeCache } from './request-dedupe.ts'
import { renderLoaderErrorPage } from './loader-error-handler.ts'

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
    // `ctx.payload.params` itself is `undefined` (never `{}`) for a route with no dynamic segments
    // at all (e.g. a page under no `[lang]`/`[id]` segment) — defaulted here, the one place this
    // context is built, so nothing downstream (this package's own `composeSegments`/
    // `resolvePageChrome`/`renderLoaderErrorPage`, or an app's own `error.tsx`/`not-found.tsx`
    // reading `params.lang`) has to guard against `undefined` itself. A real, confirmed regression
    // once reached exactly this unguarded property access from three different call sites before
    // being fixed at the source instead.
    params: (ctx.payload.params ?? {}) as Params,
    url: ctx.url,
    csrfToken: ctx.locals[CSRF_TOKEN_LOCALS_KEY] as string | undefined,
    population: ctx.locals[POPULATION_LOCALS_KEY] as string | undefined,
    cspNonce: ctx.locals[CSP_NONCE_LOCALS_KEY] as string | undefined,
    // `ctx.locals.session` wins: it's what a page-level `@Guard` (e.g. `@zanix/auth`'s
    // `jwtValidationGuard`) writes when it resolves a session for THIS route, which runs AFTER
    // `@zanix/server`'s own request-setup pipe already merged whatever session existed earlier onto
    // `ctx.session` — so `ctx.locals.session`, when present, is always the fresher of the two. See
    // `PageContext.session`'s own doc (`typings/page.ts`) for the full contract.
    session: ctx.locals.session ?? ctx.session,
    // One fresh cache per `toPageContext` call — this function runs exactly once per request
    // (`handleGet` for a GET, `handlePost` for a POST — `renderInvalidAction` does NOT call this
    // again; it spreads `handlePost`'s own already-built context, `{ ...actionCtx, fieldErrors,
    // submitted }`, which copies this SAME `dedupe` closure by reference into that new object), so
    // this stays scoped to a single request even though the resulting closure is what threads into
    // every segment's own `loader` too (`resolveSegmentData`, `segment-loader.ts`), which is what
    // makes dedup across them possible at all — see `PageContext.dedupe`'s own doc for the full
    // contract.
    dedupe: createDedupeCache(),
  }
}

function buildRedirectResponse(
  redirect: RedirectConfig,
  requestUrl: URL,
): Response {
  const location = new URL(redirect.to, requestUrl).href
  return new Response(null, {
    status: redirect.code ?? 301,
    headers: { location },
  })
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
 *
 * `TComponent` (not a fixed `SpaceComponent`/`unknown`) is what makes `component` itself a
 * real, checked member of this union instead of an unconstrained escape hatch — see
 * {@linkcode SpacePageController}'s own `TComponent` template param for why leaving this generic,
 * resolved per concrete subclass, is what actually gives `component` real type-checking at the
 * point an author assigns it (a fixed `unknown` here would have meant `X | unknown` — which
 * TypeScript treats as just `unknown` for every purpose that matters, silently accepting literally
 * any value assigned to `component`, not only a real component).
 */
export type SpacePageExtensions<
  Params,
  TComponent = SpaceComponent,
> =
  | undefined
  | ((ctx: PageContext<Params>) => unknown | Promise<unknown>)
  | ((ctx: PageActionContext<Params>) => Promise<Response>)
  | TComponent

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
 * @template TComponent - The real component type `component` (below) must satisfy — defaults to
 * {@linkcode SpaceComponent}, the renderer-neutral component shape BOTH React's and Preact's own
 * components satisfy (and which is assignable back to either, so nothing downstream needs a cast).
 * Neither renderer has to know this parameter exists: `class ProductPage extends
 * SpacePageController<Params>` gets checked assignment on `component = ProductView` whether
 * `ProductView` is a React component or a Preact one. It used to default to React's own
 * `ComponentType<any>`, which meant a Preact page — and ONLY a Preact page — had to name the
 * parameter to be accepted at all.
 *
 * Deliberately not `unknown`/`any`: `SpaceComponent` still rejects a non-component outright, and
 * still checks props when they are named. What it cannot check is that the component's return value
 * is renderable, which is irreducibly renderer-specific (see {@linkcode SpaceComponent}'s own doc
 * for the evidence). A page that wants that check names its own renderer's type explicitly — `class
 * ProductPage extends SpacePageController<Params, never, import('preact').ComponentType<Props>>`,
 * or the React equivalent — an option that is now symmetric between the two renderers instead of
 * being one renderer's default.
 *
 * This class itself never reads `component` as this type (only `render-page-react.tsx`/
 * `render-page-preact.ts` do, each already knowing which renderer is active — see `handleGet`'s own
 * doc) — `TComponent` exists purely so *authors* get checked assignment, not because this class
 * needs to call `component` itself.
 */
export abstract class SpacePageController<
  Params = Record<string, string>,
  Interactor extends ZanixInteractorGeneric = never,
  TComponent = SpaceComponent | null,
> extends ZanixSsrController<
  Interactor,
  SpacePageExtensions<Params, TComponent>
> {
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
   * not assigned by hand. See `PageOptions.headers`'s own doc (`page-decorator.ts`) for `csp`'s own
   * full three-tier precedence: this page's own explicit `csp` (including `false`) > a `cspGuard()`
   * registered via `defineMiddleware`/`@Guard` > this page's own zero-config nonce-based default.
   */
  /**
   * The RTO validating this page's `action` payload, as declared by
   * `@Page({ action: { Body } })` — stashed here by `registerPage`, the same way `headers` is, and
   * read per request by {@linkcode SpacePageController.handlePost}.
   *
   * Set by the decorator, never by hand: writing it directly would skip the route registration
   * `@Page` performs around it. `undefined` for a page whose action needs no validation, which is
   * the unchanged default.
   */
  public static actionRto?: { Body?: RtoTypes['Body'] }

  /** Per-page response header overrides — `false` disables the framework's own default headers
   * for this page entirely. Unset inherits {@linkcode getDefaultPageHeaders}. */
  public static headers?: PageHeaderOptions | false
  /**
   * This page's own `<title>`/`<meta>`/`<link>` declaration — a plain {@linkcode HeadDescriptor},
   * or a function receiving `loader`'s resolved data (whatever `component` itself also receives as
   * props) when the head depends on it (e.g. `title: data.product.name`). Merged with every layout
   * in this page's own composition chain that declares its own `head` export — this page's own
   * declaration always wins field-by-field/key-by-key over any layout's (see
   * `resolveHead`'s own doc, `head-descriptor.ts`, for the full precedence/dedup contract). Omit
   * for a page with nothing of its own to declare — it simply falls through to whatever its layout
   * chain already provides.
   *
   * **Coexists with a manually-authored JSX `<title>`/`<meta>`/`<link>` inside `component` —
   * neither is ever suppressed.** This declaration's resolved output is always rendered BEFORE
   * `component`'s own tree. Under React, that ordering is what makes it document's FIRST `<title>`
   * (React 19 hoists both into `<head>` in encounter order, and the HTML Living Standard defines
   * `document.title` as the first `<title>` element) — confirmed with a dedicated test
   * (`render-page-react-head.test.tsx`, the "COEXISTENCE" case) that asserts this exact ordering,
   * not just presence. Under Preact (no hoisting at all), the effect is even more direct: this
   * declaration's output is the only content ever placed inside the real `<head>` element; a
   * hand-authored `<title>` inside `component` simply renders wherever it is in `<body>` and never
   * becomes `document.title`. See `head-descriptor.ts`'s own module doc for the full investigation.
   */
  // `(data: any)`, not `(data: unknown)` — a deliberate, narrow escape, for the same category of
  // reason `component` above is `SpaceComponent` rather than a fixed type. A page declares this
  // as a function of its OWN loader's resolved shape (`static head = (data: LoaderData) => ...`),
  // which is exactly what this field's own doc, this package's README and both SEO helpers
  // (`buildCanonicalLink`/`buildHreflangLinks`, whose entire documented usage is "return it from
  // `loader`, read it in `head`") all instruct. Under `unknown`, none of that ever type-checked: a
  // subclass narrowing the parameter makes the static side fail to extend the base's, since function
  // parameters are checked contravariantly — so the documented pattern produced a real TS2417 on
  // every page that used it. Confirmed as a genuine API defect, not a test artifact: the failure was
  // found in this package's own `hreflang-canonical` test, which had been written exactly as the
  // README says to write it. `any` restores the bivariance that makes a narrowed parameter legal,
  // at the cost of not checking that the declared shape matches what `loader` actually returns — a
  // trade this class already makes for `component`, whose props have the identical relationship to
  // the same `loader`.
  // deno-lint-ignore no-explicit-any
  public static head?: HeadDescriptor | ((data: any) => HeadDescriptor)
  /**
   * This page's own stylesheet(s) — e.g. `['./product.css', {href:
   * './product-mobile.css', media: '(max-width: 599px)'}]`, resolved relative to THIS page's OWN
   * file (co-located, the same convention a Comet's real `import './x.module.css'` already
   * resolves by — deliberately different from `defineSpaceApp({ globalCss })`'s own root-relative
   * resolution, since these are declared inside the page's own file, not centrally). Genuinely
   * scoped: linked ONLY on a response for THIS page, after `global` and before any Comet's own CSS
   * (cascade order — global → page → comet) — a stylesheet declared here is never linked when
   * rendering a different page. Order matters, same as `globalCss`'s own "order matters, later
   * entries can override earlier ones" contract, preserved through the build the same way.
   *
   * Discovered at build time by importing this page's own module (the same mechanism
   * `loadRoutes()` already uses at server startup — see `discoverPages`'s own doc,
   * `modules/bundler/discover-pages.ts`, for the full build-time story) — an author never
   * registers this by hand beyond declaring the field itself. Omit for a page with nothing of its
   * own beyond `global` — the overwhelming majority — at zero behavior change from before this
   * field existed.
   *
   * Not yet composed with a layout's own styles (page → layout → root inheritance) — only a page's
   * own, direct declaration is resolved today; this is a deliberate scope limit, not an oversight.
   */
  public static styles?: StylesheetRef[]

  /** Fetches this page's data. Runs before `component` renders — never touches React itself. */
  public loader?: (ctx: PageContext<Params>) => unknown | Promise<unknown>
  /** Handles a `POST` to this route (typically a `<form>` submission). Real HTTP, not an RPC. */
  public action?: (ctx: PageActionContext<Params>) => Promise<Response>
  /** The page's UI — receives `loader`'s return value (or `undefined`, if there's no loader) as
   * props. Typed `TComponent` (see this class's own `@template TComponent`), not a fixed
   * `SpaceComponent`/`unknown` — a page on EITHER renderer gets checked assignment from the
   * default, and either one can narrow to its own renderer's real `ComponentType` by naming it in
   * its own `extends` clause. */
  public abstract component: TComponent

  /**
   * Wired to `GET` by `Page()` — evaluates `redirect`, then runs `loader` (if declared), then
   * renders `component` (wrapped in this page's layout/loading/error composition chain, if any).
   * When `cacheControl` is set, a matching `If-None-Match` short-circuits to `304` before any
   * rendering happens. A request carrying `ORBIT_FRAGMENT_HEADER` (Orbit's own client-side
   * navigation, never something an app sends by hand) gets just the outlet fragment instead of a
   * full document — see `render-page-react.ts`'s own `composeSegments` doc (or `render-page-preact.ts`'s,
   * under `--renderer=preact`) for the composition itself; this method only ever calls whichever one
   * `getPageRenderer()` currently returns. Not meant to be called or overridden directly.
   *
   * **A thrown `loader`** — this page's own, or a nested layout segment's own (via
   * `resolveSegmentData`, reached from inside the render call below and surfacing through this SAME
   * `await` chain) — is recovered by {@linkcode renderLoaderErrorPage} rather than left to propagate
   * to `@zanix/server`'s own generic JSON error response: an `HttpError('NOT_FOUND')` renders this
   * app's `not-found.tsx`, any other error renders this route's own nearest `error.tsx`, and a route
   * with no `error.tsx` at all still gets a real, rendered document — this package's own built-in
   * `DefaultErrorView`. See that function's own doc for the full contract, including how the real
   * HTTP status survives.
   */
  public async handleGet(ctx: HandlerContext): Promise<Response> {
    const Ctor = this.constructor as typeof SpacePageController
    const pageCtx = toPageContext<Params>(ctx)
    const fragmentOnly = ctx.req.headers.has(ORBIT_FRAGMENT_HEADER)
    // Security headers, CSP nonce and theme overrides, resolved in one place shared with the
    // failed-action re-render so the two can never drift — see `resolvePageChrome`'s own doc.
    const { applySecurity, nonce, themeStyle, cspSignature } = await resolvePageChrome(
      ctx,
      Ctor.headers,
      pageCtx,
    )
    // `pageCtx.cspNonce` above was snapshotted from `ctx.locals[CSP_NONCE_LOCALS_KEY]` BEFORE
    // `resolvePageChrome` (via `applySecurityGuards` → `cspGuard`) ever wrote it for this request —
    // always `undefined` at that point, real value or not, since that's the ONE place this request's
    // nonce is ever generated. Reassigned here with the freshly-resolved `nonce` above (the exact
    // same value `cspGuard` just wrote to `ctx.locals`, per `resolvePageChrome`'s own doc) — a real,
    // confirmed regression otherwise: `loader` below always saw `cspNonce: undefined`, silently
    // dropping the nonce from `data-comet-props`/component props even though the response's own CSP
    // header carried a real one, confirmed via a live browser CSP violation on a Comet's own
    // `<style nonce>` rendered with no nonce attribute at all.
    pageCtx.cspNonce = nonce

    const { redirect } = Ctor
    if (
      redirect &&
      (redirect.condition?.(pageCtx as PageContext<unknown>) ?? true)
    ) {
      return applySecurity(buildRedirectResponse(redirect, pageCtx.url))
    }

    const Target = Ctor as unknown as ClassConstructor<SpacePageController>

    try {
      const data = await this.loader?.(pageCtx)

      const { cacheControl } = Ctor
      if (cacheControl) {
        // `population` folded in ONLY when a theme resolver is configured — see `computeEtag`'s own
        // `extra` param doc for exactly what this does and does not fix (a same-origin ETag/304
        // collision between two populations sharing the same loader data but a different resolved
        // theme; explicitly NOT a fix for a shared/CDN cache's own partitioning, which stays the
        // already-documented responsibility this package has never claimed to handle — see
        // `populationGuard`'s own doc).
        const etag = await computeEtag(data, getThemeResolver() ? pageCtx.population : undefined)
        // A full document and an Orbit fragment share the same ETag (both derive it from the same
        // loader data) but never the same body — `Vary` is what keeps a cache (browser or otherwise)
        // from serving one shape to a request that asked for the other.
        const headers = {
          etag,
          'cache-control': cacheControl,
          vary: ORBIT_FRAGMENT_HEADER,
        }
        if (ctx.req.headers.get('if-none-match') === etag) {
          return applySecurity(new Response(null, { status: 304, headers }))
        }
        const response = await getPageRenderer()(
          Target,
          this.component,
          pageCtx,
          data,
          fragmentOnly,
          nonce,
          themeStyle,
          cspSignature,
        )
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value)
        }
        return applySecurity(response)
      }

      return await renderPageResponse(
        Target,
        this.component,
        pageCtx,
        data,
        fragmentOnly,
        nonce,
        themeStyle,
        cspSignature,
        applySecurity,
      )
    } catch (error) {
      return applySecurity(
        await renderLoaderErrorPage(Target, pageCtx as PageContext<unknown>, fragmentOnly, error),
      )
    }
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
    const Ctor = this.constructor as typeof SpacePageController
    const pageCtx: PageActionContext<Params> = {
      ...toPageContext<Params>(ctx),
      // `@zanix/server` already consumed the request body while parsing it, so calling
      // `ctx.req.formData()` again throws — the request stream is spent. For the two content types
      // it parses (`x-www-form-urlencoded`, JSON) the result is right there on `ctx.payload.body`,
      // and for `x-www-form-urlencoded` it is already a real `FormData`. Anything else (notably
      // `multipart/form-data`, which the server does not parse at all) still reads from the request,
      // which is untouched in that case.
      formData: () =>
        ctx.payload.body instanceof FormData
          ? Promise.resolve(ctx.payload.body)
          : ctx.req.formData(),
      // The real object reference, not a copy — see `PageActionContext.locals`'s own doc for why.
      locals: ctx.locals,
    }

    const Body = Ctor.actionRto?.Body
    if (!Body) return await action(pageCtx)

    // Validation itself lives in `action-validation.ts` — including WHY it runs here rather than
    // as a `Post(path, rto)` pipe (a pipe's throw answers with JSON, which is the outcome the 422
    // re-render exists to avoid).
    const { validated, fieldErrors, submitted } = await validateActionBody(
      Body,
      ctx.payload.body,
      ctx,
    )

    if (!fieldErrors) {
      // Mirrors what `requestValidationPipe` itself does, so an action reading `ctx.payload.body`
      // directly sees the same validated instance the typed `ctx.body` carries.
      ctx.payload.body = validated
      return await action({ ...pageCtx, body: validated })
    }

    return await this.#renderInvalidAction(ctx, pageCtx, fieldErrors, submitted)
  }

  /**
   * Re-renders this page as the response to a POST whose payload failed validation — status `422`,
   * carrying the field errors and the submitted values on the page context.
   *
   * No redirect, no flash and no session, deliberately: the response to the failed POST *is* the
   * form again, which is what keeps a plain `<form>` working with scripting disabled. The page's
   * own `loader` receives `fieldErrors`/`submitted` and surfaces them exactly the way it already
   * forwards `csrfToken` — an established path, not a second mechanism.
   *
   * **A thrown `loader`** here is recovered by the SAME {@linkcode renderLoaderErrorPage}
   * `handleGet` itself uses, not a second implementation: an `HttpError('NOT_FOUND')` renders this
   * app's `not-found.tsx`, any other error renders this route's own nearest `error.tsx` with the
   * real status, and a route with no `error.tsx` at all still gets a real, rendered document — this
   * package's own built-in `DefaultErrorView` (see that function's own doc for the full contract).
   */
  // Native `#`-private, not TypeScript's `private` keyword — `HandlerBaseClass` (`@zanix/server`)
  // declares `[key: string | symbol]: HandlerPrototype<Interactor, Extensions>` on every handler
  // instance, and TS's `private` is still a plain, string-keyed member for that check (only a
  // visibility modifier, not a different key kind), so it gets held to `HandlerPrototype`'s shape —
  // which tops out at `HandlerFunction`'s `(ctx, args?: any)`, at most one required parameter. This
  // method's real signature (`ctx`, `actionCtx`, `fieldErrors`, `submitted`, all required) can never
  // fit that, and never needs to: it's an internal implementation detail of `handlePost`, never a
  // route handler the framework dispatches to. A genuine `#`-private field isn't string/symbol-keyed
  // at all, so it falls outside the index signature entirely — confirmed empirically (TS2411 fires
  // on the `private` form, not on this one).
  async #renderInvalidAction(
    ctx: HandlerContext,
    actionCtx: PageActionContext<Params>,
    fieldErrors: PageFieldErrors,
    submitted: Record<string, string>,
  ): Promise<Response> {
    const Ctor = this.constructor as typeof SpacePageController
    const Target = Ctor as unknown as ClassConstructor<SpacePageController>

    const pageCtx: PageContext<Params> = { ...actionCtx, fieldErrors, submitted }

    const { applySecurity, nonce, themeStyle, cspSignature } = await resolvePageChrome(
      ctx,
      Ctor.headers,
      pageCtx,
    )
    // Same reassignment `handleGet` performs, for the identical reason — see that call site's own
    // doc. `actionCtx.cspNonce` (spread into `pageCtx` above) was ALSO snapshotted before this
    // request's `cspGuard` ever ran, whether `actionCtx` came from `handlePost`'s own `toPageContext`
    // call or anywhere else — a plain object spread copies a stale value, it does not defer reading
    // it, so reassigning after `resolvePageChrome` resolves is required here too, not optional.
    pageCtx.cspNonce = nonce

    try {
      // `loader` runs exactly as it does for a GET — the page renders with its real data, plus the
      // errors. A form that needs its own options/lists back is therefore whole again, not empty.
      const data = await this.loader?.(pageCtx)

      return await renderPageResponse(
        Target,
        this.component,
        pageCtx,
        data,
        false,
        nonce,
        themeStyle,
        cspSignature,
        applySecurity,
        422,
      )
    } catch (error) {
      return applySecurity(
        await renderLoaderErrorPage(Target, pageCtx as PageContext<unknown>, false, error),
      )
    }
  }
}
