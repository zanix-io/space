/**
 * PWA module — Web App Manifest generation/serving and PWA route registration. Icon *generation*
 * (`pwaPlugin`, build-time, depends on `sharp`) lives in `modules/bundler/` instead, deliberately
 * separate — see `icon-naming.ts`'s own doc for why.
 *
 * @module
 */
export { registerPwa } from './register-pwa.ts'
export { buildWebManifest, iconRoute, MANIFEST_ROUTE, SW_ROUTE } from './web-manifest.ts'
export {
  getPwaBuildOutput,
  getPwaConfig,
  loadPwaBuildOutput,
  setPwaConfig,
} from './pwa-registry.ts'
