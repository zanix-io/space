/**
 * Bundler module — the `@zanix/space/vite` entry point.
 *
 * A consumer that only ever needs ONE of `assetsPlugin`/`mediaPlugin` should import from
 * `@zanix/space/vite/assets` or `@zanix/space/vite/media` instead of this barrel — both plugin
 * functions are re-exported here from the same file, and a plain ES module barrel resolves every
 * one of its own export statements' source files the moment anything is imported from it, so
 * importing only `mediaPlugin` from here still resolves `assetsPlugin`'s own file (and
 * transitively `sharp`/`svgo`), and vice versa. See `assets-plugin.ts`'s/`media-plugin.ts`'s own
 * doc for what each narrower subpath exports on its own.
 *
 * @module
 */
export { spacePlugin } from './space-plugin.ts'
export type { SpacePluginOptions } from './space-plugin.ts'
export { cometPlugin } from './comet-plugin.ts'
export type { CometPluginOptions } from './comet-plugin.ts'
export { cssPlugin } from './css-plugin.ts'
export type { CssPluginOptions } from './css-plugin.ts'
export { pwaPlugin, SW_FILE_NAME } from './pwa-plugin.ts'
export type { PwaPluginOptions } from './pwa-plugin.ts'
export { assetsPlugin } from './assets-plugin.ts'
export type {
  /** `assetsPlugin({ optimize })`'s own image/SVG optimization options — see `@zanix/space/vite`'s
   * own doc for the full never-worsen, strictly-smaller-or-kept contract. */
  AssetsOptimizeOptions,
  AssetsPluginOptions,
} from './assets-plugin.ts'
export { mediaPlugin } from './media-plugin.ts'
export type {
  /** `mediaPlugin({ optimize })`'s own video/thumbnail/audio transcoding options. */
  MediaOptimizeOptions,
  MediaPluginOptions,
} from './media-plugin.ts'
export { createAssetManifestRegistry } from '../assets/asset-manifest-registry.ts'
export type { AssetManifestRegistry } from '../assets/asset-manifest-registry.ts'
export type { ImageFormat, ImagesOptimizeOptions } from '../assets/image-optimize.ts'
export type {
  ImageBreakpoint,
  ImageBreakpointName,
  ImageBreakpointOverrides,
} from '../assets/image-breakpoints.ts'
export { createSpaceDevEngine } from './dev-engine.ts'
export type {
  SpaceDevEngine,
  SpaceDevEngineOptions,
  /** Reported once per file change that affects the `ssr` environment's module graph — never for
   * the `client` environment. */
  SsrModuleChangedEvent,
  TransformedAsset,
} from './dev-engine.ts'
export { computeAffectedRoutes } from './affected-routes.ts'
export { buildSpaceClient } from './build-client.ts'
export type { BuildSpaceClientOptions, BuildSpaceClientResult } from './build-client.ts'
export { discoverComets } from './discover-comets.ts'
export { collectPageStyles, discoverPages } from './discover-pages.ts'
export type { DiscoveredPage, DiscoveredPageStyle, ModuleImporter } from './discover-pages.ts'
export { validateBuild } from './validate-build.ts'
export type { ValidateBuildOptions, ValidateBuildResult } from './validate-build.ts'
export { hasDynamicSegment, runRenderProbe } from './render-probe.ts'
export type { ProbeablePage, RenderProbeOptions, RenderProbeResult } from './render-probe.ts'
export type {
  /** `resolveHead`'s own return shape — always fully resolved, no more merging left to do. */
  ResolvedHead,
} from '../router/head-descriptor.ts'
export type { PageRenderer } from '../router/page-renderer-registry.ts'
