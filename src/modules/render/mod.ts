/**
 * Render module — streaming SSR core and the request-scoped promise cache `use()` needs but React
 * doesn't provide.
 *
 * `read-initial-state.ts` is deliberately NOT re-exported here — this barrel is consumed from
 * server code (it transitively imports `react-dom/server` via `render-to-response.tsx`); a client
 * bundle must import `read-initial-state.ts` directly instead, to avoid pulling server-only code
 * into the client entry.
 *
 * @module
 */
export { renderToResponse } from './render-to-response.tsx'
export type { RenderToResponseOptions } from './render-to-response.tsx'
export { RequestCacheProvider, useRequestCache } from './request-cache.tsx'
export type { RequestCache } from './request-cache.tsx'
export {
  getCssManifest,
  getGlobalCssPaths,
  loadCssManifest,
  resolveCssHrefs,
  setGlobalCssPaths,
} from './css-manifest.ts'
export type { CssManifest } from './css-manifest.ts'
