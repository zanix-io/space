'server-only'

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
 * The leading `'server-only'` flag above (`ZNX_FLAGS`/`use-znx-flags` in `@zanix/utils`,
 * `comet-plugin.ts`'s own enforcement in `@zanix/space`) marks this module as one that must never
 * reach a Comet's client bundle — this module holds server-only state (`Deno.readTextFile`,
 * module-scoped mutable manifest). Without it, a Comet that (directly or transitively, e.g.
 * through a `resolveAssetHref`-calling wrapper component) imports this module fails the build with
 * an opaque bundler resolution error instead of `cometPlugin`'s own clear, purpose-built violation
 * message — confirmed as the real failure a `'use comet'` file hits by importing
 * `resolveAssetHref` transitively; this directive is what makes that failure actionable instead of
 * a bare "module not found".
 *
 * @module
 */

import { InternalError } from '@zanix/errors'

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
    // Boot-time-only — see `comet-manifest.ts`'s own `loadCometManifest` for why no `code`/
    // `userMessage` here, matching `WebServerManager`'s `readSslFile` precedent.
    throw new InternalError(`Failed to load the assets manifest from "${path}".`, {
      cause: error,
      meta: { source: 'zanix', method: 'loadAssetsManifest', path },
    })
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
 * @param dir - The client build's own output directory (e.g. `'./.dist/client'`).
 */
export function loadAssetsBuildOutput(dir: string): void {
  buildOutputDir = dir
}

/** Test-only escape hatch — sets (or clears, via `undefined`) both the manifest and the build
 * output directory directly, without touching the filesystem. Reachable via the public
 * `@zanix/space/assets-manifest` subpath (`deno.jsonc`'s `./assets-manifest` maps this whole file),
 * same as {@linkcode loadAssetsManifest}/{@linkcode loadAssetsBuildOutput} above — unlike the
 * equivalent test-only hatches in sibling modules (`setCometManifest`, `setCssManifest`, ...),
 * which sit behind a curated barrel that never re-exports them. Not meant for production use: an
 * app author has no real reason to call this outside a test fixture. */
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
 * **Call this from a page/layout's own render or `loader`, never from inside a `'use comet'`
 * file** — this whole module is `'server-only'` (see this file's own top-of-file directive): a
 * Comet's own code ships to the browser, and this function's underlying state (the manifest,
 * loaded via `Deno.readTextFile`) only ever exists server-side. If a Comet genuinely needs a
 * resolved href, compute it in the page that renders that Comet and pass the STRING result down as
 * a prop — never import this function (or anything that calls it, like a `CatalogIcon` wrapper
 * built around it) from Comet code directly. Doing so fails a real build with a clear, named
 * violation (`cometPlugin`'s own "Server-only module imported into client Comet" error), not a
 * silent runtime bug — but the failure is much easier to preempt than to debug after the fact.
 *
 * @example
 * ```tsx
 * <img src={resolveAssetHref('logo.svg')} alt="logo" />
 * ```
 */
export function resolveAssetHref(relativePath: string): string {
  return manifest?.[relativePath] ?? `/assets/${relativePath}`
}
