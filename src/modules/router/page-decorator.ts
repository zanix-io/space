import type { ClassConstructor, ZanixClassDecorator, ZanixInteractorClass } from '@zanix/server'

import { AsyncLocalStorage } from 'node:async_hooks'
import { Get, Post, ProgramModule, SsrController } from '@zanix/server'
import type { RtoTypes } from '@zanix/types'
import { InternalError } from '@zanix/errors'
import type { PageHeaderOptions } from './space-page-controller.ts'
import { SpacePageController } from './space-page-controller.ts'

/**
 * Options accepted by {@linkcode Page}, beyond the plain-path shorthand (`@Page('products/:id')`,
 * still supported as-is).
 */
export type PageOptions = {
  /** The route path (e.g. `'products/:id'`). Omit to infer it from the file's location. */
  path?: string
  /**
   * Interactor class made available as `this.interactor` — the correct place for a page's own
   * data/cache access beyond what a plain `loader` needs (a `SpacePageController` is a Handler,
   * and Handlers never resolve Providers/Connectors directly; see `SpacePageController`'s own doc
   * on its `Interactor` type parameter). Must match whatever `Interactor` type parameter the page
   * class itself declares (`SpacePageController<Params, Interactor>`) — this is what actually
   * registers it at runtime; the type parameter alone only affects `this.interactor`'s static type.
   */
  Interactor?: ZanixInteractorClass
  /**
   * Validation for this page's `action`, using the ecosystem's own Request Transfer Objects — the
   * same `BaseRTO` classes and the same `@zanix/validator` rules a `@zanix/server` handler uses.
   * Space adds no validation of its own here; it only connects the RTO to `action`, which an app
   * otherwise could not do (`@Page` wires `POST` to the BASE class's `handlePost`, so there is no
   * method on the subclass to decorate).
   *
   * When the submitted body fails validation, the POST responds with the page **re-rendered** at
   * status `422`, carrying `fieldErrors` and `submitted` on the page context — never raw JSON. A
   * plain `<form>` therefore keeps working with scripting disabled, which a redirect-plus-flash
   * design could not offer without inventing a flash mechanism this package does not have.
   *
   * `Body` only for now. The object shape leaves room for `Params`/`Search` if a real need appears;
   * neither is built speculatively.
   *
   * Note: `Body` is parsed for `application/x-www-form-urlencoded` (what a plain `<form>` posts)
   * and JSON. A `multipart/form-data` submission — a form with file uploads — has no parsed body at
   * the server layer, so it cannot be validated this way; use `formData()` for those.
   *
   * @example
   * ```ts
   * class CheckoutBody extends BaseRTO {
   *   \@IsEmail({ expose: true })
   *   accessor email!: string
   * }
   *
   * \@Page({ path: 'checkout', action: { Body: CheckoutBody } })
   * class CheckoutPage extends SpacePageController {
   *   action = async (ctx) => { ctx.body.email; return new Response('ok') }
   * }
   * ```
   */
  action?: { Body?: RtoTypes['Body'] }
  /**
   * Response headers for this page — `Content-Security-Policy` (via `csp`, defaulting to a
   * nonce-based policy) plus common security headers (`frameOptions`, `referrerPolicy`, ...),
   * defaulting to `securityHeadersGuard`'s own defaults. See `SpacePageController.headers`'s own
   * doc for the full shape and defaults. Pass `false` to disable all of these for this page.
   *
   * **`csp`'s own precedence chain, exactly three tiers, in order**:
   *
   * 1. **This page's own explicit `csp`** (or the app-wide `defineSpaceApp({ headers })` default,
   *    still resolved first when this page sets none of its own — see `resolvePageHeaders`'s own
   *    doc) — always wins outright, unconditionally, whenever configured, INCLUDING `csp: false`
   *    (an explicit "no CSP for this page," which wins even over tier 2 below — see the `false`
   *    case further down).
   * 2. **A `cspGuard()` registered via `defineMiddleware` (app-wide) or `@Guard` (this page's own
   *    class)** — acts as the base/default ONLY for a page that genuinely configured nothing at
   *    tier 1 (not even `false`). `@zanix/server`'s own `mainInterceptor` is what actually merges
   *    this in — a guard's header is only applied when the handler's response doesn't already have
   *    that header, never blindly combined into an already-set value (blindly combining the two
   *    would corrupt into one invalid, comma-joined result — CSP directives are `;`-separated,
   *    never `,`).
   * 3. **This page's own zero-config default** (`DEFAULT_CSP_DIRECTIVES`, nonce-based — see
   *    `SpacePageController.headers`'s own doc) — the last resort, when NEITHER tier 1 NOR tier 2
   *    has an answer. This tier is what makes the chain genuinely three-deep rather than two: a
   *    naive "handler already set it wins" check alone can't express it, because this page's own
   *    zero-config default is computed and applied inside the SAME handler that also applies tier
   *    1 — indistinguishable from a deliberate choice unless something explicitly steps aside for
   *    tier 2 first. See `applySecurityGuards`'s own doc (`space-page-controller.ts`) for exactly
   *    how it does that (reading `ctx.locals[GUARD_HEADERS_LOCALS_KEY]`, from `@zanix/server`,
   *    BEFORE deciding whether to apply its own default at all).
   *
   * Concretely: `defineMiddleware([cspGuard({ 'default-src': ["'self'"] })])` becomes the
   * effective CSP for any page that configures nothing of its own (tier 2, since tier 1 is empty);
   * a specific page's own `Page({ headers: { csp } })` overrides it for just that page (tier 1); a
   * page in an app with NO `cspGuard()` registered anywhere falls through to this page's own
   * nonce-based default (tier 3). `csp: false` is tier 1 too — it wins even over a registered
   * guard, ending up with the `Content-Security-Policy` header completely ABSENT (never the
   * guard's, and never present-but-empty either).
   *
   * A page-level `@Guard(cspGuard(...))` is subject to the exact same tier-2 treatment as a global
   * one — it's still a guard, not this option — so it loses to this page's own `headers.csp` (tier
   * 1) exactly the same way.
   */
  headers?: PageHeaderOptions | false
}

type PendingPageOptions = {
  Interactor?: ZanixInteractorClass
  headers?: PageHeaderOptions | false
  action?: { Body?: RtoTypes['Body'] }
}

/** Every class ever decorated with a pathless `@Page()`, mapped to its own options — never
 * deleted, unlike an earlier version of this bookkeeping. A `WeakMap`, deliberately: once a class
 * this holds becomes unreachable from anywhere else (e.g. `load-routes.ts`'s own
 * `registeredPageTargets`, once a dev-server reimport replaces it with a fresh class for the same
 * file), this entry is collected right along with it — no separate cleanup pass needed, and no
 * unbounded growth across a long `zanix space dev` session's worth of edits.
 *
 * Kept permanently (not removed once resolved) for two reasons: {@linkcode resolvePendingPage}
 * needs to tell "this class was never pathless — an explicit-path page, nothing to do here" apart
 * from "this class WAS pathless and already resolved once" — a distinction a one-shot,
 * delete-after-use map can't make. And the options themselves (`Interactor`/`headers`/`action`)
 * stay available for a genuine RE-registration later — see {@linkcode resolvePendingPage}'s own
 * doc for the real case that needs one. */
const pendingPages = new WeakMap<
  ClassConstructor<SpacePageController>,
  PendingPageOptions
>()

/** Ambient "the class about to register a path may evict THIS one first, if it turns out to be
 * what's blocking it" signal — see {@linkcode withPendingReplacement}'s own doc for why this
 * exists and how it's scoped. `undefined` (the default, outside any `withPendingReplacement` call)
 * means "nothing to evict," exactly as if this mechanism didn't exist at all — the state every
 * plain production boot's own registration sees. */
const pendingReplacement = new AsyncLocalStorage<
  ClassConstructor<SpacePageController> | undefined
>()

/**
 * Runs `fn` (a single page's own `importModule()` call) with `previousTarget` available to
 * {@linkcode registerPage} as the one class THIS SAME call is allowed to evict if it turns out to
 * be blocking the path a freshly-imported page is about to claim — dev-mode-only recovery for an
 * *explicit* `@Page(path)`'s own real limitation (see `loadRoutes`'s own doc): unlike a pathless
 * `@Page()`, an explicit path registers synchronously, DURING import itself, before `loadRoutes()`
 * ever gets a chance to deregister the previous class first — so reimporting such a page while its
 * previous registration is still live collides and throws, and (since the throw happens mid class
 * definition) the fresh class binding is never even created, so there is nothing to retry
 * afterward with. Fixing that ordering problem needs the ONE piece of context `registerPage` has
 * no other way to receive: which class, if any, THIS exact file's own previous import left behind.
 * An `AsyncLocalStorage`, not a plain module variable, is what safely carries that from here to
 * there — `loadRoutes()` processes every page in one `Promise.all`, so several pages' own imports
 * can genuinely be in flight at once; a flat variable would let one page's value leak into
 * another's decorator call, evicting the wrong class. Scoped correctly, each page's own `Target`
 * class is the only one the eviction check below can ever see.
 *
 * Only ever called by `loadRoutes()` itself, and only while a real dev engine is installed (never
 * for a plain production `import()` — see that call site's own comment for why gating on that
 * matters). A pathless `@Page()`'s own registration (deferred to {@linkcode resolvePendingPage},
 * which always runs OUTSIDE this wrapped call) never observes this context either way — nothing
 * new for that path, which already orders its own deregistration correctly.
 */
export function withPendingReplacement<T>(
  previousTarget: ClassConstructor<SpacePageController> | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return pendingReplacement.run(previousTarget, fn)
}

/** Wires `GET`/`POST` to `handleGet`/`handlePost` for `path`, registers `Target` under `'ssr'`
 * (with `Interactor`, if the page declared one), and records its `headers` choice as a static
 * property (same pattern as `redirect`/`cacheControl`) — `SpacePageController.handleGet` reads it
 * directly and applies `cspGuard`/`securityHeadersGuard` itself, as plain functions, not via
 * `@Guard`/`registerGlobalGuard`. That decorator-based path requires a real TC39 decorator
 * `context` (it branches on `context?.kind === 'class'`) to know it's registering a class-level
 * guard — calling it directly, as `Guard(fn)(Target)`, supplies no such context and silently falls
 * into the METHOD-queuing branch instead, keyed by `Target.name` as if it were a method name, which
 * never gets flushed to anything. Shared by both `Page()` code paths (immediate, explicit-path
 * registration and the pending path `loadRoutes()` completes later) so there's exactly one place
 * that does the actual wiring. */
function registerPage(
  Target: ClassConstructor<SpacePageController>,
  path: string,
  { Interactor, headers, action }: PendingPageOptions,
): void {
  // Only ever non-undefined for an EXPLICIT-path page reimported under `withPendingReplacement`
  // (see that function's own doc) — evicts THIS class's own previous registration for the SAME
  // file, never anyone else's, so a genuine collision between two unrelated pages that happen to
  // declare the same path still throws exactly as before.
  const evictable = pendingReplacement.getStore()
  if (evictable && evictable !== Target) {
    ProgramModule.unregisterRoutes(evictable, 'ssr')
  }

  const proto = Target.prototype
  Get(path)(proto.handleGet)
  Post(path)(proto.handlePost)
  if (Interactor) SsrController({ Interactor })(Target)
  else SsrController()(Target)
  ;(Target as unknown as typeof SpacePageController).headers = headers // Same stash-as-a-static mechanism `headers` uses immediately above — `handlePost`
   // reads it per request. Deliberately NOT `Post(path, rto)`: that registers a PIPE, and a
  // pipe throw escapes past the router's own catch to `Deno.serve`'s `onError`, which
  // answers with JSON — the exact outcome the 422 re-render exists to avoid.
  ;(Target as unknown as typeof SpacePageController).actionRto = action
}

/**
 * Finishes registering a page that was decorated with a pathless `@Page()`, now that its real
 * route path is known. Called internally by `loadRoutes()` once it imports the page's file and
 * derives that path from the file's own location — a page never calls this itself.
 *
 * A no-op for `Target` never decorated with a pathless `@Page()` at all — an explicit-path page,
 * already registered synchronously at decoration time, has nothing left for this function to do.
 *
 * Otherwise a true no-op **only** when `Target`'s routes are still live
 * (`ProgramModule.routes.hasRoutesForTarget`) — normally true on every call after the first, since
 * nothing else in this package ever removes a page's routes out from under it. The one real
 * exception: `@zanix/app`'s `uninstallApp`/`installApp` hot-uninstalls then hot-reinstalls an
 * Application's whole route surface in a live process, re-running this app's `setup()` — and
 * therefore `loadRoutes()` — a second time. If the page's file didn't change on disk in between, a
 * plain `import()` (production, no dev engine) hits Deno's own ES module cache and returns the
 * identical, already-evaluated class: its `@Page()` decorator never reruns, so nothing would ever
 * ask this function to re-register it. Checking liveness directly (rather than only ever trusting
 * "already resolved once, so it must still be fine") is what actually restores it — using the
 * SAME options this class was originally decorated with, still available from `pendingPages`
 * (kept permanently — see its own doc).
 *
 * @param Target - The page class, as imported.
 * @param routePath - The route path derived from the file's location (see `scanPageFiles`).
 */
export function resolvePendingPage(
  Target: ClassConstructor<SpacePageController>,
  routePath: string,
): void {
  const options = pendingPages.get(Target)
  if (!options) return
  if (ProgramModule.routes.hasRoutesForTarget(Target, 'ssr')) return
  registerPage(Target, routePath, options)
}

/**
 * Class decorator that registers a `SpacePageController` subclass as a page route.
 *
 * Wires `GET` to `loader`+`component` and `POST` to `action`, via the base class's `handleGet`/
 * `handlePost` — both are always registered, even for a page with no `action` (a `POST` to one
 * responds `405`; see `SpacePageController`'s own doc for why this can't be decided here, at
 * decoration time). `@Get`/`@Post` from `@zanix/server` are reused as-is for this — they carry no
 * server-type of their own, so the same method decorators that wire REST controllers wire page
 * routes too; only the class decorator (`SsrController`, wrapped here) decides the route registers
 * under `'ssr'`.
 *
 * **Path resolution has two modes**:
 * - **Omitted (recommended)** — the route path is inferred from the file's own location under
 *   `routesDir` once `loadRoutes()` imports it (e.g. a page at `routes/products/[id]/page.tsx`
 *   resolves to `'products/:id'`). This only works for a page `loadRoutes()` actually discovers —
 *   a page decorated this way but imported some other way never becomes a route.
 * - **Explicit** — registers immediately, at decoration time, independent of `loadRoutes()`. The
 *   escape hatch for a page that isn't reachable through the `routesDir` convention.
 *
 * @param pathOrOptions - The route path (e.g. `'products/:id'`), or a {@linkcode PageOptions}
 * object for also declaring the page's own `Interactor`. Omit (or omit `path` on the object form)
 * to infer the path from the file's location.
 * @throws {InternalError} If the decorated class does not extend `SpacePageController`.
 *
 * @example
 * ```tsx
 * // routes/products/[id]/page.tsx — path inferred as 'products/:id'
 * import { Page, SpacePageController } from '@zanix/space'
 *
 * @Page()
 * export default class ProductPage extends SpacePageController<{ id: string }> {
 *   loader = async (ctx) => ({ product: await getProduct(ctx.params.id) })
 *   component = ProductView
 * }
 * ```
 *
 * @example
 * ```tsx
 * // A page whose loader needs cached data — resolved through its own Interactor, never directly
 * // on the page itself (see SpacePageController's own doc on the Interactor type parameter).
 * import { Page, SpacePageController } from '@zanix/space'
 * import { ZanixInteractor } from '@zanix/server'
 *
 * class ProductsInteractor extends ZanixInteractor {
 *   // `this.cache` is `CoreBaseClass`'s own sugar for `this.providers.get('cache')` — the
 *   // abstract `ZanixCacheProvider` contract itself is never resolved directly by class
 *   // reference; only through this getter or the equivalent string slot key.
 *   getProduct(id: string) {
 *     return this.cache.getCachedOrRevalidate('redis', `product:${id}`, {
 *       fetcher: () => fetchProductFromApi(id),
 *       softTtl: 45,
 *     })
 *   }
 * }
 *
 * @Page({ Interactor: ProductsInteractor })
 * export default class ProductPage extends SpacePageController<{ id: string }, ProductsInteractor> {
 *   loader = (ctx) => this.interactor.getProduct(ctx.params.id)
 *   component = ProductView
 * }
 * ```
 */
export function Page(
  pathOrOptions?: string | PageOptions,
): ZanixClassDecorator {
  return function (Target) {
    if (!(Target.prototype instanceof SpacePageController)) {
      throw new InternalError(
        `The class '${Target.name}' is not a valid Page. Please extend ${SpacePageController.name}`,
        { meta: { target: Target.name, baseTarget: SpacePageController.name } },
      )
    }

    const Controller = Target as ClassConstructor<SpacePageController>
    const { path, Interactor, headers, action } = typeof pathOrOptions === 'string'
      ? { path: pathOrOptions, Interactor: undefined, headers: undefined, action: undefined }
      : pathOrOptions ?? {}

    if (path === undefined) {
      pendingPages.set(Controller, { Interactor, headers, action })
      return
    }

    registerPage(Controller, path, { Interactor, headers, action })
  }
}
