import type { ClassConstructor, ZanixClassDecorator, ZanixInteractorClass } from '@zanix/server'

import { Get, Post, SsrController } from '@zanix/server'
import { InternalError } from '@zanix/errors'
import type { PageHeaderOptions } from './space-page-controller.tsx'
import { SpacePageController } from './space-page-controller.tsx'

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
   * Response headers for this page — `Content-Security-Policy` (via `csp`, defaulting to a
   * nonce-based policy) plus common security headers (`frameOptions`, `referrerPolicy`, ...),
   * defaulting to `securityHeadersGuard`'s own defaults. See `SpacePageController.headers`'s own
   * doc for the full shape and defaults. Pass `false` to disable all of these for this page.
   *
   * **Interaction with `defineMiddleware`**: this option always wins over a guard registered
   * globally via `defineMiddleware` for the same header — class-level guards run after global ones
   * (see `defineMiddleware`'s own doc), but a page's own `headers` is applied directly inside
   * `handleGet`, not through the guard pipeline at all, and the two don't cleanly override each
   * other for the same header (see `defineMiddleware`'s own doc for what actually happens if both
   * are used together). Pick one mechanism per page.
   */
  headers?: PageHeaderOptions | false
}

type PendingPageOptions = {
  Interactor?: ZanixInteractorClass
  headers?: PageHeaderOptions | false
}

/** Pages decorated with a pathless `@Page()`, awaiting `loadRoutes()` to tell them their real
 * route path (derived from where their file actually lives). A page left in here forever — one
 * decorated `@Page()` but never discovered by `loadRoutes()` (e.g. imported by hand from outside
 * `routesDir`) — silently never becomes a real route; that's why `@Page()`'s own doc calls this
 * mode out as depending on file-based discovery. Maps to the page's own options, carried along
 * until the path is known and the page can actually be registered. */
const pendingPages = new Map<ClassConstructor<SpacePageController>, PendingPageOptions>()

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
  { Interactor, headers }: PendingPageOptions,
): void {
  const proto = Target.prototype
  Get(path)(proto.handleGet)
  Post(path)(proto.handlePost)
  if (Interactor) SsrController({ Interactor })(Target)
  else SsrController()(Target)
  ;(Target as unknown as typeof SpacePageController).headers = headers
}

/**
 * Finishes registering a page that was decorated with a pathless `@Page()`, now that its real
 * route path is known. Called internally by `loadRoutes()` once it imports the page's file and
 * derives that path from the file's own location — a page never calls this itself. A no-op for
 * any class not currently pending (e.g. already registered via an explicit `@Page(path)`).
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
  pendingPages.delete(Target)
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
export function Page(pathOrOptions?: string | PageOptions): ZanixClassDecorator {
  return function (Target) {
    if (!(Target.prototype instanceof SpacePageController)) {
      throw new InternalError(
        `The class '${Target.name}' is not a valid Page. Please extend ${SpacePageController.name}`,
        { meta: { target: Target.name, baseTarget: SpacePageController.name } },
      )
    }

    const Controller = Target as ClassConstructor<SpacePageController>
    const { path, Interactor, headers } = typeof pathOrOptions === 'string'
      ? { path: pathOrOptions, Interactor: undefined, headers: undefined }
      : pathOrOptions ?? {}

    if (path === undefined) {
      pendingPages.set(Controller, { Interactor, headers })
      return
    }

    registerPage(Controller, path, { Interactor, headers })
  }
}
