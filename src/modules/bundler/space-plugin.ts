import type { PluginOption } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import preact from '@preact/preset-vite'
import { denoOptimizeDepsAliasPlugin } from './deno-optimize-deps-alias.ts'
import { clientBarrelGuardPlugin } from './client-barrel-guard.ts'

// `PluginOption` is intentionally NOT re-exported here, unlike this package's other vendor-type
// references (see `typings/manifest.ts`'s doc comment for the general rule). Vite/Rolldown's
// `Plugin`/`PluginOption` are deeply recursive vendor types (dozens of internal types:
// `ObjectHook`, `MinimalPluginContext`, `DevEnvironment`, ...) — verified via `deno doc --lint`
// that chasing them to zero would mean re-exporting a large slice of Rolldown's own internals,
// none of which `@zanix/space` owns or can keep in sync with upstream. `spacePlugin` returning a
// real Vite `PluginOption[]` is unavoidable (it must compose into `vite.config.ts`'s `plugins`
// array) — this one `private-type-ref` finding is accepted as a structural limit of wrapping a
// third-party build-tool plugin type in a JSR package, not a gap in this package's own
// documentation.

/**
 * Options for {@linkcode spacePlugin}.
 */
export interface SpacePluginOptions {
  /**
   * Which renderer this app's Comets/pages are authored against — `'react'` (React 19, streaming
   * SSR, `Suspense`, full async semantics — the framework's original, complete renderer,
   * unchanged, and the only renderer React Compiler ever runs against — see below) or `'preact'`
   * (Preact core, no `preact/compat`, a deliberately smaller/reduced renderer for Comets/islands
   * and pages whose data resolves entirely inside their own `loader` — Preact core has no
   * `Suspense`/`use()`, so a page or Comet needing
   * `Suspense`/`loading.tsx`/`useRequestCache` is not supported under `'preact'`, by design, not
   * as an oversight).
   *
   * `renderer: 'react'` always compiles through React Compiler (`@vitejs/plugin-react`'s own
   * `reactCompilerPreset()`, no opt-out flag — see {@linkcode spacePlugin}'s own doc for what that
   * means and doesn't mean for `'preact'`).
   *
   * Selects the renderer for the WHOLE project, not per-file — never both at once (no hybrid
   * React+Preact composition is supported). Defaults to `'react'`, matching this package's
   * behavior before this option existed; choosing `'react'` explicitly or omitting this field are
   * identical in every respect.
   */
  renderer?: 'react' | 'preact'
}

/**
 * The Vite plugin(s) that wire a `@zanix/space` app into Vite's build/dev pipeline.
 *
 * Configures the two base Environment API targets everything else builds on top of — `client` and
 * `ssr` — plus real Fast Refresh for the `client` environment (Comets), via whichever renderer
 * `options.renderer` selects (`@vitejs/plugin-react`'s `react()` for `'react'`, the default;
 * `@preact/preset-vite`'s `preact()` for `'preact'`). Deliberately minimal beyond that: routing and
 * selective hydration will each register their own plugin logic alongside this one rather than
 * this function growing to own responsibilities that aren't its own.
 *
 * Returns an array (same pattern {@linkcode cssPlugin} already uses), because `react()`/`preact()`
 * are each several cooperating plugins, not one — spread it into a `plugins: [...]` array like any
 * other entry, or via `...spacePlugin()` if composing it alongside more plugins in the same array.
 * Never needs a `command`/dev-vs-build branch here: both `react()`'s and `preact()`'s own
 * sub-plugins already self-restrict to dev/`serve` on their own — `preact()`/`@prefresh/vite`'s
 * `configResolved` hook self-gates on `config.isProduction`/`config.command === 'build'` the same
 * way `react()`'s own sub-plugins do. Under Vite 8/Rolldown, `react()` does NOT layer a separate Babel
 * transform on top of this project's own native JSX handling (`deno.json`'s
 * `compilerOptions.jsx`/`jsxImportSource`) — its `"vite:react-babel"`-named sub-plugin only
 * configures Rolldown's own native `oxc.jsx` transform options (`runtime`, `importSource`,
 * `refresh: command === 'serve'`), so there is no double transform to reconcile. `preact()` is
 * architecturally different here — confirmed by reading `@prefresh/vite`'s real source and
 * observing its real transform output: it DOES run a real Babel pass (`@prefresh/babel-plugin`)
 * and injects its Fast-Refresh registration inline, per transformed module, rather than via a
 * single global preamble the way React's Fast Refresh does — this package's own `dev` module
 * accounts for that difference at its own seam, not here.
 *
 * `renderer: 'react'` also wires in React Compiler, via `@vitejs/plugin-react`'s own first-party
 * `reactCompilerPreset()` (its documented, official integration point — replacing the older
 * `babel.plugins` option, which v6 dropped entirely alongside its move to Rolldown's native
 * `oxc.jsx` transform above). No opt-out flag — `renderer: 'react'` always compiles: a real
 * Space-shaped component, built through this exact pipeline, produces byte-identical
 * `renderToStaticMarkup`/`renderToReadableStream` output before and after compilation, with its
 * top-level `Fragment` intact. The `@rolldown/plugin-babel` import backing this is a dynamic `import()`, evaluated
 * ONLY inside this ternary's `'react'` branch — for `renderer: 'preact'`, that `import()` is dead
 * code, never reached, never evaluated; `preact()`'s own branch never sees it. This is why this
 * function's return type is {@linkcode PluginOption}`[]`, not `Plugin[]` — one array entry is a
 * `Promise<Plugin>` when the `'react'` branch runs, which Vite itself resolves during its own
 * config-loading phase, so no caller of `spacePlugin()` needs to `await` anything or change how
 * they already spread it into their own `plugins: [...]` array. `reactCompilerPreset` itself is a
 * plain function imported alongside `react` from the same, already-shared-by-both-renderers
 * `@vitejs/plugin-react` package (confirmed dependency-free of `babel-plugin-react-compiler`
 * itself) — importing it costs `renderer: 'preact'` nothing; only ever CALLING it (which only
 * happens inside the `'react'` branch) resolves `babel-plugin-react-compiler`'s own path via
 * `import.meta.resolve`, and even that never touches `renderer: 'preact'`.
 *
 * Also includes {@linkcode denoOptimizeDepsAliasPlugin} — fixes a real Vite/`@deno/vite-plugin`
 * architecture gap that otherwise breaks `optimizeDeps` (silently falling back to serving raw,
 * un-bundled CommonJS a browser can't execute) for ANY npm dependency a Comet imports, the active
 * renderer included — see that file's own doc for the full root cause. Deliberately
 * renderer-agnostic: it only ever reads whatever `optimizeDeps.include` already contains, never
 * anything renderer-specific, so it keeps working unchanged regardless of `options.renderer`.
 *
 * The Environment API itself is still a release candidate in Vite — this function is the single
 * seam meant to absorb any future breaking change there without forcing every `vite.config.ts`
 * that calls `spacePlugin()` to change too.
 *
 * @param options - See {@linkcode SpacePluginOptions}.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from 'vite'
 * import { spacePlugin } from '@zanix/space/vite'
 *
 * export default defineConfig({
 *   plugins: [...spacePlugin()], // or spacePlugin({ renderer: 'preact' })
 * })
 * ```
 */
export function spacePlugin(options: SpacePluginOptions = {}): PluginOption[] {
  const { renderer = 'react' } = options
  return [
    {
      name: 'zanix-space',
      config() {
        return {
          environments: {
            // Pre-declared so Vite pre-bundles the active renderer's own client hydration entry
            // at server START, rather than discovering it from the FIRST real browser request.
            // `react-dom/client`'s own internal `react-dom` import is the CONFIRMED case: a
            // request landing while that first-request discovery scan is still running can catch
            // it before its pre-bundled chunk exists — a real `Failed to load url /react-dom`
            // dev-server error, breaking Comet hydration on that one load (a page reload
            // afterward always works, since the scan has finished by then). `hydrate-comets-
            // preact.ts` imports only bare `preact` (no equivalent subpath-needs-its-own-base-
            // package split the way `react-dom/client` has) — but `preact/hooks` is now its own
            // second, CONFIRMED instance of the same class of import: `@zanix/cli`'s own
            // `--theme astronaut` Comet demo imports `useState` from it directly under this
            // renderer (`getHooksEntry`, that package's `lib/renderer.ts`), the exact "a Comet
            // imports a real npm subpath directly" shape this whole mitigation exists for. The
            // general "first request can race the discovery scan" hazard is Vite's, not any one
            // renderer's, and applies to any lazily-discovered dependency; `preact`/`preact/hooks`
            // are included here too so the mitigation is genuinely renderer-agnostic rather than
            // leaving Preact exposed to the same class of race until it produces its own confirmed
            // incident — which, for `preact/hooks`, it now has.
            //
            // `@prefresh/core`/`@prefresh/utils` are here for a DIFFERENT reason than the four
            // above — not the discovery-scan race, but a real, confirmed module-IDENTITY bug:
            // `@prefresh/core`'s own re-render bookkeeping (`vnodesForComponent`, a module-level
            // `WeakMap` populated by Preact's process-wide `options` hooks — see that package's own
            // `runtime/vnode.js`) is only ever correct if EVERY Comet's own module graph resolves
            // `@prefresh/core`/`@prefresh/utils` to the exact same instance the one that patched
            // `options` during that Comet's own `hydrate()` call. `hydrate-comets-preact.ts` loads
            // each Comet via a raw, un-analyzed `await import(/* @vite-ignore */ moduleUrl)` —
            // confirmed (via a live repro: edit a Comet's own JSX text, `import.meta.hot.accept`'s
            // registered callback runs `flushUpdates()` with zero error, yet the DOM never updates)
            // to risk resolving these two to a SEPARATE instance than whatever the Comet's own
            // `hydrate()` call used, silently splitting `vnodesForComponent`'s tracking across two
            // objects — `@prefresh/core`'s own `replaceComponent` then finds nothing for the edited
            // component (`vnodesForComponent.get(OldType)` → `undefined` → a bare, unlogged early
            // return) and the whole flush is a silent no-op. `@preact/preset-vite` itself already
            // forces `preact`/`preact/jsx-runtime`/`preact/jsx-dev-runtime` into this same list for
            // the identical single-instance reason (its own `dist/cjs/index.js`) — `@prefresh/core`/
            // `@prefresh/utils` were simply never added alongside them.
            client: {
              optimizeDeps: {
                include: renderer === 'react'
                  ? ['react', 'react-dom', 'react-dom/client']
                  : ['preact', 'preact/hooks', '@prefresh/core', '@prefresh/utils'],
              },
            },
            ssr: { consumer: 'server' },
          },
        }
      },
    },
    // Fails the client build if the app imported the OTHER renderer's client barrel — a mismatch
    // that is otherwise completely silent (perfect SSR, every boundary present, zero errors, zero
    // interactivity). See `client-barrel-guard.ts`'s own doc for the measurement and for why this
    // cannot be a runtime assertion.
    clientBarrelGuardPlugin(renderer),
    ...(renderer === 'preact' ? preact() : [
      ...react(),
      // Dynamic on purpose — see this function's own doc for why: this `import()` is never
      // evaluated at all when `renderer: 'preact'` picks the other branch above.
      import('@rolldown/plugin-babel').then(({ default: babel }) =>
        babel({ presets: [reactCompilerPreset()] })
      ),
    ]),
    denoOptimizeDepsAliasPlugin(),
  ]
}
