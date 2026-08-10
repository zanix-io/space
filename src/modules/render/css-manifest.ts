import { isDevClientEnabled } from '../dev/dev-client-registry.ts'
import { resolveDevCssHrefs } from '../dev/dev-css-hrefs.ts'

/** The built stylesheet URLs a page's document needs — written by `cssPlugin` during the client
 * build (`css-manifest.json`, in the client build's own output directory), read back here once at
 * server startup. Order matters (later entries can override earlier ones via normal CSS cascade),
 * so this is a plain ordered list, not a map. */
export type CssManifest = string[]

let manifest: CssManifest | undefined
let globalCssPaths: string[] | undefined

/**
 * Loads the manifest `cssPlugin` writes during a production client build, so a page's document can
 * link to its real, hashed stylesheet URL(s) instead of nothing at all.
 *
 * Call this once, before serving any requests — same convention as `loadCometManifest`, typically
 * right after it in this app's own `main.ts`. A missing file is not an error — the normal case
 * whenever this app declares no `globalCss` at all, or (dev) whenever `resolveCssHrefs` is about
 * to serve the dev-resolved hrefs instead (see its own doc).
 *
 * @param path - Path to the manifest JSON file, as written by `cssPlugin`.
 */
export async function loadCssManifest(path: string): Promise<void> {
  try {
    manifest = JSON.parse(await Deno.readTextFile(path))
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return
    throw error
  }
}

/** Test-only escape hatch — sets (or clears, via `undefined`) the manifest directly, without
 * touching the filesystem. Not exported from this package's public entry points. */
export function setCssManifest(value: CssManifest | undefined): void {
  manifest = value
}

/** The currently loaded manifest, or `undefined` if none was loaded — production only; see
 * {@linkcode resolveCssHrefs} for the dev-aware accessor `SpacePageController`/
 * `createNotFoundHandler` actually call. */
export function getCssManifest(): CssManifest | undefined {
  return manifest
}

/**
 * Set once by `defineSpaceApp({ globalCss })`, eagerly (same timing as `pwa` — see
 * `defineSpaceApp`'s own doc) — the app's own declared global stylesheet source paths (e.g.
 * `['./styles/reset.css', './styles/app.css']`), the single source of truth
 * {@linkcode resolveCssHrefs} resolves from in dev, and the real client build's own
 * `rollupOptions.input` is meant to include in production (not yet wired — see `SpaceAppConfig`'s
 * own doc on `globalCss` for the current state of that piece).
 */
export function setGlobalCssPaths(paths: string[] | undefined): void {
  globalCssPaths = paths
}

/** Test-only escape hatch, same reasoning as {@linkcode setCssManifest}. */
export function getGlobalCssPaths(): string[] | undefined {
  return globalCssPaths
}

/**
 * The stylesheet hrefs a full-document response should `<link>` — the one accessor
 * `SpacePageController`/`createNotFoundHandler` actually call, never {@linkcode getCssManifest}
 * directly. Dev-aware: in `znx space dev` (`isDevClientEnabled()`), resolves
 * {@linkcode getGlobalCssPaths}'s declared source paths straight through
 * `resolveDevCssHrefs` — no build, no hashing, no manifest file involved. Outside of dev, returns
 * the production {@linkcode getCssManifest} unchanged (`undefined` if none was ever loaded).
 *
 * The two paths read from the SAME declared source in intent (`globalCss`) — production's own
 * `css-manifest.json` is meant to be exactly `globalCss`'s files translated to their real, hashed
 * build output URLs, never an independently-discovered list (see `SpaceAppConfig.globalCss`'s own
 * doc for why, and for what's genuinely still missing to make that true end-to-end).
 */
export function resolveCssHrefs(): CssManifest | undefined {
  if (isDevClientEnabled()) return resolveDevCssHrefs(globalCssPaths ?? [])
  return manifest
}
