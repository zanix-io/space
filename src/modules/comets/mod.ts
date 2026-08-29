/**
 * Comets module — selective hydration, marked at the point of use in JSX rather than only by file
 * location. Server-side composition (`defineComet`, the marker protocol, the manifest that
 * correlates a comet's source to its built client URL) lives here; the client-side counterpart
 * (`hydrateComets`) lives under `@zanix/space/client` — see that module's own doc for why the two
 * are kept apart.
 *
 * Published under `@zanix/space/comet`, deliberately NOT re-exported from `.` (`mod.ts`) — a real
 * Comet source file's own `import { defineComet } from '@zanix/space/comet'` must never resolve
 * `.`'s own genuinely server/dev-only exports (`defineSpaceApp`, `SpaceDevSocket`'s real
 * decorators, ...) just by being in the same barrel — see `deno.jsonc`'s own `"./comet"` entry
 * comment for the full reasoning, confirmed as a real browser-build failure.
 *
 * @module
 */
export { defineComet } from './define-comet.ts'
export type {
  CometBoundaryComponent,
  CometComponent,
  CometProps,
  CometStrategy,
} from 'typings/comet.ts'
export { loadCometManifest, resolveCometModuleUrl } from './comet-manifest.ts'
export type { CometManifest } from './comet-manifest.ts'
