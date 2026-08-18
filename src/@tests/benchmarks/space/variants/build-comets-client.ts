/**
 * Builds the client bundle for variants B (React+Comets, no Compiler), C (React+Compiler+Comets),
 * and D (Preact+Comets) — real, unmodified `cometPlugin()`/`@deno/vite-plugin`, the SAME pieces
 * `buildSpaceClient` (`modules/bundler/build-client.ts`) itself composes. The one thing this
 * function does NOT reuse `buildSpaceClient` for is the renderer/Compiler plugin choice: that
 * function always calls the real `spacePlugin()`, which — for `renderer: 'react'` — always
 * includes React Compiler with no opt-out (a real, deliberate architectural decision, not a gap —
 * see `space-plugin.ts`'s own doc). Comparing WITH and WITHOUT Compiler under the Comets
 * architecture (this benchmark's own point) needs a build that can turn Compiler off, so this
 * composes `@vitejs/plugin-react`/`@rolldown/plugin-babel`/`reactCompilerPreset` directly instead
 * — the exact same real packages `space-plugin.ts` itself imports, just wired without the
 * mandatory-Compiler ternary. No production source file is modified by this.
 *
 * @module
 */
import { build } from 'vite'
import type { PluginOption } from 'vite'
import deno from '@deno/vite-plugin'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import preact from '@preact/preset-vite'
import { cometPlugin } from 'modules/bundler/comet-plugin.ts'

export type RendererKind = 'react' | 'preact'

export interface BuildCometsClientOptions {
  root: string
  outDir: string
  renderer: RendererKind
  /** Only meaningful for `renderer: 'react'` — Preact has no compiler of its own, so this is
   * ignored (never even referenced) when `renderer === 'preact'`. */
  compiler: boolean
  /** `entryName -> absolute comet source path` — hand-written, not `discoverComets()`, since this
   * benchmark's own fixture has a small, fixed, known set of comet files (see `../scenario/`). */
  comets: Record<string, string>
}

// `PluginOption`, not `Plugin[]` — matches `space-plugin.ts`'s own real return type exactly, for
// the same reason: `PluginOption` is Vite's own deliberately loose union (`Plugin | Promise<Plugin>
// | PluginOption[] | Falsy`), which is what lets a lazily-resolved `import('@rolldown/plugin-babel')`
// promise sit directly in a plugins array unresolved — Vite itself awaits it during config loading.
// `Plugin[]` is too strict for this: `@rolldown/plugin-babel`'s own `Plugin` type (from `rolldown`,
// not `vite`) has a structurally slightly different `resolveId` hook signature than Vite's own
// `Plugin` type, a real, pre-existing vendor-type mismatch between the two packages — `space-plugin.ts`
// itself never awaits/inlines the babel plugin as a resolved `Plugin` for exactly this reason (see
// that file's own doc), so this function follows the identical, already-proven pattern instead of
// fighting the same mismatch a different way.
function rendererPlugins(renderer: RendererKind, compiler: boolean): PluginOption {
  if (renderer === 'preact') return [...preact()]
  if (!compiler) return [...react()]
  return [
    ...react(),
    import('@rolldown/plugin-babel').then(({ default: babel }) =>
      babel({ presets: [reactCompilerPreset()] })
    ),
  ]
}

export async function buildCometsClient(options: BuildCometsClientOptions): Promise<void> {
  const { root, outDir, renderer, compiler, comets } = options

  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    build: {
      write: true,
      outDir,
      emptyOutDir: true,
      minify: true,
      rollupOptions: {
        input: comets,
        // Same reasoning as `buildSpaceClient`'s own identical option (see that file's own doc) —
        // a comet's default export must survive the build for `hydrateComets` to read it back.
        preserveEntrySignatures: 'exports-only',
      },
    },
    plugins: [
      deno(),
      rendererPlugins(renderer, compiler),
      cometPlugin({ knownEntryPaths: Object.values(comets) }),
    ],
  })
}
