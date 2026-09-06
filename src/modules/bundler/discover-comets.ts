import { join } from '@std/path'
import { InternalError } from '@zanix/errors'
import { USE_COMET_DIRECTIVE } from './comet-directive.ts'
import { BUILT_IN_COMET_NAMES } from '../comets/built-in-comets-registry.ts'
import type { RendererKind } from '../router/active-renderer.ts'

const IGNORED_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  '.dist',
  '.vite',
  'coverage',
])
const SOURCE_EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js']

/**
 * Walks `root`, handing every real source file's content to `onFile` — the shared directory walk
 * {@linkcode discoverComets} and {@linkcode discoverUsedBuiltInComets} both build on, so a project
 * tree is only ever read once per caller, never duplicated between the two content-based checks
 * they each run over it.
 *
 * Skips common non-source directories (`node_modules`, build output, dep-optimizer caches, ...) —
 * never descends into them, both for correctness (a comet-looking file inside a dependency isn't
 * this app's own) and so a walk doesn't pay to visit potentially enormous trees that could never
 * contain a real comet anyway. A dotfile-prefixed directory (`.git`, `.github`, ...) is skipped the
 * same way, matching the same convention this package's own `deno.json` `exclude`s already use.
 *
 * @param root - Directory to walk. A directory that doesn't exist is treated as zero files, not an
 * error — the same convention {@linkcode scanPageFiles} already establishes for `routesDir`.
 * @param onFile - Called once per real source file found, with its full text content and its
 * (not-yet-realpath'd) path.
 * @param methodName - The calling function's own name, attached to a directory-read failure's
 * `InternalError` metadata, so it still points back at whichever discovery actually failed.
 */
async function walkSourceFiles(
  root: string,
  onFile: (content: string, entryPath: string) => void | Promise<void>,
  methodName: string,
): Promise<void> {
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
        meta: { source: 'zanix', method: methodName, dir },
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

      await onFile(await Deno.readTextFile(entryPath), entryPath)
    }))
  }

  await visit(root)
}

/**
 * Walks `root` looking for every file whose content starts with a `'use comet'` directive — the
 * exact same content-based recognition `cometPlugin` itself applies at build time
 * (`comet-directive.ts`'s shared `USE_COMET_DIRECTIVE`), just run once up front here so
 * `buildSpaceClient` knows which files to hand Vite as real `rollupOptions.input` entries. A
 * comet is deliberately NOT tied to any folder convention — `defineComet` itself doesn't care
 * where its own file lives — so this is a plain content scan, never a path-based one, the same
 * reasoning `cometPlugin`'s own detection already follows.
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
  await walkSourceFiles(root, async (content, entryPath) => {
    if (USE_COMET_DIRECTIVE.test(content)) found.push(await Deno.realPath(entryPath))
  }, 'discoverComets')
  return found
}

/** Matches a named import from `@zanix/space/comet/<renderer>` — e.g.
 * `import { SubmitGuard, NetworkStatus } from '@zanix/space/comet/react'` — capturing the import
 * clause text so {@linkcode discoverUsedBuiltInComets} can check which of
 * {@linkcode BUILT_IN_COMET_NAMES} actually appear in it. A heuristic regex, not a full parse —
 * same deliberate tradeoff `comet-directive.ts`'s own `USE_COMET_DIRECTIVE` already makes, for the
 * same reason: this only ever needs to recognize a convention this package itself defines, never
 * arbitrary third-party source. */
function builtInCometImportRegex(renderer: RendererKind): RegExp {
  return new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*['"]@zanix/space/comet/${renderer}['"]`,
    'g',
  )
}

/**
 * Which of `@zanix/space/comet/<renderer>`'s ready-made Comets ({@linkcode BUILT_IN_COMET_NAMES})
 * this project's own source actually imports — reuses {@linkcode walkSourceFiles}'s own content
 * read, a second predicate over the SAME files `discoverComets` already walks, never a second
 * directory read of its own. A ready-made Comet is typically composed directly from a page/layout
 * (`SubmitGuard` guarding a sign-out `<form>` in a root `layout.tsx`, say), never a file
 * `discoverComets` itself would collect — a page/layout carries no `'use comet'` directive of its
 * own, so without this separate check `build-client.ts` would have no way to learn one is in use at
 * all.
 *
 * @param root - Same meaning as {@linkcode discoverComets}'s own `root`.
 * @param renderer - Only the active renderer's own subpath is scanned — the other one is never
 * even reachable at runtime (see `page-renderer-registry.ts`).
 * @returns The subset of {@linkcode BUILT_IN_COMET_NAMES} this project actually imports, in no
 * particular order.
 */
export async function discoverUsedBuiltInComets(
  root: string,
  renderer: RendererKind,
): Promise<Set<string>> {
  const used = new Set<string>()
  const importRegex = builtInCometImportRegex(renderer)
  await walkSourceFiles(root, (content) => {
    let match: RegExpExecArray | null
    while ((match = importRegex.exec(content))) {
      for (const name of BUILT_IN_COMET_NAMES) {
        if (new RegExp(`\\b${name}\\b`).test(match[1])) used.add(name)
      }
    }
  }, 'discoverUsedBuiltInComets')
  return used
}
