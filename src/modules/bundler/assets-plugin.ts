import type { Plugin } from 'vite'
import { scanAssets } from 'modules/assets/scan-assets.ts'
import { matchesInclude } from 'modules/assets/optimize-include.ts'
import { createOptimizeRunner, type OptimizeRunner } from 'modules/assets/optimize-runner.ts'
import type { ImagesOptimizeOptions } from 'modules/assets/image-optimize.ts'

// `Plugin` is not re-exported here — same accepted `deno doc --lint` finding as `cometPlugin`'s/
// `spacePlugin`'s own.

/**
 * `assetsPlugin`'s opt-in, build-time-only asset optimization — sharp for raster images, svgo for
 * SVGs. Off by default: omitting `optimize` entirely keeps this plugin's own pre-existing behavior
 * byte-for-byte unchanged, for every existing consumer.
 *
 * The one rule every code path obeys: **an optimized output only replaces, or gets added next to,
 * its reference when it is strictly smaller in bytes** — never assumed, always measured. An equal
 * or larger result always keeps the original bytes. See {@linkcode ImagesOptimizeOptions}'s own
 * module doc (`modules/assets/image-optimize.ts`) for the exact three-tier reference rule when
 * `breakpoints` and `formats` are combined.
 */
export interface AssetsOptimizeOptions {
  /** `true`: recompresses each eligible image in place (same key, same dimensions/format, metadata
   * stripped) — only when the result is strictly smaller; otherwise the original bytes are kept
   * exactly. An options object additionally requests responsive `breakpoints` and/or alternate
   * `formats` — in that shape, the original key is NEVER touched; only new, additive, derived keys
   * (`hero.msm.jpg`, `hero.webp`, ...) are added next to it. Applies to `jpg`/`jpeg`/`png`/`webp`/
   * `avif` sources only — any other extension is left completely untouched. */
  images?: boolean | ImagesOptimizeOptions
  /** `true`: optimizes each `.svg` (safe transforms only — strip dimensions/metadata/comments,
   * minify inline styles/ids; deliberately NOT the legacy CSS-selector purge, and unrelated to the
   * sprite `<use>` icon pattern). Same key, replaced only when strictly smaller. */
  svg?: boolean
  /** Glob patterns (matched against the same `relativePath` the manifest keys on) scoping WHICH
   * assets `images`/`svg` apply to. Omitted (the default): every eligible asset. An asset outside
   * this filter — or one whose extension isn't supported by `images`/`svg` at all — is always left
   * completely untouched, regardless of `images`/`svg`. */
  include?: string[]
  /** Offloads the actual sharp/svgo work to a real worker pool (`@zanix/utils`'s own
   * `WorkerManager` — no new dependency) instead of running inline on the same thread `buildStart`
   * already runs on. `true`: a pool sized to the detected CPU count. A `number`: an explicit pool
   * size. **Purely an execution strategy** — produces byte-for-byte identical output and the exact
   * same emit/discard decisions as `useWorker: false` (the default); never changes what gets
   * optimized or which variants exist. */
  useWorker?: boolean | number
}

/** Options for {@linkcode assetsPlugin}. */
export interface AssetsPluginOptions {
  /** Same value passed to `defineSpaceApp({ assetsDir })` — resolved with `scanAssets`'s own
   * first-match-wins convention, identical to how the runtime route resolves it. */
  assetsDir: string | string[]
  /** See {@linkcode AssetsOptimizeOptions}. Omitted: this plugin's pre-existing hash-and-emit
   * behavior, completely unchanged. */
  optimize?: AssetsOptimizeOptions
}

const MANIFEST_FILE_NAME = 'assets-manifest.json'
const OPTIMIZABLE_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif'])

function extensionOf(relativePath: string): string {
  const dot = relativePath.lastIndexOf('.')
  return dot === -1 ? '' : relativePath.slice(dot + 1).toLowerCase()
}

interface EmittableEntry {
  relativePath: string
  bytes: Uint8Array
}

function resolveEntryOutputs(
  runner: OptimizeRunner,
  relativePath: string,
  source: Uint8Array,
  optimize: AssetsOptimizeOptions | undefined,
): Promise<EmittableEntry[]> {
  const eligible = matchesInclude(relativePath, optimize?.include)
  const ext = extensionOf(relativePath)

  if (eligible && optimize?.images && OPTIMIZABLE_IMAGE_EXTENSIONS.has(ext)) {
    return runner.optimizeImage(relativePath, source, optimize.images)
  }
  if (eligible && optimize?.svg && ext === 'svg') {
    return runner.optimizeSvg(relativePath, source).then((entry) => [entry])
  }
  return Promise.resolve([{ relativePath, bytes: source }])
}

/**
 * Hashes every file `assetsDir` resolves and writes `assets-manifest.json` (in the client build's
 * output directory) correlating each one's stable relative path (`logo.svg`) to its real, hashed
 * build output URL (`/assets/logo-a1b2c3.svg`) — read back at request time via
 * `loadAssetsManifest`/`resolveAssetHref`. Optionally optimizes eligible assets first (see
 * {@linkcode AssetsOptimizeOptions}) — the manifest shape itself never changes either way, it just
 * gains more entries when responsive variants are requested.
 *
 * Uses Rollup's own `emitFile({ type: 'asset' })` (confirmed empirically, not assumed: a nested
 * `name` like `'icons/favicon.png'` preserves its own directory structure in the hashed output,
 * e.g. `assets/icons/favicon-a1b2c3.png` — Rollup does not flatten it) — the SAME real hashing
 * mechanism `cssPlugin`/`cometPlugin` already ride on for their own manifests, just reached
 * differently: those two correlate an ALREADY-hashed-by-Rollup chunk/asset (something Rollup's own
 * module graph decided to emit on its own) back to a manifest entry after the fact, by scanning the
 * finished `bundle` in `generateBundle`. This plugin instead explicitly EMITS each asset itself (an
 * asset under `assetsDir` is never reached through the module graph at all — nothing `import`s it),
 * so it tracks each one's own Rollup-issued reference id at emit time and resolves the real
 * `fileName` via `this.getFileName(id)` once the bundle is final.
 *
 * `assetsDir`'s own existing runtime route keeps working completely unchanged whether or not this
 * plugin ever runs — see `register-assets.ts`'s own doc for how the two compose (a hashed request
 * checked first, falling back to the live, unhashed source lookup this plugin never touches). The
 * SAME is true of every derived variant `optimize.images.breakpoints`/`formats` produces: each one
 * is just another manifest key, resolved the exact same way via `resolveAssetHref('hero.msm.jpg')`
 * — no new runtime API. `assetsPlugin` deliberately stops at producing these files; composing them
 * into `<picture>`/`srcset`/responsive-selection markup is a rendering-layer concern for a future
 * `space-ui` component to own, not this plugin (confirmed against the real legacy `Media`/`Image`
 * component: it resolves variants by breakpoint NAME against a `<picture>`+`<source media=...>`
 * pattern, never a `srcset` `w`-descriptor/`sizes` one — it never needed each variant's real pixel
 * dimensions, so neither does this plugin).
 *
 * In dev, this plugin does nothing (`apply: 'build'`) — `assetsDir`'s own route already reads
 * straight from the live source directory with zero build step involved, same reasoning
 * `cometPlugin`'s own doc gives for why it's inert in dev too.
 *
 * @param options - See {@linkcode AssetsPluginOptions}.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from 'vite'
 * import { spacePlugin, assetsPlugin } from '@zanix/space/vite'
 *
 * export default defineConfig({
 *   plugins: [
 *     ...spacePlugin(),
 *     assetsPlugin({
 *       assetsDir: './assets',
 *       optimize: {
 *         images: { breakpoints: ['msm', 'mlg', 'dlg'], formats: ['webp'] },
 *         svg: true,
 *         include: ['img/**'],
 *       },
 *     }),
 *   ],
 * })
 * ```
 */
export function assetsPlugin(options: AssetsPluginOptions): Plugin {
  const refs = new Map<string, string>()

  return {
    name: 'zanix-space-assets',
    apply: 'build',
    async buildStart() {
      const resolved = await scanAssets(options.assetsDir)
      // No ordering dependency between different assets' own reads (unlike `scanAssets`'s own
      // directory precedence, already resolved by the call above) — read every file in parallel,
      // then emit synchronously (`this.emitFile` itself does no I/O) once all bytes are in hand.
      const entries = [...resolved]
      const sources = await Promise.all(
        entries.map(([, absolutePath]) => Deno.readFile(absolutePath)),
      )

      const runner = createOptimizeRunner(options.optimize?.useWorker)
      try {
        // Every asset's own optimize work is launched concurrently (never one `await` per asset in
        // a loop) — with `useWorker` enabled, this is what actually lets the worker pool run more
        // than one file at a time; sequentially awaiting each asset would starve the pool down to
        // one in-flight task regardless of its own size.
        const outputsPerEntry = await Promise.all(
          entries.map(([relativePath], index) =>
            resolveEntryOutputs(runner, relativePath, sources[index], options.optimize)
          ),
        )

        for (const outputs of outputsPerEntry) {
          for (const output of outputs) {
            const refId = this.emitFile({
              type: 'asset',
              name: output.relativePath,
              source: output.bytes,
            })
            refs.set(output.relativePath, refId)
          }
        }
      } finally {
        runner.close()
      }
    },
    generateBundle() {
      if (refs.size === 0) return

      const manifest: Record<string, string> = {}
      for (const [relativePath, refId] of refs) {
        manifest[relativePath] = `/${this.getFileName(refId)}`
      }

      this.emitFile({
        type: 'asset',
        fileName: MANIFEST_FILE_NAME,
        source: JSON.stringify(manifest, null, 2),
      })
    },
  }
}
