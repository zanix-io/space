import type { Plugin } from 'vite'
import sharp from 'sharp'
import { DEFAULT_ICON_SIZES, iconFileName, SW_FILE_NAME } from '../pwa/icon-naming.ts'
import { buildServiceWorkerSource } from './service-worker-source.ts'

// `Plugin` is not re-exported here — same accepted `deno doc --lint` finding, for the same reason,
// as `spacePlugin`'s own (see that file's own comment).

// `SW_FILE_NAME` re-exported (not just imported) — this was its own home before `icon-naming.ts`
// became the single source of truth for every PWA build/runtime naming convention; kept as a
// re-export here too so nothing importing it from this module needs to change.
export { SW_FILE_NAME }

/** Options for {@linkcode pwaPlugin}. */
export interface PwaPluginOptions {
  icons: {
    /** Path to a single source image (ideally ≥512×512, square) — resized to every size in
     * `sizes` at build time. Read once per build, never at request time: the deployed server
     * process never depends on `sharp` (a native, per-platform binary) at all. */
    source: string
    /** @default [192, 512] */
    sizes?: number[]
  }
  /** Must match `PwaConfig.offlineFallback` — embedded into the generated service worker so it's
   * precached at `install` time and available even on a visitor's first offline visit. Omit if no
   * offline fallback is configured. */
  offlineFallback?: string
}

/**
 * Generates this app's PWA icons at build time from a single source image — real resizing via
 * `sharp`, not a placeholder. `sharp` is a build-tool-only dependency: nothing it touches ships to
 * the browser or runs in the deployed server process (see `registerPwaRoutes`'s own doc for how
 * the runtime serves these files without ever importing `sharp` itself).
 *
 * Sibling to `spacePlugin`/`cometPlugin`/`cssPlugin`, not merged into any of them — same reasoning
 * as `spacePlugin`'s own doc comment.
 *
 * **Deliberately no maskable-icon generation yet**: a real maskable icon needs a safe-zone-aware
 * source (content confined to the inner ~80% circle) that a naive resize of an arbitrary square
 * source would violate, cropping real content at the edges on Android's own mask shapes — adding
 * that support without a real safe-zone check would be worse than not offering it. Deferred, not
 * silently dropped.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from 'vite'
 * import { spacePlugin, cometPlugin, cssPlugin, pwaPlugin } from '@zanix/space/vite'
 *
 * export default defineConfig({
 *   plugins: [
 *     ...spacePlugin(),
 *     cometPlugin(),
 *     cssPlugin(),
 *     pwaPlugin({ icons: { source: './public/icon-source.png' } }),
 *   ],
 * })
 * ```
 */
export function pwaPlugin(options: PwaPluginOptions): Plugin {
  const { source, sizes = DEFAULT_ICON_SIZES } = options.icons
  const { offlineFallback } = options

  return {
    name: 'zanix-space-pwa',
    apply: 'build',
    async generateBundle(_options, bundle) {
      const sourceBuffer = await Deno.readFile(source)

      const icons = await Promise.all(
        sizes.map(async (size) => ({
          size,
          png: await sharp(sourceBuffer).resize(size, size).png().toBuffer(),
        })),
      )

      for (const { size, png } of icons) {
        this.emitFile({ type: 'asset', fileName: `icons/${iconFileName(size)}`, source: png })
      }

      // Scanned directly off `bundle` (never read from `cssPlugin`'s own manifest asset) — Rollup
      // gives no ordering guarantee between two same-priority plugins' `generateBundle` hooks, so
      // `css-manifest.json` might not exist yet by the time this one runs.
      const precacheUrls: string[] = []
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'asset' && chunk.fileName.endsWith('.css')) {
          precacheUrls.push(`/${chunk.fileName}`)
        }
      }

      this.emitFile({
        type: 'asset',
        fileName: SW_FILE_NAME,
        source: buildServiceWorkerSource({
          precacheUrls,
          offlineFallback: offlineFallback ?? null,
        }),
      })
    },
  }
}
