/**
 * Router module — file-based page routing on top of `@zanix/server`'s `'ssr'` handler type.
 *
 * @module
 */
export { SpacePageController, ZanixSsrController } from './space-page-controller.tsx'
export type {
  HandlerContext,
  PageHeaderOptions,
  SpacePageExtensions,
} from './space-page-controller.tsx'
export { Page } from './page-decorator.ts'
export type { PageOptions } from './page-decorator.ts'
export type { ClassConstructor, TargetBaseClass, ZanixClassDecorator } from '@zanix/server'
// `HandlerContext`'s own chain (below) and `ZanixClassDecorator`'s (`ClassConstructor` above,
// terminating at `TargetBaseClass`, itself re-exported by `@zanix/server`) both resolve cleanly —
// verified via `deno doc --lint`, not assumed. `ZanixSsrController`'s own chain does not: its
// `Interactor` generic reaches `ZanixInteractorGeneric` → `ZanixInteractor` → `CoreBaseClass`, whose
// getters return every concrete core connector/provider `@zanix/server` ships (a dozen-plus types)
// — see this module's own `mod.ts`-adjacent notes for why that residual `deno doc --lint` finding
// is accepted rather than chased. `SpacePageController`'s own `Interactor` type parameter and
// `PageOptions.Interactor` reach the same chain, for the same reason — a page declaring one is
// exactly what makes `this.interactor` (and, from inside it, `this.cache`'s `ZanixCacheProvider`
// resolution) available at all, per `SpacePageController`'s own doc.
export type { BaseContext, GenericPayload, Session, SessionTypes } from '@zanix/server'
export type { ZanixInteractorClass, ZanixInteractorGeneric } from '@zanix/server'
export { loadRoutes } from './load-routes.ts'
export type { ImportedModule, LoadRoutesOptions } from './load-routes.ts'
export { scanPageFiles } from './scan-page-files.ts'
export type { DiscoveredPage, PageSegmentFiles } from './scan-page-files.ts'
export { createNotFoundHandler } from './not-found-handler.tsx'
export type { OnErrorHandler } from './not-found-handler.tsx'
export { getDefaultPageHeaders, setDefaultPageHeaders } from './default-page-headers.ts'
