import type { Plugin } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin'
import { writeCssModuleDts } from './css-modules-dts.ts'
import type { CssManifest, StylesheetRef } from 'modules/render/css-manifest.ts'

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
  /**
   * `entryName -> comet source key` (see `build-client.ts`'s own construction, from
   * `normalizeSourceKey`) — every comet is already its own real Rollup entry (`cometPlugin`'s own
   * `emitFile({type:'chunk'})`, or a real `rollupOptions.input` entry when `knownEntryPaths` says
   * so), which means its OWN JS chunk already carries Vite's own `viteMetadata.importedCss` — the
   * exact CSS that comet (and its own imports) pulled in, confirmed empirically via a real build,
   * never guessed. Used here to scope that comet's own CSS under `css-manifest.json`'s `comets`
   * field instead of letting it fall into the flat `global` list every other stylesheet still
   * does — the fix for a real, confirmed bug where a Comet's CSS used to ship on every page,
   * whether or not that page ever rendered it. Omitted entirely (no comets in this build): no
   * behavior change at all, `comets` is simply never written.
   */
  cometEntries?: Record<string, string>
  /**
   * `globalCss` entries, in DECLARATION order, each already its own real Rollup entry (see
   * `build-client.ts`'s own construction) — the fix for a real, confirmed bug where
   * `css-manifest.json`'s `global` scope was written in whatever order `Object.values(bundle)`
   * happened to yield (alphabetical by hashed output filename), not the order `globalCss` actually
   * declared, silently contradicting that field's own "order matters, later entries can override
   * earlier ones" contract. Same `chunk.viteMetadata.importedCss` correlation `cometEntries` above
   * already uses — an entry's own `media` (if any) travels through unchanged into the manifest.
   * Omitted entirely: `global` falls back to the original unordered sweep of every unclaimed `.css`
   * asset, unchanged from before this option existed — a direct `cssPlugin()` caller that doesn't
   * know about individual `globalCss` entries (or has none) sees no behavior change at all.
   */
  globalEntries?: Array<{ entryName: string; media?: string }>
  /**
   * `pageFilePath -> [{entryName, media}]` (see `build-client.ts`'s own construction, from
   * `discoverPageStyles`), in DECLARATION order PER PAGE — same `chunk.viteMetadata.importedCss`
   * correlation `cometEntries`/`globalEntries` already use, grouped by the page each entry belongs
   * to rather than flattened, since a page's own CSS must stay scoped to `css-manifest.json`'s
   * `pages[pageFilePath]` — never folded into `global`, never linked on a page that didn't declare
   * it (the same scoping principle `cometEntries` already established for Comets, applied here to
   * pages — see P2-12b's own design doc). Omitted entirely (no page declares `styles` in this
   * build): no behavior change at all, `pages` is simply never written.
   */
  pageEntries?: Record<string, Array<{ entryName: string; media?: string }>>
}

const MANIFEST_FILE_NAME = 'css-manifest.json'

/**
 * Wires this app's CSS pipeline into Vite — Tailwind v4 and CSS Modules by default (the latter
 * already native to Vite, so there's nothing to add for it beyond an explicit opt-out), with
 * vanilla-extract available as an opt-in for teams that want typed theme contracts. Also writes
 * `css-manifest.json` (in the client build's output directory), read back at request time via
 * `getCssManifest`/`resolveCssHrefs`/`getCometCssHrefs`, so a page's document can link to its real
 * stylesheet(s) instead of nothing at all (there is no dev-mode equivalent yet: live CSS delivery
 * in development is the Development Server module's own responsibility, not yet implemented — see
 * this package's own design doc).
 *
 * The manifest has three scopes: `global` (every stylesheet not claimed by a comet or a page —
 * `globalCss`, Tailwind, CSS Modules used outside a Comet, vanilla-extract), linked on every
 * full-document response, in the same order `globalCss` declared it (and carrying each entry's own
 * `media`, when given) whenever `globalEntries` correlates it to a known entry — see that option's
 * own doc; `pages`, keyed by a page's own source `filePath`, linked ONLY on that specific page's own
 * response, alongside `global` (see `render-page-react.tsx`/`render-page-preact.ts`'s own doc for
 * where the two get concatenated); and `comets`, keyed by comet source identity, linked ONLY when
 * that specific comet is actually used on the current page (see `define-comet.ts`'s own doc for
 * how — React and Preact reach this through two genuinely different mechanisms).
 * `cometEntries`/`globalEntries`/`pageEntries` are what make their respective scoping possible —
 * omit any of them and that category falls back to the original unconditional/unordered sweep,
 * unchanged from before these options existed.
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
  const {
    tailwind = true,
    modules = true,
    vanillaExtract = false,
    cometEntries = {},
    globalEntries = [],
    pageEntries = {},
  } = options
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
        this.warn(
          `zanix-space-css: failed to write a typed .d.ts for ${id}: ${error}`,
        )
      }
      return null
    },
    generateBundle(_options, bundle) {
      // Comet scope FIRST — claiming each comet's own CSS file names here is what keeps them out
      // of the flat `global` sweep below, the actual mechanism behind the scope fix.
      const claimedCssFileNames = new Set<string>()
      const comets: Record<string, StylesheetRef[]> = {}
      for (const [entryName, sourceKey] of Object.entries(cometEntries)) {
        const chunk = Object.values(bundle).find((c) => c.type === 'chunk' && c.name === entryName)
        const importedCss = chunk?.type === 'chunk' ? chunk.viteMetadata?.importedCss : undefined
        if (!importedCss || importedCss.size === 0) continue

        const hrefs: StylesheetRef[] = []
        for (const cssFileName of importedCss) {
          claimedCssFileNames.add(cssFileName)
          hrefs.push(`/${cssFileName}`)
        }
        comets[sourceKey] = hrefs
      }

      // Global scope, in DECLARATION order — same entry-correlation approach as comets above,
      // walking `globalEntries` (not the bundle) so the manifest's own order matches `globalCss`'s
      // order, and so an entry's own `media` travels through.
      const global: StylesheetRef[] = []
      for (const { entryName, media } of globalEntries) {
        const chunk = Object.values(bundle).find((c) => c.type === 'chunk' && c.name === entryName)
        const importedCss = chunk?.type === 'chunk' ? chunk.viteMetadata?.importedCss : undefined
        if (!importedCss || importedCss.size === 0) continue

        for (const cssFileName of importedCss) {
          if (claimedCssFileNames.has(cssFileName)) continue
          claimedCssFileNames.add(cssFileName)
          global.push(media === undefined ? `/${cssFileName}` : { href: `/${cssFileName}`, media })
        }
      }

      // Page scope, in DECLARATION order PER PAGE — same correlation approach as comets/global
      // above, walking `pageEntries` (grouped by page, not flattened) so a page's own CSS lands
      // under its own key in `pages`, never in `global` (the fix P2-12b's own scope requirement
      // needs: a stylesheet declared by page A must never link on page B).
      const pages: Record<string, StylesheetRef[]> = {}
      for (const [pageFilePath, entries] of Object.entries(pageEntries)) {
        const hrefs: StylesheetRef[] = []
        for (const { entryName, media } of entries) {
          const chunk = Object.values(bundle).find((c) =>
            c.type === 'chunk' && c.name === entryName
          )
          const importedCss = chunk?.type === 'chunk' ? chunk.viteMetadata?.importedCss : undefined
          if (!importedCss || importedCss.size === 0) continue

          for (const cssFileName of importedCss) {
            if (claimedCssFileNames.has(cssFileName)) continue
            claimedCssFileNames.add(cssFileName)
            hrefs.push(media === undefined ? `/${cssFileName}` : { href: `/${cssFileName}`, media })
          }
        }
        if (hrefs.length > 0) pages[pageFilePath] = hrefs
      }

      // Fallback sweep — any `.css` asset no known entry (comet, global, or page) claimed, in
      // whatever order `Object.values(bundle)` yields. Covers a direct `cssPlugin()` caller that
      // never passes `globalEntries` (unchanged from before this option existed — every existing
      // test exercising that path keeps seeing exactly the same output), and is a safety net for
      // any stylesheet this build produced through a path no known-entry list tracks.
      for (const chunk of Object.values(bundle)) {
        if (
          chunk.type === 'asset' && chunk.fileName.endsWith('.css') &&
          !claimedCssFileNames.has(chunk.fileName)
        ) {
          global.push(`/${chunk.fileName}`)
        }
      }

      const hasComets = Object.keys(comets).length > 0
      const hasPages = Object.keys(pages).length > 0
      if (global.length === 0 && !hasComets && !hasPages) return

      const manifest: CssManifest = {
        global,
        ...(hasPages ? { pages } : {}),
        ...(hasComets ? { comets } : {}),
      }
      this.emitFile({
        type: 'asset',
        fileName: MANIFEST_FILE_NAME,
        source: JSON.stringify(manifest, null, 2),
      })
    },
  })

  return plugins
}
