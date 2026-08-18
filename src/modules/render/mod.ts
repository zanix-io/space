/**
 * Render module — streaming SSR core and the request-scoped promise cache `use()` needs but React
 * doesn't provide.
 *
 * Renderer-agnostic in full: `renderToResponse` (React's streaming serializer) and the
 * request-scoped promise cache moved to `@zanix/space/react` with the entry-point split, and this
 * barrel now names no renderer at all. `read-initial-state.ts` is deliberately NOT re-exported
 * here either — a client bundle imports it directly, to keep server-side helpers out of the client
 * entry.
 *
 * @module
 */
export {
  addGlobalCssPaths,
  getCssManifest,
  getGlobalCssPaths,
  loadCssManifest,
  resolveCssHrefs,
  setGlobalCssPaths,
} from './css-manifest.ts'
export type { CssManifest, StylesheetRef } from './css-manifest.ts'
