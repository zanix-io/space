/**
 * Pure data-shape type for `assetsPlugin`'s `optimize` option — `AssetsOptimizeOptions` —
 * deliberately split from `assets-plugin.ts` itself, which unconditionally value-imports
 * `createImageTransformer` (`sharp`-backed) to build the real Vite plugin. References only
 * `ImagesOptimizeOptions` (`../assets/image-optimize-types.ts`, itself `sharp`-free), so a
 * consumer that only needs to type an options object — e.g. `mod.ts`'s own
 * `SpaceAppConfig.optimize` — never resolves `sharp`/`vite` merely by reading this file.
 * Re-exported unchanged from `assets-plugin.ts`, so switching that import site between "the real
 * file" and "this types file" is never a breaking change in either direction.
 *
 * @module
 */

import type { ImagesOptimizeOptions } from '../assets/image-optimize-types.ts'

/**
 * `assetsPlugin`'s opt-in, build-time-only asset optimization — sharp for raster images, svgo for
 * SVGs. Off by default: omitting `optimize` entirely keeps this plugin's own pre-existing behavior
 * byte-for-byte unchanged, for every existing consumer.
 *
 * The one rule every code path obeys: **an optimized output only replaces, or gets added next to,
 * its reference when it is strictly smaller in bytes** — never assumed, always measured. An equal
 * or larger result always keeps the original bytes. See `ImagesOptimizeOptions`'s own module doc
 * (`modules/assets/image-optimize.ts`) for the exact three-tier reference rule when `breakpoints`
 * and `formats` are combined.
 */
export interface AssetsOptimizeOptions {
  /** `true`: recompresses each eligible image in place (same key, same dimensions/format, metadata
   * stripped) — only when the result is strictly smaller; otherwise the original bytes are kept
   * exactly. An options object additionally requests responsive `breakpoints` and/or alternate
   * `formats` — in that shape, the original key is NEVER touched; only new, additive, derived keys
   * (`hero.msm.jpg`, `hero.webp`, ...) are added next to it. Applies to `jpg`/`jpeg`/`png`/`webp`/
   * `avif` sources only — any other extension is left completely untouched. */
  images?: boolean | ImagesOptimizeOptions
  /**
   * `true`: optimizes each eligible `.svg` (safe transforms only — strip dimensions/metadata/
   * comments, minify inline styles, minify+dedupe `id`s; deliberately NOT the legacy CSS-selector
   * purge). Same key, replaced only when strictly smaller.
   *
   * **A `<symbol id="...">` — the sprite pattern one or more `<use href="other-file.svg#name">`
   * elsewhere depend on (the `space-ui`/component-level icon pattern) — is protected from
   * `cleanupIds` automatically, with NO config needed, on every file, every time.** A `<symbol>`
   * never renders on its own; svgo only ever sees ONE file at a time, so left unguided it can't
   * tell an id referenced from a SEPARATE document is "used" and deletes it — this plugin scans
   * each file's own `<symbol id>`s first (see `svg-optimize.ts`'s own `extractSymbolIds` doc) and
   * exempts exactly those from removal/renaming, never the whole file wholesale: a genuinely dead
   * id on some OTHER, non-symbol element in the same file still gets cleaned normally. Confirmed
   * empirically (not assumed) against a real 17-symbol icon sprite (`@zanix/space-ui`'s own
   * `catalog.svg`): a bare `svg: true`, no other config, already keeps all 17.
   *
   * An object form additionally scopes `preserveIds`: glob patterns (same matching as `include`,
   * against the same `relativePath`) for SVGs whose `id`s must ALL survive byte-for-byte,
   * regardless of whether they belong to a `<symbol>` — skips `cleanupIds` entirely for a
   * matching file. A supplementary escape hatch for the rarer non-symbol case (e.g. a plain
   * element's id referenced only via a `clip-path: url(other-file.svg#id)` from outside) — no
   * longer required for a `<symbol>`-based sprite, which is already safe by default.
   */
  svg?: boolean | { preserveIds?: string[] }
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
  /** Persists `images` optimization results ACROSS builds — a real directory path this plugin
   * creates if missing. Identity is `sha256(source) + breakpoints/formats/quality + policy
   * version` (see `modules/assets/transform-cache.ts`'s own doc): an unchanged source re-optimized
   * with the exact same options never runs `sharp` again, even across separate `deno run`
   * invocations. Omitted (the default): every build re-optimizes every eligible asset from
   * scratch — this plugin's original behavior, completely unchanged. Never applies to `svg` (not
   * asked for; `svgo` is cheap enough that this wasn't a real problem the way repeated `sharp`
   * raster re-encodes are). */
  cacheDir?: string
}
