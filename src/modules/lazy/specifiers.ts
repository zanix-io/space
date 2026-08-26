/**
 * The ONE place this package's own lazily-resolved `npm:` specifiers are written down for
 * VALUE-level, RUNTIME use — `svg-optimize.ts`'s `getSvgo` resolves its own constant from here
 * instead of inlining the string, so a real version bump is a one-line change here. Matches
 * `@zanix/admin`'s/`@zanix/core`'s/`@zanix/cli`'s identical `specifiers.ts` convention.
 *
 * DELIBERATELY absent from `deno.jsonc`'s own top-level `imports` map: `nodeModulesDir: "auto"`-
 * style npm-install resolution materializes every package a `deno.json` DECLARES, regardless of
 * whether reachable code actually imports it — a bare alias declared there is, on its own, enough
 * to trigger it — this is real, observable Deno behavior, not a theoretical edge case. `svgo` only applies
 * to a real `assetsPlugin({ optimize: { svg: true } })` build — a consumer optimizing only
 * raster images (`optimize.images`, never `optimize.svg`) must never pay for it merely because
 * `optimize-runner.ts` reaches `svg-optimize.ts` unconditionally, as one of the two functions its
 * own `OptimizeRunner` always wires up regardless of which one a given build actually calls.
 *
 * The `const specifier = SVGO_SPECIFIER` two-step at the call site (never `import(SVGO_SPECIFIER)`
 * inlined as a literal) is deliberate, not incidental: Deno's own module graph builder only follows
 * a dynamic `import()` whose argument it can resolve as a literal at parse time — routing it
 * through a variable keeps a consumer that never triggers `optimize.svg` out of that graph
 * entirely.
 */

/** `svgo`'s own real, pinned version range — `svg-optimize.ts`'s `getSvgo` (VALUE,
 * `await import(...)`, gated behind `AssetsOptimizeOptions.svg` actually being configured). */
export const SVGO_SPECIFIER = 'npm:svgo@^3'
