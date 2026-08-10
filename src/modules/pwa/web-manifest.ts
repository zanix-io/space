import type { PwaConfig } from 'typings/pwa.ts'
import { DEFAULT_ICON_SIZES, iconFileName } from './icon-naming.ts'

/** The route `registerPwa` serves the Web App Manifest at — a fixed, standard path, never
 * configurable, so `<link rel="manifest">` never needs to be threaded through per-app config. */
export const MANIFEST_ROUTE = '/manifest.webmanifest'
/** Where `registerPwa` serves each generated icon, by size. */
export function iconRoute(size: number): string {
  return `/icons/${iconFileName(size)}`
}
/** The route `registerPwa` serves the generated service worker at — a fixed root-level path
 * (never configurable), the standard convention for maximum service-worker scope. */
export const SW_ROUTE = '/sw.js'

/**
 * Builds the Web App Manifest JSON body from `config` — a pure function, no I/O. Icon entries
 * reference {@linkcode iconRoute}'s own paths, matching exactly what `registerPwa` serves at
 * those same routes — the two can never drift apart since both read from the same `iconSizes`.
 */
export function buildWebManifest(config: PwaConfig): Record<string, unknown> {
  const sizes = config.iconSizes ?? DEFAULT_ICON_SIZES

  // Snake_case keys are the real Web App Manifest JSON schema browsers read — not a naming lapse,
  // quoted so `deno lint`'s camelcase rule (correctly) doesn't try to enforce JS convention on it.
  const manifest: Record<string, unknown> = {
    name: config.name,
    'short_name': config.shortName ?? config.name,
    'start_url': '/',
    display: 'standalone',
    icons: sizes.map((size) => ({
      src: iconRoute(size),
      sizes: `${size}x${size}`,
      type: 'image/png',
    })),
  }

  if (config.themeColor) manifest['theme_color'] = config.themeColor
  if (config.backgroundColor) manifest['background_color'] = config.backgroundColor
  if (config.shortcuts?.length) {
    manifest.shortcuts = config.shortcuts.map((shortcut) => ({
      name: shortcut.name,
      url: shortcut.url,
      ...(shortcut.icon ? { icons: [{ src: shortcut.icon, sizes: 'any' }] } : {}),
    }))
  }

  return manifest
}
