/**
 * The safe default guard for every Asset API route — always denies. No authorization POLICY has
 * been decided yet for this API (permissions, roles, public-vs-authenticated access are all real
 * product decisions this package doesn't make) — but omitting a guard must never silently mean
 * "public." Passing an explicit `guards` list to `createAssetsController()` is how a real
 * integrator opts these routes into real access control (e.g. built from `@zanix/auth`'s
 * `AuthTokenValidation`, the same mechanism Templates/Triggers already use).
 *
 * This matters concretely: `POST /assets/audio` spawns a real `ffmpeg` process — an unguarded
 * route would let anyone consume CPU/disk on demand.
 *
 * @module
 */

import { HttpError } from '@zanix/errors'
import { httpErrorResponse } from '@zanix/server'
import type { GuardResponse, MiddlewareGuard } from '@zanix/server'

/** Always denies with a `FORBIDDEN` response — see this module's own top-level doc for why. */
export const denyAllGuard: MiddlewareGuard = (): GuardResponse => {
  const error = new HttpError('FORBIDDEN', {
    meta: {
      source: 'zanix',
      reason: 'No authorization guard configured for the Asset API — this is a deliberate ' +
        'safety default, not an oversight. Pass an explicit `guards` option to ' +
        "createAssetsController() (e.g. built from @zanix/auth's AuthTokenValidation) before " +
        'exposing these routes.',
    },
  })
  return { response: httpErrorResponse(error) }
}
