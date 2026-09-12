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

import type { GenericPayload, HandlerContext, MiddlewareGuard } from '@zanix/server'
import type { AssetService } from '../asset-service-types.ts'
import type { ImagesOptimizeOptions } from '../../assets/image-optimize-types.ts'

/**
 * Resolves the identity of whoever is making the current request — a plain, INTEGRATOR-supplied
 * extractor, never an auth mechanism this package picks (same "never assumed" posture `guards`
 * itself already has — see `guards/deny-all-guard.ts`'s own doc). `undefined` means "no identity
 * available for this request" (e.g. unauthenticated).
 *
 * Used two ways, deliberately with the SAME function so "who created this" and "who's asking now"
 * resolve identically: `AssetsControllerOptions.resolveCallerId` stamps a newly created asset's
 * `AssetRecord.ownerId` with its result, and `createOwnerScopedGuard()`
 * (`guards/owner-scoped-guard.ts`) later compares it against that stored `ownerId`.
 */
export type ResolveCallerId = (
  // `Partial<GenericPayload>`, not the default `GenericPayload` — this must accept every route's
  // own narrower `HandlerContext<{search: ...}>`/`HandlerContext<{params: ...}>`, not just the
  // fully-generic one, since every write/read/delete route below passes its own payload-typed `ctx`.
  context: HandlerContext<Partial<GenericPayload>>,
) => string | undefined | Promise<string | undefined>

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
  /**
   * Resolves the caller's own id for every write request — when given, `POST /assets/audio`,
   * `/assets/image` and `/assets/video` all stamp the created `AssetRecord.ownerId` with its
   * result. Omitted (the default): `ownerId` stays unset, exactly as if this option didn't exist —
   * no behavior change for an integrator with no ownership concept.
   *
   * Pass the SAME function to `createOwnerScopedGuard()` (`guards/owner-scoped-guard.ts`) to
   * enforce it later on `guards.read`/`guards.delete` — see `ResolveCallerId`'s own doc for why
   * this stays a plain extractor rather than a built-in auth mechanism.
   */
  resolveCallerId?: ResolveCallerId
}
