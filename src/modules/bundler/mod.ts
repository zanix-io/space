/**
 * Bundler module — the `@zanix/space/vite` entry point.
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
export type { AssetsOptimizeOptions, AssetsPluginOptions } from './assets-plugin.ts'
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
export type { RenderProbeOptions, RenderProbeResult } from './render-probe.ts'
