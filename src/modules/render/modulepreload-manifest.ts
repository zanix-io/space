import { InternalError } from '@zanix/errors'

/**
 * The static dependencies of every built client chunk a page can load: each key is a chunk's URL
 * (`/assets/<name>.js`, the same value `comets-manifest.json` and `client-entry-manifest.json`
 * hold), each value the URLs of every chunk it imports statically, directly or through another
 * chunk, nearest first. A chunk with no static import of another chunk has no key.
 *
 * `zanix space build` writes it as `modulepreload-manifest.json` (`modulePreloadPlugin`), from the
 * bundler's own graph, so the browser can fetch a chunk and its dependencies in one round instead of
 * discovering each level of imports only after the level above it arrived.
 */
export type ModulePreloadManifest = Record<string, string[]>

/** The file `modulePreloadPlugin` writes next to the build's other manifests. */
export const MODULE_PRELOAD_MANIFEST_FILE = 'modulepreload-manifest.json'

/**
 * The most dependency URLs one chunk lists in a page. A chunk's own closure is almost always a
 * handful of shared chunks; the cap only stops an unusually deep graph from asking the browser to
 * fetch dozens of modules at once, which would compete with the stylesheets and scripts the page
 * needs first.
 */
export const MAX_MODULE_PRELOADS_PER_CHUNK = 24

let manifest: ModulePreloadManifest | undefined
let enabled = true

/**
 * Loads the manifest `modulePreloadPlugin` writes during a production client build. A missing file
 * is not an error: a build made before this manifest existed has none, and then a page links no
 * `modulepreload` at all (see {@linkcode resolveModulePreloads}).
 *
 * Call it once, at boot, next to `loadCometManifest` and `loadCssManifest`.
 *
 * @param path - Path to the manifest JSON file.
 */
export async function loadModulePreloadManifest(path: string): Promise<void> {
  try {
    manifest = JSON.parse(await Deno.readTextFile(path))
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return
    throw new InternalError(`Failed to load the module preload manifest from "${path}".`, {
      cause: error,
      meta: { source: 'zanix', method: 'loadModulePreloadManifest', path },
    })
  }
}

/** Test-only escape hatch: sets (or clears, via `undefined`) the manifest without the filesystem. */
export function setModulePreloadManifest(value: ModulePreloadManifest | undefined): void {
  manifest = value
}

/** The currently loaded manifest, or `undefined` when none was loaded (dev, or an older build). */
export function getModulePreloadManifest(): ModulePreloadManifest | undefined {
  return manifest
}

/**
 * Turns the module preloads on or off for this process (`defineSpaceApp({ modulepreload })`). On
 * by default.
 */
export function setModulePreloadEnabled(value: boolean): void {
  enabled = value
}

/** Whether the module preloads are on. */
export function isModulePreloadEnabled(): boolean {
  return enabled
}

/**
 * The URLs to preload for one chunk: the chunk itself, then its static dependencies, nearest first,
 * capped at {@linkcode MAX_MODULE_PRELOADS_PER_CHUNK} dependencies.
 *
 * `[]` whenever there is nothing to say: the preloads are off, no manifest was loaded (dev, or a
 * build that predates it), or `chunkUrl` is unknown. In dev there is no build and no hashed chunk
 * names, so nothing is ever preloaded there.
 *
 * @param chunkUrl - The chunk's URL, as `comets-manifest.json`/`client-entry-manifest.json` hold it.
 */
export function resolveModulePreloads(chunkUrl: string | undefined): string[] {
  if (!enabled || manifest === undefined || !chunkUrl) return []
  const dependencies = manifest[chunkUrl] ?? []
  return [chunkUrl, ...dependencies.slice(0, MAX_MODULE_PRELOADS_PER_CHUNK)]
}

const MODULE_PRELOAD_LINK = /<link\s[^>]*?rel="modulepreload"[^>]*?>/g
const HREF_ATTRIBUTE = /\shref="([^"]*)"/

/**
 * Removes every `<link rel="modulepreload">` whose `href` an earlier one in `html` already carries,
 * keeping the first. Preact has no resource hoisting, so two comets that share a dependency would
 * each link it; React dedupes by `href` on its own. A string the markup never mentions is returned
 * as it came, without a pass.
 */
export function dedupeModulePreloadLinks(html: string): string {
  if (!html.includes('rel="modulepreload"')) return html
  const seen = new Set<string>()
  return html.replace(MODULE_PRELOAD_LINK, (link) => {
    const href = HREF_ATTRIBUTE.exec(link)?.[1]
    if (href === undefined) return link
    if (seen.has(href)) return ''
    seen.add(href)
    return link
  })
}
