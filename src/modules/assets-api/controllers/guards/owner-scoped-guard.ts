/**
 * A `MiddlewareGuard` FACTORY for per-asset ownership checks — the generic HALF of "may this
 * caller touch this asset," never the auth-specific half. `AssetRecord.ownerId` (`../../typings.ts`)
 * and `ResolveCallerId` (`../assets-controller-types.ts`) are what make the comparison itself the
 * same for every integrator; how a caller's own id is actually extracted (a JWT claim, a session
 * cookie, a header) is NOT — same "auth is never assumed" posture `deny-all-guard.ts` already
 * documents. This module owns the former only, taking the latter as `options.resolveCallerId`.
 *
 * @module
 */

import { HttpError } from '@zanix/errors'
import { httpErrorResponse } from '@zanix/server'
import type { GenericPayload, GuardResponse, HandlerContext, MiddlewareGuard } from '@zanix/server'
import type { AssetService } from '../../asset-service-types.ts'
import type { ResolveCallerId } from '../assets-controller-types.ts'

export interface OwnerScopedGuardOptions {
  /** Extracts the id to compare `AssetRecord.ownerId` against — typically the exact same function
   * passed to `AssetsControllerOptions.resolveCallerId`, so "who created this" and "who's asking
   * now" resolve identically. */
  resolveCallerId: ResolveCallerId
  /** Reads the target asset's own id off the request. Defaults to `context.payload.params.id` —
   * `AssetIdParamsRTO`'s own shape, matching every `:id` route this controller defines. Override
   * only when guarding a route with a differently-named path param. */
  getAssetId?: (context: HandlerContext<Partial<GenericPayload>>) => string | undefined
}

const defaultGetAssetId = (context: HandlerContext<Partial<GenericPayload>>): string | undefined =>
  (context.payload as { params?: { id?: string } }).params?.id

/**
 * Builds a guard that allows a request only when the target asset's `AssetRecord.ownerId` matches
 * `options.resolveCallerId(context)`. Fails CLOSED whenever either side is missing (no caller id
 * resolved, or the asset itself has no `ownerId` on record) — never open — matching
 * `denyAllGuard`'s own "never public by accident" posture; an integrator that hasn't populated
 * `ownerId` on its assets shouldn't reach for this guard yet.
 *
 * A missing asset is deliberately NOT this guard's concern — it lets the request through so the
 * route's own existing `NOT_FOUND` check runs (see `assets.controller.ts`'s `getAsset`/
 * `deleteAsset`), rather than this guard surfacing a different not-found shape of its own.
 *
 * Compose it with `combineGuards` alongside a real authentication guard (e.g. `@zanix/auth`'s
 * `AuthTokenValidation`) — this guard alone only ever checks OWNERSHIP, never whether the caller is
 * authenticated at all (an unresolved caller id already fails closed above, but pairing it with an
 * explicit auth guard keeps the denial reason accurate).
 *
 * `service` is passed explicitly — this package builds no ambient DI lookup for it. Pass the SAME
 * `AssetService` instance given to `createAssetsController({service})`.
 */
export function createOwnerScopedGuard(
  service: AssetService,
  options: OwnerScopedGuardOptions,
): MiddlewareGuard {
  const getAssetId = options.getAssetId ?? defaultGetAssetId

  return async (context): Promise<GuardResponse> => {
    const assetId = getAssetId(context)
    if (!assetId) return {}

    const record = await service.getAsset(assetId)
    if (!record) return {}

    const callerId = await options.resolveCallerId(context)
    if (!callerId || !record.ownerId || callerId !== record.ownerId) {
      const error = new HttpError('FORBIDDEN', {
        meta: {
          source: 'zanix',
          reason: `Asset "${assetId}" isn't owned by the current caller.`,
        },
      })
      return { response: httpErrorResponse(error) }
    }
    return {}
  }
}
