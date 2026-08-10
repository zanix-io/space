import type { Plugin } from 'vite'
import type { CometManifest } from '../comets/comet-manifest.ts'
import { USE_COMET_DIRECTIVE } from './comet-directive.ts'

// `Plugin` is not re-exported here — same accepted `deno doc --lint` finding, for the same reason,
// as `spacePlugin`'s own (see that file's own comment): it's a deeply recursive Vite/Rolldown
// vendor type this package doesn't own, and returning a real `Plugin` object is unavoidable since
// `cometPlugin()` must compose into `vite.config.ts`'s `plugins` array like any other Vite plugin.

/** Options for {@linkcode cometPlugin}. */
export interface CometPluginOptions {
  /**
   * Absolute paths of comets the caller ALREADY passed as real `rollupOptions.input` entries
   * (`buildSpaceClient` does this, via `discoverComets`) — this plugin skips its own
   * `emitFile({ type: 'chunk' })` forcing for exactly these, since a real entry already gets its
   * own chunk from Rollup with no forcing needed. Confirmed empirically before this option
   * existed: forcing a chunk for a file that's ALSO a real entry produces a second, duplicate
   * chunk for the same source — dead weight in the output, never referenced by the manifest
   * (which only ever points at one of the two). Omit entirely for the common case (a comet only
   * ever reached transitively, through a page's own static import) — unaffected either way.
   */
  knownEntryPaths?: Iterable<string>
}

const MANIFEST_FILE_NAME = 'comets-manifest.json'

/**
 * Finds every file marked `'use comet'` and forces it into its own build output chunk, then writes
 * a manifest (`comets-manifest.json`, in the client build's output directory) correlating each
 * comet's own source file to that chunk's real, hashed URL — read back at request time via
 * `loadCometManifest`, so `defineComet` can resolve a comet's real client URL instead of the raw
 * source location it only knows from `import.meta.url`.
 *
 * This split matters because a comet is typically also imported *statically* by whatever page
 * renders it server-side (`defineComet`'s wrapper needs the real component to produce real HTML).
 * Without forcing a separate chunk, a bundler has no reason to split that file out on its own — it
 * would simply inline it into the page's own chunk, and hydrating from it client-side would just
 * re-fetch code the page's own bundle already shipped, defeating the entire point of shipping less
 * JS per comet. `emitFile({ type: 'chunk' })` (Rollup's own established mechanism for exactly this
 * — the same technique lazy-route and precache-manifest plugins already use) is what prevents that.
 *
 * In dev, this plugin does nothing (`apply: 'build'`) — Vite's dev server already serves every
 * project file at its own root-relative path, so `resolveCometModuleUrl`'s own dev-mode fallback
 * already resolves a comet's URL correctly there with zero build step involved.
 *
 * @param options - See {@linkcode CometPluginOptions}.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from 'vite'
 * import { spacePlugin, cometPlugin } from '@zanix/space/vite'
 *
 * export default defineConfig({
 *   plugins: [...spacePlugin(), cometPlugin()],
 * })
 * ```
 */
export function cometPlugin(options: CometPluginOptions = {}): Plugin {
  const cometSourceIds = new Set<string>()
  const knownEntryPaths = new Set(options.knownEntryPaths ?? [])

  return {
    name: 'zanix-space-comets',
    apply: 'build',
    async transform(code, id) {
      if (!USE_COMET_DIRECTIVE.test(code)) return null
      // Rollup/Rolldown resolve a chunk's own `facadeModuleId` through the real (symlink-resolved)
      // filesystem path — realpath-ing here too, once per comet file at build time, is what keeps
      // this set matching that later in `generateBundle`, on a filesystem where `id` itself isn't
      // already the real path (e.g. a temp dir under macOS's symlinked `/tmp`/`/var`).
      const realId = await Deno.realPath(id)
      cometSourceIds.add(realId)
      // Only force a NEW chunk for a comet reached transitively (e.g. through a page's own static
      // import) — one already given to Rollup as a real entry (`knownEntryPaths`) already gets its
      // own chunk on its own; forcing one anyway would emit a second, duplicate copy of the same
      // source (see `CometPluginOptions.knownEntryPaths`'s own doc for how this was confirmed).
      if (!knownEntryPaths.has(realId)) {
        this.emitFile({ type: 'chunk', id: realId, preserveSignature: false })
      }
      return null
    },
    generateBundle(_options, bundle) {
      if (cometSourceIds.size === 0) return

      const manifest: CometManifest = {}
      for (const chunk of Object.values(bundle)) {
        if (
          chunk.type === 'chunk' && chunk.facadeModuleId && cometSourceIds.has(chunk.facadeModuleId)
        ) {
          manifest[chunk.facadeModuleId] = `/${chunk.fileName}`
        }
      }

      this.emitFile({
        type: 'asset',
        fileName: MANIFEST_FILE_NAME,
        source: JSON.stringify(manifest, null, 2),
      })
    },
  }
}
