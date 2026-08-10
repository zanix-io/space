/**
 * Comets module — selective hydration, marked at the point of use in JSX rather than only by file
 * location. Server-side composition (`defineComet`, the marker protocol, the manifest that
 * correlates a comet's source to its built client URL) lives here; the client-side counterpart
 * (`hydrateComets`) lives under `@zanix/space/client` — see that module's own doc for why the two
 * are kept apart.
 *
 * @module
 */
export { defineComet } from './define-comet.tsx'
export type { CometProps, CometStrategy } from 'typings/comet.ts'
export { loadCometManifest, resolveCometModuleUrl } from './comet-manifest.ts'
export type { CometManifest } from './comet-manifest.ts'
