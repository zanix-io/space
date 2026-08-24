import { join } from '@std/path'
import { InternalError } from '@zanix/errors'
import { USE_COMET_DIRECTIVE } from './comet-directive.ts'

const IGNORED_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  '.dist',
  '.vite',
  'coverage',
])
const SOURCE_EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js']

/**
 * Walks `root` looking for every file whose content starts with a `'use comet'` directive — the
 * exact same content-based recognition `cometPlugin` itself applies at build time
 * (`comet-directive.ts`'s shared `USE_COMET_DIRECTIVE`), just run once up front here so
 * `buildSpaceClient` knows which files to hand Vite as real `rollupOptions.input` entries. A
 * comet is deliberately NOT tied to any folder convention — `defineComet` itself doesn't care
 * where its own file lives — so this is a plain content scan, never a path-based one, the same
 * reasoning `cometPlugin`'s own detection already follows.
 *
 * Skips common non-source directories (`node_modules`, build output, dep-optimizer caches, ...) —
 * never descends into them, both for correctness (a comet-looking file inside a dependency isn't
 * this app's own) and so a build doesn't pay to walk potentially enormous trees that could never
 * contain a real comet anyway. A dotfile-prefixed directory (`.git`, `.github`, ...) is skipped the
 * same way, matching the same convention this package's own `deno.json` `exclude`s already use.
 *
 * @param root - Directory to walk. A directory that doesn't exist is treated as zero comets, not
 * an error — the same convention {@linkcode scanPageFiles} already establishes for `routesDir`.
 * @returns Every discovered comet file's real (symlink-resolved) path, in the order found (not
 * otherwise significant) — realpath'd for the same reason `cometPlugin`'s own `transform` hook
 * realpaths its own `id`: it's what `emitFile`/`facadeModuleId` matching ultimately compares
 * against, on a filesystem where a project root can itself be a symlink (macOS's `/tmp`/`/var`).
 */
export async function discoverComets(root: string): Promise<string[]> {
  const found: string[] = []

  async function visit(dir: string): Promise<void> {
    const entries: Deno.DirEntry[] = []
    try {
      for await (const entry of Deno.readDir(dir)) entries.push(entry)
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return
      // Build-time-only (never runs per-request) — see `comet-manifest.ts`'s own
      // `loadCometManifest` for why no `code`/`userMessage` here, matching `WebServerManager`'s
      // `readSslFile` precedent.
      throw new InternalError(`Failed to scan directory "${dir}" for comets.`, {
        cause: error,
        meta: { source: 'zanix', method: 'discoverComets', dir },
      })
    }

    await Promise.all(entries.map(async (entry) => {
      const entryPath = join(dir, entry.name)

      if (entry.isDirectory) {
        if (entry.name.startsWith('.') || IGNORED_DIR_NAMES.has(entry.name)) {
          return
        }
        await visit(entryPath)
        return
      }

      if (
        !entry.isFile ||
        !SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))
      ) return

      const content = await Deno.readTextFile(entryPath)
      if (USE_COMET_DIRECTIVE.test(content)) {
        found.push(await Deno.realPath(entryPath))
      }
    }))
  }

  await visit(root)
  return found
}
