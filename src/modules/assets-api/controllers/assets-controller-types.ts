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
import type { ImagesOptimizeOptions } from '../../assets/image-optimize-types.ts'

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
   * `/assets/image`, `/assets/video`); `read` gates every `GET` route; `delete` gates
   * `DELETE /assets/:id` — kept separate from `write` since a real integrator's ownership check
   * for "may upload a new asset" and "may remove THIS one" is routinely different (e.g. only the
   * asset's own uploader, not merely any authenticated session).
   */
  guards?: {
    write?: MiddlewareGuard[]
    read?: MiddlewareGuard[]
    delete?: MiddlewareGuard[]
  }
  /**
   * A fixed image breakpoint/format policy applied to every `POST /assets/image` upload accepted
   * by THIS controller instance. Omitted (the default): every upload gets the bare in-place
   * recompress, exactly as if this field didn't exist.
   *
   * Deliberately a fixed, operator-configured value here — never a per-request query param the
   * way `VideoUploadQueryRTO`/`VoiceUploadQueryRTO` let a caller pick `breakpoint`/`format` on
   * `/assets/video`/`/assets/audio`. Those two routes already accept that an authenticated caller
   * can request a specific, bounded amount of transcode work per upload; extending the identical
   * shape to images would let a caller ask for an arbitrary combination of breakpoints/formats on
   * every request, a real resource-abuse surface `'image'` has no product reason to accept. Every
   * known real integrator of this controller wants exactly one photo policy applied uniformly
   * (e.g. a profile-photo upload endpoint that always produces the same full/thumbnail preset) —
   * a fixed value here covers that directly, with no configurability an integrator doesn't need.
   * A future integrator that genuinely needs per-request image policy is a real, separate design
   * decision, not a default this field should silently grow into.
   */
  imageOptimizeOptions?: ImagesOptimizeOptions
}
