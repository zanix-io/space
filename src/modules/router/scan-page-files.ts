import { join } from '@std/path'

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
 * Walks `routesDir` looking for files literally named `page.tsx`, deriving each one's route path
 * from its folder structure — the folder tree itself is the route composition, exactly as file-based
 * routing conventions across the ecosystem (Fresh, Next.js, Astro) already establish. A `[id]`
 * folder segment becomes the dynamic segment `:id`. Along the way, also records each directory
 * level's own `layout.tsx`/`loading.tsx`/`error.tsx` (if present) as that page's composition chain —
 * `loadRoutes()` uses this to wrap the page in its layouts/Suspense-fallback/error-boundary, from
 * the routes root down to the page's own directory. Read-only: never registers or imports anything
 * itself — see `loadRoutes()` for the step that actually does.
 *
 * A `routesDir` that doesn't exist yet is treated as zero pages, not an error — a brand new app
 * with no `routes/` folder must still start.
 *
 * @param routesDir - The routes directory root, relative to the current working directory.
 * @returns The discovered pages, in the order they were found (not otherwise significant).
 */
export async function scanPageFiles(routesDir: string): Promise<DiscoveredPage[]> {
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
      throw error
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
        return walk(entryPath, [...segments, toRouteSegment(entry.name)], chain)
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

  return await walk(routesDir, [], [])
}
