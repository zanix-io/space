/**
 * `assetsPlugin`'s opt-in, build-time-only SVG optimization (`optimize.svg`) — `svgo`, confirmed
 * to run cleanly under Deno with no native binary (a real spike: import, run, verified output —
 * not assumed).
 *
 * Only the legacy pipeline's SAFE, self-contained transforms are kept: strip explicit
 * width/height, metadata, comments; minify inline `<style>`; minify+dedupe `id`s. Deliberately
 * **not** kept: the legacy `purge` step, which scans the whole app's own source files for which
 * CSS selectors are actually referenced — a cross-cutting, build-wide static analysis with a much
 * bigger surface than "optimize one file", out of scope here. Also deliberately unrelated to (and
 * never touching) the sprite `<use>` icon pattern — that's a `space-ui`/component-level concern,
 * not a file-optimization one.
 *
 * @module
 */

import { pickSmaller } from './image-optimize.ts'

type SvgoModule = { optimize(input: string, config?: unknown): { data: string } }

let svgoModule: SvgoModule | undefined

async function getSvgo(): Promise<SvgoModule> {
  svgoModule ??= await import('npm:svgo@^3') as unknown as SvgoModule
  return svgoModule
}

const SVGO_CONFIG = {
  plugins: [
    'removeDimensions',
    'removeMetadata',
    'removeComments',
    'minifyStyles',
    { name: 'cleanupIds', params: { minify: true, remove: true } },
  ],
}

/**
 * Optimizes one `.svg` asset. Same "never worsen" contract as {@linkcode optimizeImageAsset}: the
 * optimized output only replaces `relativePath`'s own bytes when it is strictly smaller — an equal
 * or larger result keeps the original bytes exactly. No new manifest keys are ever produced (SVG
 * has no breakpoint/format concept in this pipeline) — this is always a single-key, in-place
 * decision, same shape as `images: true`'s own bare case.
 */
export async function optimizeSvgAsset(
  relativePath: string,
  source: Uint8Array,
): Promise<{ relativePath: string; bytes: Uint8Array }> {
  const svgo = await getSvgo()
  const text = new TextDecoder().decode(source)

  let optimizedText: string
  try {
    optimizedText = svgo.optimize(text, SVGO_CONFIG).data
  } catch {
    // A malformed/unparseable SVG is not this pipeline's problem to fix or fail the build over —
    // pass it through untouched, same as an unrecognized raster format in `image-optimize.ts`.
    return { relativePath, bytes: source }
  }

  const optimizedBytes = new TextEncoder().encode(optimizedText)
  return { relativePath, bytes: pickSmaller(optimizedBytes, source) }
}
