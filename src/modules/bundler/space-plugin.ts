import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { denoOptimizeDepsAliasPlugin } from './deno-optimize-deps-alias.ts'

// `Plugin` is intentionally NOT re-exported here, unlike this package's other vendor-type
// references (see `typings/manifest.ts`'s doc comment for the general rule). Vite/Rolldown's
// `Plugin` is a deeply recursive vendor type (dozens of internal types: `ObjectHook`,
// `MinimalPluginContext`, `DevEnvironment`, ...) — verified via `deno doc --lint` that chasing it
// to zero would mean re-exporting a large slice of Rolldown's own internals, none of which
// `@zanix/space` owns or can keep in sync with upstream. `spacePlugin` returning a real Vite
// `Plugin` object is unavoidable (it must compose into `vite.config.ts`'s `plugins` array) — this
// one `private-type-ref` finding is accepted as a structural limit of wrapping a third-party
// build-tool plugin type in a JSR package, not a gap in this package's own documentation.

/**
 * Options for {@linkcode spacePlugin}. Empty for now — reserved for the config that routing,
 * selective hydration, and CSS integration will each contribute once those are implemented.
 * Declared as a named type from the start so adding fields later never requires changing
 * `spacePlugin`'s call sites, only this type.
 */
// deno-lint-ignore no-empty-interface
export interface SpacePluginOptions {
}

/**
 * The Vite plugin(s) that wire a `@zanix/space` app into Vite's build/dev pipeline.
 *
 * Configures the two base Environment API targets everything else builds on top of — `client` and
 * `ssr` — plus real React Fast Refresh for the `client` environment (Comets), via
 * `@vitejs/plugin-react`'s own `react()`. Deliberately minimal beyond that: routing and selective
 * hydration will each register their own plugin logic alongside this one rather than this function
 * growing to own responsibilities that aren't its own.
 *
 * Returns an array (same pattern {@linkcode cssPlugin} already uses), because `react()` itself is
 * several cooperating plugins, not one — spread it into a `plugins: [...]` array like any other
 * entry, or via `...spacePlugin()` if composing it alongside more plugins in the same array. Never
 * needs a `command`/dev-vs-build branch here: `react()`'s own sub-plugins already self-restrict
 * (`apply: 'serve'` for the refresh-wrapper/runtime pieces, `applyToEnvironmentHook` gating
 * everything to `client` specifically) — confirmed via a real, disposable spike reading its actual
 * `dist/index.js` and exercising `transformRequest` end-to-end, not assumed from its docs. Under
 * Vite 8/Rolldown specifically, it does NOT layer a separate Babel transform on top of this
 * project's own native JSX handling (`deno.json`'s `compilerOptions.jsx`/`jsxImportSource`) — its
 * `"vite:react-babel"`-named sub-plugin only configures Rolldown's own native `oxc.jsx` transform
 * options (`runtime`, `importSource`, `refresh: command === 'serve'`), so there is no double
 * transform to reconcile.
 *
 * Also includes {@linkcode denoOptimizeDepsAliasPlugin} — fixes a real Vite/`@deno/vite-plugin`
 * architecture gap that otherwise breaks `optimizeDeps` (silently falling back to serving raw,
 * un-bundled CommonJS a browser can't execute) for ANY npm dependency a Comet imports, `react`
 * included — see that file's own doc for the full root cause. Deliberately renderer-agnostic: it
 * only ever reads whatever `optimizeDeps.include` already contains, never anything React-specific,
 * so it keeps working unchanged for a future non-React renderer.
 *
 * The Environment API itself is still a release candidate in Vite — this function is the single
 * seam meant to absorb any future breaking change there without forcing every `vite.config.ts`
 * that calls `spacePlugin()` to change too.
 *
 * @param _options - See {@linkcode SpacePluginOptions}. Unused today; accepted now so adding
 * options later is additive.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from 'vite'
 * import { spacePlugin } from '@zanix/space/vite'
 *
 * export default defineConfig({
 *   plugins: [...spacePlugin()],
 * })
 * ```
 */
export function spacePlugin(_options: SpacePluginOptions = {}): Plugin[] {
  return [
    {
      name: 'zanix-space',
      config() {
        return {
          environments: {
            client: {},
            ssr: { consumer: 'server' },
          },
        }
      },
    },
    ...react(),
    denoOptimizeDepsAliasPlugin(),
  ]
}
