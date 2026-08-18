/**
 * `assetsDir`'s own optional hashing layer — `assetsPlugin` (`@zanix/space/vite`) writes
 * `assets-manifest.json` during a production client build, correlating every asset's stable
 * relative path (`logo.svg`) to its real, content-hashed build output URL
 * (`/assets/logo-a1b2c3.svg`). Loaded back here, once, at server startup — same convention
 * `loadCssManifest`/`loadCometManifest` already establish.
 *
 * Purely additive: `assetsDir`'s own existing route (`register-assets.ts`) keeps serving the
 * stable, unhashed `/assets/<relative-path>` URL exactly as before whether or not a manifest was
 * ever loaded — nothing here changes that contract. What's new is {@linkcode resolveAssetHref}, an
 * opt-in accessor a component calls when it wants the stronger, `immutable`-cacheable hashed URL
 * instead.
 *
 * @module
 */

let manifest: Record<string, string> | undefined
let buildOutputDir: string | undefined

/**
 * Loads the manifest `assetsPlugin` writes during a production client build.
 *
 * Call this once, before serving any requests — same convention as `loadCssManifest`/
 * `loadCometManifest`, typically alongside them in this app's own `main.ts`. A missing file is not
 * an error — the normal case whenever this app declares no `assetsDir` at all, or never ran a real
 * `zanix space build` (dev, or prod before the first one).
 *
 * @param path - Path to the manifest JSON file, as written by `assetsPlugin`.
 */
export async function loadAssetsManifest(path: string): Promise<void> {
  try {
    manifest = JSON.parse(await Deno.readTextFile(path))
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return
    throw error
  }
}

/**
 * Tells the runtime WHERE `assetsPlugin` actually wrote the hashed asset files — the client
 * build's own output directory, same value `loadPwaBuildOutput` already takes for the exact same
 * reason (PWA icons). `register-assets.ts`'s own route reads a hashed request's real bytes from
 * here — `${dir}/assets/<hashed-name>` — before ever falling back to the live, unhashed source
 * lookup {@linkcode getAssetPath} already provides.
 *
 * Call this — alongside `loadPwaBuildOutput`/`loadCometManifest`/`loadCssManifest` — in this app's
 * own `main.ts`, BEFORE `activateApps()`/`Zanix.start()`.
 *
 * @param dir - The client build's own output directory (e.g. `'./dist/client'`).
 */
export function loadAssetsBuildOutput(dir: string): void {
  buildOutputDir = dir
}

/** Test-only escape hatch — sets (or clears, via `undefined`) both the manifest and the build
 * output directory directly, without touching the filesystem. Not exported from this package's
 * public entry points. */
export function setAssetsManifestState(
  value: { manifest?: Record<string, string>; buildOutputDir?: string } | undefined,
): void {
  manifest = value?.manifest
  buildOutputDir = value?.buildOutputDir
}

/** The currently loaded manifest, or `undefined` if none was ever loaded. Read by
 * {@linkcode resolveAssetHref} and by `register-assets.ts`'s own route. */
export function getAssetsManifest(): Record<string, string> | undefined {
  return manifest
}

/** The currently loaded build output directory, or `undefined` if {@linkcode loadAssetsBuildOutput}
 * was never called. Read by `register-assets.ts`'s own route. */
export function getAssetsBuildOutput(): string | undefined {
  return buildOutputDir
}

/**
 * Resolves `relativePath` (e.g. `'logo.svg'`, `'icons/favicon.png'`) to its real, hashed build
 * output URL when a manifest is loaded — the same stable `/assets/<relative-path>` value
 * `assetsDir`'s own convention already documents otherwise (dev, or prod before a real build ever
 * ran, or a `relativePath` the manifest simply doesn't have — a stale reference, or a file
 * `assetsDir`'s own directory genuinely doesn't contain). Never throws, never 404s on its own —
 * this only computes a URL string, it doesn't touch the filesystem or assert the file exists.
 *
 * This is the `resolveAssetHref` this package's own `asset-registry.ts` doc comment already
 * anticipated ("the serving route, a future `resolveAssetHref`") — an opt-in way to reference an
 * asset by its stronger-cacheable hashed URL instead of the always-available stable one, for a
 * component that specifically wants `Cache-Control: immutable` (see `register-assets.ts`'s own
 * doc for exactly which responses get that).
 *
 * @example
 * ```tsx
 * <img src={resolveAssetHref('logo.svg')} alt="logo" />
 * ```
 */
export function resolveAssetHref(relativePath: string): string {
  return manifest?.[relativePath] ?? `/assets/${relativePath}`
}
