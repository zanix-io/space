import { InternalError } from '@zanix/errors'
import type { SitemapEntry } from './sitemap.ts'

/**
 * The build-time counterpart of `defineSpaceApp({ sitemap: 'auto' })` — `buildSpaceClient()`
 * derives entries from this app's own static route tree (`deriveAutoSitemapEntries`,
 * `modules/bundler/auto-sitemap.ts`) and hands them back in its own result; `zanix space build`
 * writes them here, into the client build's output directory, same convention as
 * `comets-manifest.json`/`css-manifest.json`. `defineSpaceApp`'s own `setup()` reads this back
 * automatically ONLY when `clientBuildDir` is also configured (same batch as
 * `loadCometManifest`/`loadCssManifest`) and registers it as a plain `SitemapEntry[]` — the exact
 * same zero-per-request-cost path a hand-written literal array already takes, never a new caching
 * mechanism of its own. Without `clientBuildDir`, call {@linkcode loadSitemapManifest} yourself
 * from `main.ts` — omitting both means `GET /sitemap.xml` never registers in production at all,
 * even though a real build already derived the entries.
 *
 * A dev server never reads or writes this file: `defineSpaceApp`'s own `setup()` derives `'auto'`
 * entries live under `znx space dev` instead, the same "recompute on every request, never trust a
 * possibly-stale build artifact sitting on disk" rule `clientBuildDir`'s own doc already documents
 * for the other four manifests.
 *
 * @module
 */

let manifest: SitemapEntry[] | undefined

/**
 * Loads the manifest `zanix space build` writes for `defineSpaceApp({ sitemap: 'auto' })` — call
 * once, before serving any requests, same timing as `loadCometManifest`/`loadCssManifest`. A
 * missing file is not an error: it's the normal case before a project's first real build, or for
 * an app that never opted into `'auto'` at all — `defineSpaceApp`'s own `setup()` simply skips
 * registering a sitemap route in that case, same as `sitemap` being omitted entirely.
 *
 * @param path - Path to the manifest JSON file, as written by `zanix space build`.
 */
export async function loadSitemapManifest(path: string): Promise<void> {
  try {
    manifest = JSON.parse(await Deno.readTextFile(path))
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return
    throw new InternalError(`Failed to load the sitemap manifest from "${path}".`, {
      cause: error,
      meta: { source: 'zanix', method: 'loadSitemapManifest', path },
    })
  }
}

/** The currently loaded manifest, or `undefined` if {@linkcode loadSitemapManifest} was never
 * called, found no file, or the app's own `sitemap` declaration is not `'auto'` at all. */
export function getSitemapManifest(): SitemapEntry[] | undefined {
  return manifest
}

/** Test-only escape hatch — sets (or clears, via `undefined`) the manifest directly, without
 * touching the filesystem. Same convention as `comet-manifest.ts`'s own `setCometManifest`. Not
 * exported from this package's public entry points. */
export function setSitemapManifest(value: SitemapEntry[] | undefined): void {
  manifest = value
}
