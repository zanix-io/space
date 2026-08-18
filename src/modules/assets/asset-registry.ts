/**
 * Process-wide singleton holding the already-resolved (first-match-wins) asset map — populated
 * exactly once, in `defineSpaceApp()`'s own `setup()` (same timing as `loadRoutes()`), never
 * recomputed per request. `undefined` means this app never declared `assetsDir` at all — the
 * feature is simply off, not an empty/zero-asset state (see {@linkcode getResolvedAssets}'s own
 * doc for why that distinction matters for backward compatibility).
 *
 * @module
 */
let resolvedAssets: Map<string, string> | undefined
let assetsDirConfig: string | string[] | undefined

/**
 * Set once by `defineSpaceApp({ assetsDir })`, EAGERLY (same timing as `pwa`/`globalCss`/
 * `renderer` — see `defineSpaceApp`'s own doc), unlike {@linkcode setResolvedAssets} below (which
 * still only runs inside `setup()`, since scanning the directory is real, async filesystem work).
 * This is what lets `buildSpaceClient()` learn WHICH directories to hash during `zanix space build`
 * without needing `activateApps()` to have run first — that CLI action never calls it (same real
 * gap `getActiveRenderer()`'s own doc already found and fixed for `renderer`; `assetsDir` had the
 * identical gap until this was added).
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
