/**
 * `optimize.include`'s glob matching — shared by `image-optimize.ts` and `svg-optimize.ts`'s own
 * caller (`assets-plugin.ts`), matched against the exact same `relativePath` string the manifest
 * already keys on. `@std/path`'s own `globToRegExp` — Deno's own standard library, no new
 * dependency.
 *
 * @module
 */

import { globToRegExp } from '@std/path'

/** `undefined`/empty `patterns` means "every asset is eligible" — matches
 * `AssetsOptimizeOptions.include`'s own documented default. */
export function matchesInclude(relativePath: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return true
  return patterns.some((pattern) => globToRegExp(pattern, { globstar: true }).test(relativePath))
}
