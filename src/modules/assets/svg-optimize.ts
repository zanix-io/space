/**
 * `assetsPlugin`'s opt-in, build-time-only SVG optimization (`optimize.svg`) — `svgo` runs cleanly
 * under Deno with no native binary required.
 *
 * Only SAFE, self-contained transforms are kept: strip explicit width/height, metadata, comments;
 * minify inline `<style>`; minify+dedupe `id`s. Deliberately **not** kept: a CSS `purge` step that
 * scans the whole app's own source files for which selectors are actually referenced — a
 * cross-cutting, build-wide static analysis with a much bigger surface than "optimize one file",
 * out of scope here.
 *
 * **`<symbol id="...">` ids are protected by default, structurally — no config needed.** A
 * `<symbol>` never renders on its own; its only reason to exist is to be instantiated later via
 * `<use href="...#name">`, possibly from a SEPARATE document (the `space-ui`/component-level
 * sprite pattern `AssetsOptimizeOptions.svg`'s own doc describes). `cleanupIds`'s own "is this id
 * used" analysis only ever sees ONE file, so left unguided it treats every symbol id as dead
 * weight and deletes it — on a 17-symbol sprite (`@zanix/space-ui`'s own `catalog.svg`), svgo's
 * plain default config strips all 17. The fix isn't a heuristic guess about "is this a sprite
 * file" — svgo's own `cleanupIds` plugin already accepts a `preserve: string[]` param that exempts
 * specific ids from both removal AND renaming. {@linkcode extractSymbolIds} scans the RAW SOURCE
 * (before svgo ever runs) for every `<symbol id="...">`, and that exact list is handed to
 * `cleanupIds` as `preserve` on EVERY file, every time — precise, not all-or-nothing: a stray,
 * genuinely-dead id on some OTHER element in the same file (never inside a `<symbol>`) still gets
 * cleaned normally.
 *
 * `AssetsOptimizeOptions.svg`'s own `preserveIds` glob still exists as a supplementary escape
 * hatch — for the rarer case of a NON-symbol id meant to be referenced externally (e.g. a plain
 * element's id used only via a `clip-path: url(other-file.svg#id)` from outside), where symbol
 * detection doesn't apply. It's no longer required for a `<symbol>`-based sprite like
 * `catalog.svg` — that case is now safe with a bare `svg: true`, no `preserveIds` declared at
 * all.
 *
 * @module
 */

import { pickSmaller } from './image-optimize.ts'
import { SVGO_SPECIFIER } from '../lazy/specifiers.ts'

type SvgoModule = { optimize(input: string, config?: unknown): { data: string } }

let svgoModule: SvgoModule | undefined

async function getSvgo(): Promise<SvgoModule> {
  svgoModule ??= await import(SVGO_SPECIFIER) as unknown as SvgoModule
  return svgoModule
}

// Shared by both configs below — never duplicated as two separate literal lists, so a future
// addition to the safe transform set (e.g. a new self-contained svgo plugin) only needs to change
// one place and automatically applies whether or not `cleanupIds` also runs.
const SAFE_PLUGINS = ['removeDimensions', 'removeMetadata', 'removeComments', 'minifyStyles']

/**
 * Every `<symbol id="...">` value in `text`, scanned via a plain regex over the RAW source —
 * before svgo ever parses it, so this is unaffected by anything svgo's own transforms might do
 * first. Deliberately narrow: matches ONLY `<symbol ...>` opening tags, never any other element's
 * `id` — a stray, genuinely-unused id on a `<circle>`/`<path>`/etc. is NOT collected here, and
 * stays eligible for `cleanupIds`'s own normal removal. Attribute order inside the tag doesn't
 * matter (`<symbol viewBox="..." id="...">` and `<symbol id="..." viewBox="...">` both match) —
 * the `id` search runs against the whole matched opening tag, not a fixed position. A duplicate
 * `<symbol>` sharing the same `id` (malformed input) is deduped via `Set`, harmless either way.
 */
export function extractSymbolIds(text: string): string[] {
  const ids = new Set<string>()
  for (const tag of text.matchAll(/<symbol\b[^>]*>/g)) {
    const idAttr = /\bid="([^"]*)"/.exec(tag[0])
    if (idAttr) ids.add(idAttr[1])
  }
  return [...ids]
}

/** The default pipeline — every safe transform, `cleanupIds` included, with `text`'s own
 * `<symbol id>`s (see {@linkcode extractSymbolIds}) protected from both removal and renaming.
 * Applied whenever a file does NOT match `AssetsOptimizeOptions.svg`'s own `preserveIds` globs —
 * this is this module's normal, always-on path now, not an opt-in one. */
function fullConfigFor(text: string) {
  return {
    plugins: [
      ...SAFE_PLUGINS,
      {
        name: 'cleanupIds',
        params: { minify: true, remove: true, preserve: extractSymbolIds(text) },
      },
    ],
  }
}

/** `cleanupIds` dropped entirely (not reconfigured — `remove: false` alone isn't enough, since
 * `minify: true` would still rewrite each surviving id's own text, breaking an external
 * `<use href="...#name">` referencing the ORIGINAL name just as surely as deleting it outright).
 * Applied only to files matching `preserveIds` — the supplementary, non-symbol escape hatch this
 * module's own doc describes; a `<symbol>`-based sprite no longer needs this path at all. */
const SAFE_CONFIG = {
  plugins: SAFE_PLUGINS,
}

/**
 * Optimizes one `.svg` asset. Same "never worsen" contract as {@linkcode optimizeImageAsset}: the
 * optimized output only replaces `relativePath`'s own bytes when it is strictly smaller — an equal
 * or larger result keeps the original bytes exactly. No new manifest keys are ever produced (SVG
 * has no breakpoint/format concept in this pipeline) — this is always a single-key, in-place
 * decision, same shape as `images: true`'s own bare case.
 *
 * @param preserveIds - `true`: this file matched `AssetsOptimizeOptions.svg`'s own `preserveIds`
 * glob — runs {@linkcode SAFE_CONFIG} (no `cleanupIds` at all). `false` (the default): runs
 * `cleanupIds` with every `<symbol id>` this file itself contains automatically protected (see
 * this module's own doc) — a `<symbol>`-based sprite needs neither argument to stay safe.
 */
export async function optimizeSvgAsset(
  relativePath: string,
  source: Uint8Array,
  preserveIds = false,
): Promise<{ relativePath: string; bytes: Uint8Array }> {
  const svgo = await getSvgo()
  const text = new TextDecoder().decode(source)
  const config = preserveIds ? SAFE_CONFIG : fullConfigFor(text)

  let optimizedText: string
  try {
    optimizedText = svgo.optimize(text, config).data
  } catch {
    // A malformed/unparseable SVG is not this pipeline's problem to fix or fail the build over —
    // pass it through untouched, same as an unrecognized raster format in `image-optimize.ts`.
    return { relativePath, bytes: source }
  }

  const optimizedBytes = new TextEncoder().encode(optimizedText)
  return { relativePath, bytes: pickSmaller(optimizedBytes, source) }
}
