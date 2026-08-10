import type { Plugin } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin'
import { writeCssModuleDts } from './css-modules-dts.ts'

// `Plugin` is not re-exported here — same accepted `deno doc --lint` finding, for the same reason,
// as `spacePlugin`'s own (see that file's own comment).

/** Options for {@linkcode cssPlugin}. */
export interface CssPluginOptions {
  /** Wires `@tailwindcss/vite` into the build. @default true */
  tailwind?: boolean
  /** CSS Modules (`*.module.css`) — already built into Vite with zero config; `false` here
   * disables that built-in behavior app-wide, it never turns anything on. Also gates the typed
   * `*.module.css.d.ts` codegen below — there is nothing to type once modules are off. @default
   * true */
  modules?: boolean
  /** Wires `@vanilla-extract/vite-plugin` into the build — opt-in, since most apps only need
   * Tailwind/CSS Modules. @default false */
  vanillaExtract?: boolean
}

const MANIFEST_FILE_NAME = 'css-manifest.json'

/**
 * Wires this app's CSS pipeline into Vite — Tailwind v4 and CSS Modules by default (the latter
 * already native to Vite, so there's nothing to add for it beyond an explicit opt-out), with
 * vanilla-extract available as an opt-in for teams that want typed theme contracts. Also writes
 * `css-manifest.json` (in the client build's output directory) listing every built stylesheet's
 * real, hashed URL, in build order — read back at request time via `getCssManifest`, so a page's
 * document can link to its real stylesheet(s) instead of nothing at all (there is no dev-mode
 * equivalent yet: live CSS delivery in development is the Development Server module's own
 * responsibility, not yet implemented — see this package's own design doc, Etapa 7bis).
 *
 * Also writes a `*.module.css.d.ts` next to every `*.module.css` file it transforms (dev and
 * build alike), typing its class names as a real compile-time check `deno check`/CI actually
 * enforces — not just editor-only intellisense (see `css-modules-dts.ts`'s own comment for why a
 * plain TypeScript language-service plugin wasn't enough here).
 *
 * Sibling to `spacePlugin`/`cometPlugin`, not merged into either — same reasoning as
 * `spacePlugin`'s own doc comment: each concern registers its own plugin logic rather than one
 * function growing to own responsibilities that aren't its own.
 *
 * @param options - See {@linkcode CssPluginOptions}.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from 'vite'
 * import { spacePlugin, cometPlugin, cssPlugin } from '@zanix/space/vite'
 *
 * export default defineConfig({
 *   plugins: [...spacePlugin(), cometPlugin(), cssPlugin()],
 * })
 * ```
 */
export function cssPlugin(options: CssPluginOptions = {}): Plugin[] {
  const { tailwind = true, modules = true, vanillaExtract = false } = options
  const plugins: Plugin[] = []

  if (tailwind) plugins.push(...tailwindcss())
  if (vanillaExtract) plugins.push(...vanillaExtractPlugin())

  plugins.push({
    name: 'zanix-space-css',
    config() {
      return modules ? undefined : { css: { modules: false } }
    },
    async transform(_code, id) {
      if (!modules || !id.endsWith('.module.css')) return null
      try {
        await writeCssModuleDts(id)
      } catch (error) {
        // A typed-codegen failure is a DX nicety lost, never a reason to fail the actual CSS build.
        this.warn(`zanix-space-css: failed to write a typed .d.ts for ${id}: ${error}`)
      }
      return null
    },
    generateBundle(_options, bundle) {
      const manifest: string[] = []
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'asset' && chunk.fileName.endsWith('.css')) {
          manifest.push(`/${chunk.fileName}`)
        }
      }
      if (manifest.length === 0) return

      this.emitFile({
        type: 'asset',
        fileName: MANIFEST_FILE_NAME,
        source: JSON.stringify(manifest, null, 2),
      })
    },
  })

  return plugins
}
