/**
 * PWA manifest/config types — a `@zanix/space` app declares these once via `defineSpaceApp({ pwa
 * })`. Unlike CSS's build-only toggles, this genuinely drives runtime behavior (the
 * `manifest.webmanifest`/icon routes `registerPwa` registers, and the `<link rel="manifest">`/
 * theme-color `<meta>` every full-document response gets), unlike CSS's build-only toggles, which
 * never affect a response beyond the bytes Vite already emitted at build time.
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
 * Web Push handling built into the generated service worker — the `push` field of
 * {@linkcode PwaConfig}. The worker only receives and displays pushes; subscribing
 * (`PushManager.subscribe`), storing subscriptions and sending are the app's own concern.
 *
 * A push payload is a JSON object `{ title, body?, url?, tag?, icon?, badge? }`. `url` is where a
 * click opens and must be same-origin, otherwise {@linkcode PwaPushConfig.defaultUrl} is used. A
 * push with no payload, or one that is not that JSON, still shows a notification titled
 * {@linkcode PwaPushConfig.fallbackTitle}: browsers require every push to be visible.
 */
export interface PwaPushConfig {
  /** Title of the notification shown for a push without a usable payload.
   * @default the app's `PwaConfig.name` */
  fallbackTitle?: string
  /** Where a click opens when the payload carries no same-origin `url`.
   * @default '/' */
  defaultUrl?: string
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
   * Adds Web Push `push` and `notificationclick` handlers to the generated service worker. Omit for
   * a worker that never shows a notification. An app that needs its own push logic leaves this
   * unset and registers those listeners from {@linkcode PwaConfig.serviceWorkerScript} instead:
   * both would show a notification for the same push.
   */
  push?: PwaPushConfig
  /**
   * Path to a classic script, relative to the project root, appended to the generated service
   * worker at build time. It runs in the worker's global scope inside its own function scope, so
   * its declarations never collide with the generated worker's. Use it for logic the generated
   * worker does not cover, such as custom `push`/`notificationclick` handling.
   */
  serviceWorkerScript?: string
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
