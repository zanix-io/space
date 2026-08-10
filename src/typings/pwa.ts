/**
 * PWA manifest/config types — a `@zanix/space` app declares these once via `defineSpaceApp({ pwa
 * })`. Unlike CSS's build-only toggles, this genuinely drives runtime behavior (the
 * `manifest.webmanifest`/icon routes `registerPwa` registers, and the `<link rel="manifest">`/
 * theme-color `<meta>` every full-document response gets) — see this package's own design doc
 * (Etapa 7bis's PWA continuation) for why that split isn't the same as CSS's.
 *
 * @module
 */

/** One entry in the Web App Manifest's own `shortcuts` array — a jump-list item on a long-press
 * of the installed app's icon (Tier 1, supported cross-browser wherever install itself is). */
export interface PwaShortcut {
  /** Label shown in the shortcut menu. */
  name: string
  /** URL to open — resolved the same way any other link on the site would be. */
  url: string
  /** An icon path for this specific shortcut. Omit to use the app's own default icon. */
  icon?: string
}

/**
 * Author-facing PWA configuration — the parameter to `defineSpaceApp({ pwa })`. Contains only
 * what an author actually wants to express — this app's own identity/icon/behavior — never a
 * build OUTPUT path. Where `pwaPlugin` actually wrote the generated icons/service worker is a
 * build-output fact, not author configuration; the runtime discovers it via
 * {@linkcode loadPwaBuildOutput} (`pwa-registry.ts`) instead, the same way `loadCometManifest`/
 * `loadCssManifest` already discover their own build outputs — see that function's own doc for
 * the full reasoning and its precedent.
 */
export interface PwaConfig {
  /** The installed app's full name (`name` in the Web App Manifest). */
  name: string
  /** A shorter name for contexts with limited space (home screen labels, etc.). Falls back to
   * `name` when omitted. */
  shortName?: string
  /** `theme_color` in the manifest, and the `<meta name="theme-color">` on every page — the
   * browser chrome/status bar color while the app is open. */
  themeColor?: string
  /** `background_color` in the manifest — shown behind the splash screen before the first paint. */
  backgroundColor?: string
  /** Jump-list entries shown on a long-press of the installed app's icon. */
  shortcuts?: PwaShortcut[]
  /** A route to serve when the service worker's own runtime cache has nothing for a navigation
   * request and the network is genuinely unreachable. Omit for no offline fallback (a plain
   * browser connection-error page instead). */
  offlineFallback?: string
  /**
   * Path to a single source icon image (ideally ≥512×512, square), relative to the project root
   * — resized at build time into every size in `iconSizes`. Required whenever `pwa` is configured
   * at all: a PWA can't be installed without a real icon. Forwarded to `pwaPlugin` internally via
   * `resolvePwaPluginOptions` — never configured on the plugin separately.
   */
  icon: string
  /**
   * Sizes (in pixels) to generate `icon` into. The single source of truth for icon sizes across
   * this whole pipeline — `pwaPlugin`'s own build-time options, the Web App Manifest's own
   * `icons` array, and the icon routes `registerPwa` registers are ALL derived from this one
   * field, never independently configured or duplicated.
   * @default [192, 512]
   */
  iconSizes?: number[]
}
