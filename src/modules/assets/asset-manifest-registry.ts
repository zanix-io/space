import type { Plugin } from 'vite'
import { InternalError } from '@zanix/errors'

// `Plugin` is not re-exported here — same accepted `deno doc --lint` finding `assets-plugin.ts`'s
// own doc comment already establishes.

/**
 * A neutral, explicitly-instantiated (never a process-wide singleton) accumulator for
 * `assets-manifest.json` — the ONE thing multiple independent build-time producers (`assetsPlugin`
 * for images/SVG, a future `mediaPlugin` for video/thumbnails, anything else that ever hashes a
 * real file under `assetsDir`) all need to share: they each emit their own real output files via
 * `this.emitFile()` (Rollup itself has no conflict there — many plugins may call it), but the
 * MANIFEST FILE correlating every one of those back to a stable relative path is a single named
 * file (`assets-manifest.json`) — two producers each trying to write their OWN copy of it would
 * either collide (Rollup errors on a duplicate `fileName`) or silently overwrite one producer's
 * entries with the other's, depending on plugin order. This registry is the one place that
 * actually writes it, once, from every producer's own contributed entries.
 *
 * Deliberately NOT a module-level singleton (unlike `asset-registry.ts`'s own `defineSpaceApp()`-
 * populated config, which genuinely needs process-wide, import-time visibility for a different
 * reason — see that module's own doc): a shared mutable global here would leak across independent
 * builds, produce non-deterministic entries under Vite's watch mode, and make tests depend on
 * import/execution order. `createAssetManifestRegistry()` returns a fresh instance every call —
 * the caller composing multiple producers into one build (`buildSpaceClient`, or a hand-written
 * `vite.config.ts`) creates exactly ONE and passes the SAME instance to every producer that needs
 * it, the same explicit-dependency-injection shape `AssetsPluginOptions.manifestRegistry`'s own
 * doc shows.
 *
 * `assetsPlugin`/`mediaPlugin` know NOTHING about each other — both only ever depend on this one,
 * domain-agnostic type. Neither is a real Vite `Plugin` on its own anymore for the manifest's own
 * sake: each returns `[itself, ...]`, and whichever caller creates a SHARED registry is the one
 * responsible for including {@linkcode AssetManifestRegistry.createManifestPlugin}'s own result in
 * the build exactly once (see that method's own doc). A producer used standalone (no explicit
 * registry passed in) creates its own internal one and includes its own manifest plugin
 * automatically — see `AssetsPluginOptions.manifestRegistry`'s own doc for that fallback.
 *
 * @module
 */

const MANIFEST_FILE_NAME = 'assets-manifest.json'

/** Tracks each build-time asset's emitted Rollup output id, keyed by its own relative path, and
 * writes the resolved manifest once the build finishes. */
export interface AssetManifestRegistry {
  /**
   * Registers `relativePath` (e.g. `'hero.jpg'`, `'clip.mp4'`, `'clip.msm.webm'`) as resolving to
   * `refId` — the id `this.emitFile()` returned for the real output backing it. Call this from
   * inside a real Rollup `buildStart` (or any hook with access to the same plugin `this`), once
   * per real output a producer emits.
   *
   * **Collision behavior**, exactly as specified:
   * - The SAME `relativePath` registered again with the SAME `refId` is a no-op (idempotent) — a
   *   producer that (harmlessly) revisits its own already-registered entry never fails.
   * - The SAME `relativePath` registered with a DIFFERENT `refId` throws {@linkcode InternalError}
   *   immediately — two producers (or two runs of the same one) genuinely disagree about what
   *   this relative path's real output is, which is always a real bug (a naming collision between
   *   an image variant and a video variant, for instance), never a case to silently resolve by
   *   picking one.
   */
  register(relativePath: string, refId: string): void

  /**
   * Returns a real Vite `Plugin` whose own `generateBundle` hook resolves every entry registered
   * so far to its real, Rollup-hashed `fileName`, and writes the ONE `assets-manifest.json` from
   * all of them together — same JSON shape (`Record<relativePath, hashedUrl>`, 2-space indent)
   * `assetsPlugin`'s own `generateBundle` always produced, so `loadAssetsManifest`/
   * `resolveAssetHref` (`modules/assets/assets-manifest.ts`) need no change at all: they only ever
   * read a plain JSON file at a known name, never caring which plugin(s) produced it.
   *
   * Include this plugin's result in the build's own `plugins` array exactly ONCE, after every
   * producer that calls {@linkcode register} on this SAME registry instance (Rollup runs
   * `generateBundle` hooks in plugin-array order, so this must come after them to see every
   * registration). Writes nothing at all when nothing was ever registered — an app with no real
   * output from any producer gets no manifest file, same as `assetsPlugin`'s own original
   * "omitted assetsDir → no manifest" behavior.
   */
  createManifestPlugin(): Plugin
}

/**
 * Creates a fresh, empty registry — see this module's own doc for why this is a real function
 * call, never a singleton. Cheap: internally just one `Map`.
 */
export function createAssetManifestRegistry(): AssetManifestRegistry {
  const refs = new Map<string, string>()

  return {
    register(relativePath: string, refId: string): void {
      const existing = refs.get(relativePath)
      if (existing !== undefined && existing !== refId) {
        throw new InternalError(
          `Asset manifest collision: "${relativePath}" was already registered with a different ` +
            'real output — two independent build-time producers (or two runs of the same one) ' +
            'disagree about what this relative path resolves to.',
          {
            meta: { source: 'zanix', relativePath, existingRefId: existing, incomingRefId: refId },
          },
        )
      }
      refs.set(relativePath, refId)
    },

    createManifestPlugin(): Plugin {
      return {
        name: 'zanix-space-asset-manifest',
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
    },
  }
}
