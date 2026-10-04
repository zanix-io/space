import type { Plugin } from 'vite'
import {
  MODULE_PRELOAD_MANIFEST_FILE,
  type ModulePreloadManifest,
} from '../render/modulepreload-manifest.ts'

/** The slice of a Rollup output chunk this plugin reads. Narrow on purpose, so it is easy to fake. */
export type PreloadBundleChunk = {
  type: string
  fileName: string
  /** The chunks this one imports statically, by file name. External ids may be mixed in. */
  imports?: readonly string[]
  isEntry?: boolean
  isDynamicEntry?: boolean
  facadeModuleId?: string | null
}

/**
 * For every chunk a page can start from (an entry, a dynamic entry, or any chunk with a facade
 * module: the client entry and each comet), the URLs of every chunk it imports statically, directly
 * or through another chunk, nearest first and without repeats.
 *
 * Only static imports count: a dynamic `import()` is loaded when the code asks for it and is not
 * part of the chunk's own cost. An import that names no chunk of the bundle (an external module)
 * is ignored. A chunk with no chunk dependency has no key.
 *
 * @param bundle - Rollup's output bundle, by file name.
 * @returns The manifest, keys in alphabetical order so a rebuild of the same graph is identical.
 */
export function computeModulePreloads(
  bundle: Readonly<Record<string, PreloadBundleChunk>>,
): ModulePreloadManifest {
  const chunks = new Map<string, PreloadBundleChunk>()
  for (const item of Object.values(bundle)) {
    if (item.type === 'chunk') chunks.set(item.fileName, item)
  }

  const manifest: ModulePreloadManifest = {}
  const startingPoints = [...chunks.values()]
    .filter((chunk) => chunk.isEntry || chunk.isDynamicEntry || chunk.facadeModuleId)
    .sort((a, b) => (a.fileName < b.fileName ? -1 : 1))

  for (const start of startingPoints) {
    const reached: string[] = []
    const seen = new Set<string>([start.fileName])
    let level = [start]
    while (level.length > 0) {
      const next: PreloadBundleChunk[] = []
      for (const chunk of level) {
        for (const imported of chunk.imports ?? []) {
          const dependency = chunks.get(imported)
          if (!dependency || seen.has(imported)) continue
          seen.add(imported)
          reached.push(`/${imported}`)
          next.push(dependency)
        }
      }
      level = next
    }
    if (reached.length > 0) manifest[`/${start.fileName}`] = reached
  }
  return manifest
}

/**
 * Writes `modulepreload-manifest.json` next to the build's other manifests, so a page can link a
 * `modulepreload` for its client entry and its comets together with everything they import (see
 * {@linkcode ModulePreloadManifest}). A build whose graph has no static chunk imports writes
 * nothing. Production only: it runs in `generateBundle`, which `znx space dev` never reaches.
 */
export function modulePreloadPlugin(): Plugin {
  return {
    name: 'space-modulepreload-manifest',
    generateBundle(_options, bundle) {
      const manifest = computeModulePreloads(
        bundle as unknown as Record<string, PreloadBundleChunk>,
      )
      if (Object.keys(manifest).length === 0) return
      this.emitFile({
        type: 'asset',
        fileName: MODULE_PRELOAD_MANIFEST_FILE,
        source: JSON.stringify(manifest, null, 2),
      })
    },
  }
}
