import { join } from '@std/path'
import { InternalError } from '@zanix/errors'

/** A single directory level's own composition files, relative to the routes directory root —
 * `undefined` for whichever of the three a given directory doesn't have. */
export type PageSegmentFiles = {
  layoutFilePath?: string
  loadingFilePath?: string
  errorFilePath?: string
}

/** A `page.tsx` file discovered under a routes directory, paired with its derived route path. */
export type DiscoveredPage = {
  /** The page file's path, relative to the routes directory root it was discovered under. */
  filePath: string
  /** The route path derived from the folder structure (e.g. `'products/:id'`), never leading-slashed. */
  routePath: string
  /** This page's composition chain, root directory first, its own directory last — each entry's
   * `layoutFilePath`/`loadingFilePath`/`errorFilePath` is only set for a directory that actually
   * has that file, never inherited/duplicated from an ancestor. */
  segments: PageSegmentFiles[]
}

/** Maps a `[param]` folder segment to its route-path form (`:param`); any other segment is literal. */
function toRouteSegment(folderName: string): string {
  const match = /^\[(.+)\]$/.exec(folderName)
  return match ? `:${match[1]}` : folderName
}

/**
 * Walks a SINGLE directory looking for files literally named `page.tsx`, deriving each one's route
 * path from its folder structure — the folder tree itself is the route composition, exactly as
 * file-based routing conventions across the ecosystem (Fresh, Next.js, Astro) already establish. A
 * `[id]` folder segment becomes the dynamic segment `:id`. Along the way, also records each
 * directory level's own `layout.tsx`/`loading.tsx`/`error.tsx` (if present) as that page's
 * composition chain — `loadRoutes()` uses this to wrap the page in its layouts/Suspense-fallback/
 * error-boundary, from THIS directory's own root down to the page's own directory. Deliberately
 * never looks outside `dir` for a missing ancestor file: a page's composition chain is always
 * resolved entirely within the one directory that provided it (see {@linkcode scanPageFiles}'s own
 * doc for why, when `routesDir` is an array).
 *
 * A `dir` that doesn't exist yet is treated as zero pages, not an error.
 */
async function walkOneDir(dir: string): Promise<DiscoveredPage[]> {
  async function walk(
    dir: string,
    segments: string[],
    ancestry: PageSegmentFiles[],
  ): Promise<DiscoveredPage[]> {
    const entries: Deno.DirEntry[] = []
    try {
      for await (const entry of Deno.readDir(dir)) entries.push(entry)
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return []
      // Composition-time-only (never runs per-request) — see `comet-manifest.ts`'s own
      // `loadCometManifest` for why no `code`/`userMessage` here, matching `WebServerManager`'s
      // `readSslFile` precedent.
      throw new InternalError(`Failed to scan routes directory "${dir}".`, {
        cause: error,
        meta: { source: 'zanix', method: 'scanPageFiles', dir },
      })
    }

    const hasFile = (name: string) => entries.some((entry) => entry.isFile && entry.name === name)
    const ownSegment: PageSegmentFiles = {
      layoutFilePath: hasFile('layout.tsx') ? join(dir, 'layout.tsx') : undefined,
      loadingFilePath: hasFile('loading.tsx') ? join(dir, 'loading.tsx') : undefined,
      errorFilePath: hasFile('error.tsx') ? join(dir, 'error.tsx') : undefined,
    }
    const chain = [...ancestry, ownSegment]

    // Subdirectories are walked in parallel rather than one `await` per loop iteration — each
    // branch of the tree is independent, so there's no reason to serialize them.
    const found = await Promise.all(entries.map((entry) => {
      const entryPath = join(dir, entry.name)
      if (entry.isDirectory) {
        return walk(
          entryPath,
          [...segments, toRouteSegment(entry.name)],
          chain,
        )
      }
      if (entry.isFile && entry.name === 'page.tsx') {
        return Promise.resolve<DiscoveredPage[]>([{
          filePath: entryPath,
          routePath: segments.join('/'),
          segments: chain,
        }])
      }
      return Promise.resolve<DiscoveredPage[]>([])
    }))

    return found.flat()
  }

  return await walk(dir, [], [])
}

/**
 * Discovers every page across one or more routes directories — `routesDir: string[]` (`@zanix/core`'s
 * own `rootDir: string[]` precedent) lets a host compose a base app's pages with its own overrides
 * without forking either tree. Each directory is scanned independently via {@linkcode walkOneDir}
 * (never merged file-by-file), then results are combined by FIRST MATCH: for a `routePath` found in
 * more than one directory, only the entry from the EARLIEST directory (array order) is kept — that
 * directory's own full composition chain (root layout down to the page, from that same walk) is used
 * as-is, never patched with segments from a later directory. This is deliberate: assembling a page's
 * `layout.tsx`/`error.tsx`/`loading.tsx` chain from two different directories would produce a
 * "Frankenstein page" whose ancestors were never actually designed to compose together. A single
 * `string` (the common case) behaves exactly as before this array support existed.
 *
 * @param routesDir - The routes directory root(s), relative to the current working directory. A
 * directory that doesn't exist yet is treated as zero pages, not an error — a brand new app with no
 * `routes/` folder must still start.
 * @returns The discovered pages, first-match-wins across `routesDir`'s own order, otherwise in the
 * order they were found (not otherwise significant).
 */
export async function scanPageFiles(
  routesDir: string | string[],
): Promise<DiscoveredPage[]> {
  const dirs = Array.isArray(routesDir) ? routesDir : [routesDir]
  const perDir = await Promise.all(dirs.map(walkOneDir))

  const seenRoutePaths = new Set<string>()
  const pages: DiscoveredPage[] = []
  for (const found of perDir) {
    for (const page of found) {
      if (seenRoutePaths.has(page.routePath)) continue
      seenRoutePaths.add(page.routePath)
      pages.push(page)
    }
  }
  return pages
}
