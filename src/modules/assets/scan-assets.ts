import { join } from '@std/path'

/**
 * Walks a SINGLE directory recursively, mapping every file found to its own relative path (POSIX
 * separators, built from directory-entry NAMES as the walk descends — never derived from
 * `@std/path`'s own `relative()`, so this never depends on the host OS's path separator). Mirrors
 * `scanPageFiles`'s own `walkOneDir` in spirit: a pure, read-only directory walk, never registering
 * or serving anything itself.
 *
 * A `dir` that doesn't exist yet is treated as zero assets, not an error — same convention
 * `scanPageFiles`/`routesDir` already establish.
 */
async function walkOneAssetsDir(dir: string): Promise<Map<string, string>> {
  const found = new Map<string, string>()

  async function walk(currentDir: string, segments: string[]): Promise<void> {
    const entries: Deno.DirEntry[] = []
    try {
      for await (const entry of Deno.readDir(currentDir)) entries.push(entry)
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return
      throw error
    }

    // Subdirectories are walked in parallel — each branch is independent, same reasoning
    // `scanPageFiles`'s own walk already documents.
    await Promise.all(entries.map(async (entry) => {
      const entryPath = join(currentDir, entry.name)
      if (entry.isDirectory) {
        await walk(entryPath, [...segments, entry.name])
      } else if (entry.isFile) {
        found.set([...segments, entry.name].join('/'), entryPath)
      }
    }))
  }

  await walk(dir, [])
  return found
}

/**
 * Discovers every asset file across one or more directories — `assetsDir: string[]` mirrors
 * `routesDir[]`'s own precedent (`@zanix/core`'s `rootDir: string[]`, `@zanix/space`'s own
 * `routesDir`): lets a HOST compose a base app's own assets with its own override directory (or
 * several) without forking either tree.
 *
 * Each directory is scanned independently via {@linkcode walkOneAssetsDir}, then merged by FIRST
 * MATCH: for a relative path found in more than one directory, only the entry from the EARLIEST
 * directory (array order) is kept — a later directory's own file at that same relative path is
 * never even read. Evaluated independently per relative path (unlike a page's own nested
 * `layout`/`error`/`loading` chain, an asset is a single, self-contained file — there is no
 * "ancestor" concept to keep from crossing directories here).
 *
 * @param assetsDir - One or more directory roots, relative to the current working directory. A
 * directory that doesn't exist yet contributes zero assets, not an error.
 * @returns A `Map` of relative path (POSIX, e.g. `'logo.svg'`, `'icons/favicon.png'`) → the real,
 * absolute file path of whichever directory's copy won.
 */
export async function scanAssets(
  assetsDir: string | string[],
): Promise<Map<string, string>> {
  const dirs = Array.isArray(assetsDir) ? assetsDir : [assetsDir]
  const perDir = await Promise.all(dirs.map(walkOneAssetsDir))

  const resolved = new Map<string, string>()
  for (const found of perDir) {
    for (const [relativePath, absolutePath] of found) {
      if (resolved.has(relativePath)) continue
      resolved.set(relativePath, absolutePath)
    }
  }
  return resolved
}
