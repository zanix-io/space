import type { Plugin } from 'vite'
import { scanAssets } from 'modules/assets/scan-assets.ts'
import { matchesInclude } from 'modules/assets/optimize-include.ts'
import { createOptimizeRunner, type OptimizeRunner } from 'modules/assets/optimize-runner.ts'
import { createImageTransformer } from 'modules/asset-transform/image-transformer.ts'
import {
  type AssetManifestRegistry,
  createAssetManifestRegistry,
} from 'modules/assets/asset-manifest-registry.ts'
import type { AssetsOptimizeOptions } from './assets-plugin-types.ts'

export type { AssetsOptimizeOptions }

// `Plugin` is not re-exported here — same accepted `deno doc --lint` finding as `cometPlugin`'s/
// `spacePlugin`'s own.

/** Options for {@linkcode assetsPlugin}. */
export interface AssetsPluginOptions {
  /** Same value passed to `defineSpaceApp({ assetsDir })` — resolved with `scanAssets`'s own
   * first-match-wins convention, identical to how the runtime route resolves it. */
  assetsDir: string | string[]
  /** See {@linkcode AssetsOptimizeOptions}. Omitted: this plugin's pre-existing hash-and-emit
   * behavior, completely unchanged. */
  optimize?: AssetsOptimizeOptions
  /**
   * Shares ONE `assets-manifest.json` across multiple independent build-time producers (this
   * plugin, a future `mediaPlugin`, ...) — see {@linkcode AssetManifestRegistry}'s own doc for the
   * full contract (registration, collision behavior, who writes the file).
   *
   * **Omitted (the default): this plugin creates its own internal registry and includes its own
   * manifest-writing plugin automatically** — a caller using `assetsPlugin` standalone (no other
   * producer in the same build) sees IDENTICAL behavior to every version before this option
   * existed, byte-for-byte. Pass an EXPLICIT, shared instance only when composing this plugin
   * alongside another real producer that writes into the SAME manifest (`buildSpaceClient` does
   * this internally once `mediaPlugin` exists) — in that case, whichever code created the shared
   * registry owns including `registry.createManifestPlugin()` in the build itself; this plugin
   * never adds it a second time for you.
   */
  manifestRegistry?: AssetManifestRegistry
}

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
    // `matchesInclude(path, undefined)` means "everything matches" — correct for `include`'s own
    // documented default, but the OPPOSITE of what an omitted `preserveIds` should mean here (no
    // file opts out of `cleanupIds` unless it explicitly matches a pattern) — so an empty/missing
    // list short-circuits to `false` instead of delegating straight to `matchesInclude`.
    const preserveIdsPatterns = typeof optimize.svg === 'object'
      ? optimize.svg.preserveIds
      : undefined
    const preserveIds = !!preserveIdsPatterns?.length &&
      matchesInclude(relativePath, preserveIdsPatterns)
    return runner.optimizeSvg(relativePath, source, preserveIds).then((entry) => [entry])
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
 * so it registers each one's own Rollup-issued reference id into an {@linkcode AssetManifestRegistry}
 * at emit time — see that type's own doc for why writing the actual manifest file is that
 * registry's job now, not this function's own `generateBundle` (a future `mediaPlugin` needs to
 * contribute to the SAME file without either plugin knowing the other exists).
 *
 * **Returns an array, not a single `Plugin`** — `[thisPlugin]` when composed with an explicit
 * `manifestRegistry`, or `[thisPlugin, registry.createManifestPlugin()]` when used standalone (see
 * `AssetsPluginOptions.manifestRegistry`'s own doc). Confirmed empirically (not assumed): Vite
 * flattens a nested plugin array one level, so an existing direct caller's own
 * `plugins: [assetsPlugin({ assetsDir })]` (no spread) keeps working completely unchanged — both
 * elements still run.
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
export function assetsPlugin(options: AssetsPluginOptions): Plugin[] {
  // Standalone use (the default): this plugin owns a registry nobody else knows about, and must
  // also include ITS OWN manifest-writing plugin — see `AssetsPluginOptions.manifestRegistry`'s
  // own doc. Composed use (an explicit registry passed in, e.g. by `buildSpaceClient`): the
  // CALLER already owns that responsibility, so only this plugin itself is returned.
  const registry = options.manifestRegistry ?? createAssetManifestRegistry()
  const ownsRegistry = options.manifestRegistry === undefined

  const plugin: Plugin = {
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
      // The transform cache wraps ONLY `optimizeImage` — never `optimizeSvg` (not asked for, see
      // `AssetsOptimizeOptions.cacheDir`'s own doc) — and sits entirely OUTSIDE `runner`: it
      // doesn't care whether the real work happens inline or on a worker, only that the function
      // shape matches. `image-optimize.ts`'s own `optimizeImageAsset` stays exactly as unaware of
      // caching as it already was. Cache wiring itself lives in `createImageTransformer`
      // (`modules/asset-transform/`, the sharp-only sibling of `createMediaTransformer` —
      // `mediaPlugin`'s own equivalent never reachable from here) — this plugin only supplies the
      // worker-pool-aware `runner.optimizeImage` as the real function to wrap.
      const transformer = createImageTransformer({
        cacheDir: options.optimize?.cacheDir,
        imageOptimizer: runner.optimizeImage,
      })
      const cachedRunner: OptimizeRunner = { ...runner, optimizeImage: transformer.transformImage }
      try {
        // Every asset's own optimize work is launched concurrently (never one `await` per asset in
        // a loop) — with `useWorker` enabled, this is what actually lets the worker pool run more
        // than one file at a time; sequentially awaiting each asset would starve the pool down to
        // one in-flight task regardless of its own size.
        const outputsPerEntry = await Promise.all(
          entries.map(([relativePath], index) =>
            resolveEntryOutputs(cachedRunner, relativePath, sources[index], options.optimize)
          ),
        )

        for (const outputs of outputsPerEntry) {
          for (const output of outputs) {
            const refId = this.emitFile({
              type: 'asset',
              name: output.relativePath,
              source: output.bytes,
            })
            registry.register(output.relativePath, refId)
          }
        }
      } finally {
        runner.close()
      }
    },
  }

  return ownsRegistry ? [plugin, registry.createManifestPlugin()] : [plugin]
}
