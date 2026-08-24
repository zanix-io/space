import { InternalError } from '@zanix/errors'
import { isDevClientEnabled } from '../dev/dev-client-registry.ts'
import { resolveDevCssHrefs, resolveDevPageCssHrefs } from '../dev/dev-css-hrefs.ts'
import { normalizeSourceKey } from '../comets/comet-manifest.ts'

/** A single stylesheet reference — the one shape every CSS delivery scope (global, page, comet)
 * uses, so none of them ends up as an independent, duplicated mechanism. A plain `string` is the
 * pre-existing contract, unchanged: renders as `<link rel="stylesheet" href={value}>`, no `media`.
 * The object form is strictly additive — `media` is opaque, author-supplied data, never parsed or
 * validated beyond `typeof === 'string'`: it renders as a normal JSX attribute
 * (`<link media={value}>`), which React/Preact already escape correctly, so there is no injection
 * surface here the way `theme.resolve`'s own `theme-style.ts` has to guard against (that one
 * interpolates into a `<style>` tag's TEXT content; this is a plain attribute). An invalid media
 * query is simply ignored by the browser, the same as if it had been hand-written in HTML. */
export type StylesheetRef = string | { href: string; media?: string }

/** The built stylesheet URLs a page's document needs — written by `cssPlugin` during the client
 * build (`css-manifest.json`, in the client build's own output directory), read back here once at
 * server startup.
 *
 * `global` is the direct translation of `globalCss` — order matters (later entries can override
 * earlier ones via normal CSS cascade), so it's a plain ordered list, not a map.
 *
 * `pages`, keyed by a page's own source `filePath` (the EXACT same identity `page-tree-registry.ts`
 * already stores — see `getPageTree`), is that page's OWN `static styles` — resolved into a full
 * document response together with `global` (`global` first, then this page's own entries, in
 * declaration order), but genuinely SCOPED: a stylesheet declared by page A is never linked when
 * rendering page B, unlike `global`, which every page always gets. See {@linkcode
 * resolvePageCssHrefs}.
 *
 * `comets`, keyed by a comet's own `sourceUrl` (the exact same identity `comets-manifest.json`
 * already uses — see `comet-manifest.ts`), is that comet's OWN CSS (its `.module.css` imports,
 * correlated at build time via each comet's own forced chunk — see `cssPlugin`'s own doc for how).
 * Deliberately NOT flattened into `global`: a comet's CSS must only ever reach the client when that
 * comet is actually used on the current page (`getCometCssHrefs`) — bundling it into `global`
 * instead would ship every comet's styles to every page, used or not. */
export interface CssManifest {
  /** Every app-wide stylesheet, applied to every page. */
  global: StylesheetRef[]
  /** Per-page stylesheets, keyed by the page's own route. */
  pages?: Record<string, StylesheetRef[]>
  /** Per-comet stylesheets, keyed by the comet's own `sourceUrl` identity. */
  comets?: Record<string, StylesheetRef[]>
}

let manifest: CssManifest | undefined
let globalCssPaths: StylesheetRef[] | undefined

/**
 * Loads the manifest `cssPlugin` writes during a production client build, so a page's document can
 * link to its real, hashed stylesheet URL(s) instead of nothing at all.
 *
 * Call this once, before serving any requests — same convention as `loadCometManifest`, typically
 * right after it in this app's own `main.ts`. A missing file is not an error — the normal case
 * whenever this app declares no `globalCss` at all, or (dev) whenever `resolveCssHrefs` is about
 * to serve the dev-resolved hrefs instead (see its own doc).
 *
 * @param path - Path to the manifest JSON file, as written by `cssPlugin`.
 */
export async function loadCssManifest(path: string): Promise<void> {
  try {
    manifest = JSON.parse(await Deno.readTextFile(path))
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return
    // Boot-time-only — see `comet-manifest.ts`'s own `loadCometManifest` for why no `code`/
    // `userMessage` here, matching `WebServerManager`'s `readSslFile` precedent.
    throw new InternalError(`Failed to load the CSS manifest from "${path}".`, {
      cause: error,
      meta: { source: 'zanix', method: 'loadCssManifest', path },
    })
  }
}

/** Test-only escape hatch — sets (or clears, via `undefined`) the manifest directly, without
 * touching the filesystem. Not exported from this package's public entry points. */
export function setCssManifest(value: CssManifest | undefined): void {
  manifest = value
}

/** The currently loaded manifest, or `undefined` if none was loaded — production only; see
 * {@linkcode resolveCssHrefs} for the dev-aware accessor `SpacePageController`/
 * `createNotFoundHandler` actually call for the global scope, and {@linkcode getCometCssHrefs} for
 * a specific comet's own scope. */
export function getCssManifest(): CssManifest | undefined {
  return manifest
}

/**
 * Hard-sets (or clears, via `undefined`) the declared global stylesheet paths, discarding whatever
 * was there before — the one primitive that does NOT compose with an already-activated app's own
 * `globalCss` (see {@linkcode addGlobalCssPaths} for the one `defineSpaceApp()` itself actually
 * calls). Exported for callers that genuinely want an exact, unconditional value — tests resetting
 * state between runs, or an advanced caller replacing the whole list on purpose.
 */
export function setGlobalCssPaths(paths: StylesheetRef[] | undefined): void {
  globalCssPaths = paths
}

/**
 * Appends `paths` to whatever global stylesheet paths were already declared — called by
 * `defineSpaceApp({ globalCss })`, eagerly (same timing as `pwa` — see `defineSpaceApp`'s own doc),
 * once per app. This is what lets a HOST compose a base app's own `globalCss` without ever
 * referencing its actual file paths: if the base app's own `defineSpaceApp()` call executes first
 * (e.g. its module is activated before a host's own customization app), and the
 * host's own `defineSpaceApp({ globalCss: ['./custom.css'] })` executes after, `getGlobalCssPaths()`
 * resolves to `['./base.css', './custom.css']` — the base app's own declaration preserved, the
 * host's own appended after it, letting normal cascade/specificity decide what actually overrides
 * what. Neither app references the other's file paths; composition is purely a function of WHEN
 * each `defineSpaceApp()` call runs, same "declaration order wins" principle `activateApps()`'s own
 * `onStart` sequencing already follows. An app that omits `globalCss` entirely contributes nothing,
 * leaving whatever another app already declared untouched.
 *
 * This is the single source of truth {@linkcode resolveCssHrefs} resolves from in dev, and the real
 * client build's own `rollupOptions.input` is meant to include in production.
 */
export function addGlobalCssPaths(paths: StylesheetRef[]): void {
  globalCssPaths = [...(globalCssPaths ?? []), ...paths]
}

/** Test-only escape hatch, same reasoning as {@linkcode setCssManifest}. */
export function getGlobalCssPaths(): StylesheetRef[] | undefined {
  return globalCssPaths
}

/**
 * The GLOBAL stylesheet hrefs a full-document response should `<link>` — the one accessor
 * `SpacePageController`/`createNotFoundHandler` actually call, never {@linkcode getCssManifest}
 * directly. Dev-aware: in `znx space dev` (`isDevClientEnabled()`), resolves
 * {@linkcode getGlobalCssPaths}'s declared source paths straight through
 * `resolveDevCssHrefs` — no build, no hashing, no manifest file involved. Outside of dev, returns
 * the production manifest's own `global` scope unchanged (`undefined` if none was ever loaded).
 *
 * Deliberately scoped to GLOBAL only — a comet's own CSS is never part of this list, resolved
 * instead via {@linkcode getCometCssHrefs} at the exact point a comet renders (see
 * `define-comet.ts`'s own doc for why, and how React/Preact reach the same outcome through two
 * genuinely different mechanisms).
 */
export function resolveCssHrefs(): StylesheetRef[] | undefined {
  if (isDevClientEnabled()) return resolveDevCssHrefs(globalCssPaths ?? [])
  return manifest?.global
}

/**
 * A specific comet's OWN stylesheet hrefs, by its `sourceUrl` (the same identity
 * `comets-manifest.json` already keys on) — `[]` when that comet has no CSS of its own, when no
 * manifest was ever loaded (dev — Vite's own dev-time module graph already injects a loaded
 * comet's CSS Module client-side, with zero help needed from this function there), or when
 * `sourceUrl` simply isn't a comet this build knows about. Never `undefined` — always a safe,
 * empty-or-real array to spread into a `<link>` list without a null check at every call site.
 */
export function getCometCssHrefs(sourceUrl: string): StylesheetRef[] {
  return manifest?.comets?.[normalizeSourceKey(sourceUrl)] ?? []
}

/**
 * A specific page's OWN stylesheet hrefs, by its source `filePath` (the same identity
 * `page-tree-registry.ts` already stores as `PageTree.filePath`, and `scanPageFiles`/`build-client.ts`
 * key `css-manifest.json`'s own `pages` scope by — no normalization needed, unlike
 * {@linkcode getCometCssHrefs}'s `sourceUrl`, which is a `file://` URL a comet's own
 * `import.meta.url` produces; a page's `filePath` is already a plain filesystem path everywhere it's
 * used). Dev-aware, same split as {@linkcode resolveCssHrefs}: in `znx space dev`, resolves
 * `styles` — this page's own LIVE static field, read directly off the loaded class, never a
 * manifest — through {@linkcode resolveDevPageCssHrefs}, relative to this page's own file (the
 * "direct-asset path", no build/hashing involved). Outside of dev, `styles` is ignored entirely —
 * the production manifest (already built from that same field) is the only source of truth.
 *
 * `[]` (never `undefined`) whenever `filePath` is unknown (a page never routed through
 * `loadRoutes()`), `styles` is empty/undeclared, no manifest was ever loaded, or `filePath` simply
 * isn't a page this build knows about — same "always a safe, spreadable array" contract
 * {@linkcode getCometCssHrefs} already follows.
 *
 * @param filePath - This page's own `getPageTree(Target)?.filePath` — `undefined` short-circuits to
 * `[]` so a caller never needs its own null check first.
 * @param styles - This page's own `static styles` field, as declared on the class — read ONLY in
 * dev; ignored in production (the manifest already reflects it, built ahead of time).
 */
export function resolvePageCssHrefs(
  filePath: string | undefined,
  styles: StylesheetRef[] | undefined,
): StylesheetRef[] {
  if (!filePath) return []
  if (isDevClientEnabled()) return styles ? resolveDevPageCssHrefs(filePath, styles) : []
  return manifest?.pages?.[filePath] ?? []
}
