import type { Plugin } from 'vite'
import { dirname, isAbsolute, resolve } from '@std/path'

const NODE_MODULES_SEGMENT = '/node_modules/'
const SCRIPT_EXTENSION_RE = /\.(?:[cm]?js)$/
const SOURCEMAP_COMMENT_RE = /(?:\/\/[@#][ \t]+sourceMappingURL=([^\s'"`]+?)[ \t]*$)/gm

/** Strips a Vite module id down to its file path: no `?query`, no `#hash`, forward slashes. */
function toFilePath(id: string): string {
  return id.replace(/[?#].*$/, '').replaceAll('\\', '/')
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path)
    return true
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false
    throw error
  }
}

/**
 * Removes a `//# sourceMappingURL=` comment whose map file does not exist from a dependency's own
 * source, so Vite never tries to read it.
 *
 * Vite's dev pipeline reads a module from disk when no plugin loads it, follows its
 * `sourceMappingURL` comment and reads the referenced map with `readFileSync`. A published package
 * that ships the comment without the file (`@mediapipe/tasks-vision` does) makes that read throw
 * `ENOENT`, which Vite logs as `Failed to load source map for <file>` on every cold load of the
 * module. The module itself loads correctly; the warning is the only symptom.
 *
 * The `load` hook answers only a script under `node_modules` whose last `sourceMappingURL` comment
 * is a relative path to a missing file, and returns its text without that comment and without a map.
 * Every other module — a project file, a script with no comment, an inline `data:` map, a map that
 * exists — returns `null` and takes Vite's own path unchanged, so a project's own broken map keeps
 * warning and a valid dependency map keeps feeding stack traces.
 */
export function danglingSourcemapPlugin(): Plugin {
  return {
    name: 'zanix-space-dangling-sourcemap',
    enforce: 'pre',
    async load(id) {
      const file = toFilePath(id)
      if (
        !isAbsolute(file) || !file.includes(NODE_MODULES_SEGMENT) ||
        !SCRIPT_EXTENSION_RE.test(file)
      ) return null

      let code: string
      try {
        code = await Deno.readTextFile(file)
      } catch {
        return null
      }
      if (!code.includes('sourceMappingURL=')) return null

      const comment = [...code.matchAll(SOURCEMAP_COMMENT_RE)].at(-1)
      const mapPath = comment?.[1]
      if (!comment || !mapPath || mapPath.startsWith('data:')) return null
      if (await fileExists(resolve(dirname(file), mapPath))) return null

      return { code: code.replace(comment[0], ''), map: null }
    },
  }
}
