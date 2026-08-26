/**
 * Pure data-shape type for `createAssetsController` — `AssetsControllerOptions` — deliberately
 * split from `assets.controller.ts` itself, which value-imports real `@zanix/server` decorators
 * and RTO classes alongside the controller factory. References only `AssetService`
 * (`../asset-service-types.ts`, itself `sharp`-free) and `@zanix/server`'s own `MiddlewareGuard`
 * type, so a consumer that only needs to type an options object — e.g. `mod.ts`'s own
 * `SpaceAppConfig.assetsApi` — never resolves `sharp`/`vite`/the renderer toolchain merely by
 * reading this file. Re-exported unchanged from `assets.controller.ts`, so switching that import
 * site between "the real file" and "this types file" is never a breaking change in either
 * direction.
 *
 * @module
 */

import type { MiddlewareGuard } from '@zanix/server'
import type { AssetService } from '../asset-service-types.ts'

/** Options for `createAssetsController`. */
export interface AssetsControllerOptions {
  /** The composed `AssetService` every route delegates to — see `assets.controller.ts`'s own
   * top-level doc. */
  service: AssetService
  /** Route prefix, e.g. `'assets'` (default) for `/assets/*`. */
  prefix?: string
  /**
   * Per-operation-group guards. Each group defaults to `[denyAllGuard]` when omitted or empty —
   * never to "no guard at all." `write` gates every `POST` route (`/assets/audio`,
   * `/assets/image`, `/assets/video`); `read` gates every `GET` route.
   */
  guards?: {
    write?: MiddlewareGuard[]
    read?: MiddlewareGuard[]
  }
}
