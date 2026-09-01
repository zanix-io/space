/**
 * Process-wide singleton holding the already-resolved (first-match-wins) asset map — populated
 * exactly once, in `defineSpaceApp()`'s own `setup()` (same timing as `loadRoutes()`), never
 * recomputed per request. `undefined` means this app never declared `assetsDir` at all — the
 * feature is simply off, not an empty/zero-asset state (see {@linkcode getResolvedAssets}'s own
 * doc for why that distinction matters for backward compatibility).
 *
 * @module
 */
import type { AssetsOptimizeOptions } from 'modules/bundler/assets-plugin-types.ts'
import type { MediaOptimizeOptions } from 'modules/bundler/media-plugin-types.ts'

let resolvedAssets: Map<string, string> | undefined
let assetsDirConfig: string | string[] | undefined
let optimizeConfig: AssetsOptimizeOptions | undefined
let mediaConfig: MediaOptimizeOptions | undefined

/**
 * Set once by `defineSpaceApp({ assetsDir })`, EAGERLY (same timing as `pwa`/`globalCss`/
 * `renderer` — see `defineSpaceApp`'s own doc), unlike {@linkcode setResolvedAssets} below (which
 * still only runs inside `setup()`, since scanning the directory is real, async filesystem work).
 * This is what lets `buildSpaceClient()` learn WHICH directories to hash during `zanix space build`
 * without needing `activateApps()` to have run first — that CLI action never calls it (the same
 * class of gap `getActiveRenderer()`'s own doc already covers for `renderer`, applying identically
 * to `assetsDir` here).
 */
export function setAssetsDirConfig(dirs: string | string[]): void {
  assetsDirConfig = dirs
}

/** Test-only escape hatch — mirrors {@linkcode resetResolvedAssets}'s own reasoning. Not exported
 * from this package's public entry points. */
export function resetAssetsDirConfig(): void {
  assetsDirConfig = undefined
}

/** The `assetsDir` value `defineSpaceApp()` was last called with, or `undefined` if this app never
 * declared it — read by `buildSpaceClient()`'s own default for its `assetsDir` option, the same
 * eager-registry pattern `globalCss`/`renderer` already establish. */
export function getAssetsDirConfig(): string | string[] | undefined {
  return assetsDirConfig
}

/** Set once by `defineSpaceApp({ optimize })`, EAGERLY — same timing/reasoning as
 * {@linkcode setAssetsDirConfig} above (this is the config half of the SAME feature; a build
 * script only ever wants one, never scans a directory without knowing whether to optimize it, or
 * vice versa). Lets `buildSpaceClient()` learn what `assetsPlugin({ optimize })` to run during
 * `zanix space build` without needing `activateApps()` to have run first. */
export function setOptimizeConfig(optimize: AssetsOptimizeOptions): void {
  optimizeConfig = optimize
}

/** Test-only escape hatch — mirrors {@linkcode resetAssetsDirConfig}'s own reasoning. Not exported
 * from this package's public entry points. */
export function resetOptimizeConfig(): void {
  optimizeConfig = undefined
}

/** The `optimize` value `defineSpaceApp()` was last called with, or `undefined` if this app never
 * declared it — read by `buildSpaceClient()`'s own default for its `optimize` option, same
 * eager-registry pattern `assetsDir` above already establishes. `undefined` here means
 * `assetsPlugin` runs with no `optimize` at all — its own pre-existing, unoptimized hash-and-emit
 * behavior, completely unchanged for any app that never declares this. */
export function getOptimizeConfig(): AssetsOptimizeOptions | undefined {
  return optimizeConfig
}

/** Set once by `defineSpaceApp({ media })`, EAGERLY — same timing/reasoning as
 * {@linkcode setOptimizeConfig} above, for `mediaPlugin` instead of `assetsPlugin`. A SIBLING
 * config surface, deliberately never folded into `optimize` itself: `assetsPlugin`/`mediaPlugin`
 * stay two independent plugins (see `AssetManifestRegistry`'s own doc for why), so their own
 * config surfaces stay independent too — one plugin's options object never grows a field that
 * only the other plugin understands. */
export function setMediaConfig(media: MediaOptimizeOptions): void {
  mediaConfig = media
}

/** Test-only escape hatch — mirrors {@linkcode resetOptimizeConfig}'s own reasoning. Not exported
 * from this package's public entry points. */
export function resetMediaConfig(): void {
  mediaConfig = undefined
}

/** The `media` value `defineSpaceApp()` was last called with, or `undefined` if this app never
 * declared it — read by `buildSpaceClient()`'s own default for its `media` option, same
 * eager-registry pattern `optimize` above already establishes. `undefined` here means
 * `mediaPlugin` never even runs — an app with no video optimization declared pays nothing, same
 * "omitted assetsDir/optimize skip the whole plugin" convention `assetsPlugin` already follows. */
export function getMediaConfig(): MediaOptimizeOptions | undefined {
  return mediaConfig
}

/** Set once by `defineSpaceApp()`'s own `setup()`, from {@linkcode scanAssets}'s own return value —
 * never called directly by application code. */
export function setResolvedAssets(assets: Map<string, string>): void {
  resolvedAssets = assets
}

/** Test-only escape hatch — mirrors `setGlobalCssPaths`'s own reasoning: an exact reset/replace,
 * for test cleanup. Not exported from this package's public entry points. */
export function resetResolvedAssets(): void {
  resolvedAssets = undefined
}

/** The currently resolved asset map, or `undefined` if this app never declared `assetsDir` at all
 * — distinct from an empty `Map` (declared, but every directory was empty/missing), which still
 * means "the feature is on, there's just nothing to serve." Only `undefined` means "never opted
 * in," the state every pre-existing app (that never declares `assetsDir`) stays in forever. */
export function getResolvedAssets(): Map<string, string> | undefined {
  return resolvedAssets
}

/** Resolves `relativePath` (e.g. `'logo.svg'`, `'icons/favicon.png'`) to the real, absolute file
 * path of whichever directory's copy won `assetsDir`'s own first-match-wins resolution —
 * `undefined` if this app never declared `assetsDir`, or if no directory has a file at that path.
 * The one place any caller (the serving route, a future `resolveAssetHref`) reads this state. */
export function getAssetPath(relativePath: string): string | undefined {
  return resolvedAssets?.get(relativePath)
}
