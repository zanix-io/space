/**
 * The one shared naming convention — icon file names/sizes AND the service worker file name —
 * between `pwaPlugin` (build-time, writes these files) and `registerPwa`/`web-manifest.ts`
 * (runtime, serve them) — kept in its own dependency-free module so importing it never pulls
 * `sharp` (a heavy, native, build-tool-only dependency) into the deployed server process, the
 * same reasoning `orbit-protocol.ts` already documents for its own shared constant.
 *
 * @module
 */

/** Where `pwaPlugin` writes a generated icon, relative to the client build's own output
 * directory — `registerPwa` reads from the exact same relative path, resolved against
 * `getPwaBuildOutput()` (`pwa-registry.ts`). */
export function iconFileName(size: number): string {
  return `icon-${size}.png`
}

/** The single source of truth for the default icon sizes — used only when `PwaConfig.iconSizes`
 * is omitted. Previously declared independently in three places (`register-pwa.ts`,
 * `web-manifest.ts`, `pwa-plugin.ts`) — consolidated here so all three can never drift apart. */
export const DEFAULT_ICON_SIZES = [192, 512]

/** Where `pwaPlugin` writes the generated service worker, relative to the client build's own
 * output directory — `registerPwa` (runtime) serves it at the site root (`/sw.js`), the standard
 * convention for maximum service-worker scope. Lives here, not in `pwa-plugin.ts` itself, for the
 * same reason `iconFileName`/`DEFAULT_ICON_SIZES` do — this module's own doc explains why. */
export const SW_FILE_NAME = 'sw.js'
