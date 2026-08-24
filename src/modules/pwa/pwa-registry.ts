import type { PwaConfig } from 'typings/pwa.ts'
import type { DocumentPwa } from '../render/document-model.ts'
import { MANIFEST_ROUTE, SW_ROUTE } from './web-manifest.ts'

let pwaConfig: PwaConfig | undefined
let pwaBuildOutputDir: string | undefined

/** Set once by `defineSpaceApp({ pwa })` — never called directly except from there or a test. */
export function setPwaConfig(config: PwaConfig | undefined): void {
  pwaConfig = config
}

/** Read by `SpacePageController`/`createNotFoundHandler` on every full-document response, to
 * decide whether to inject `<link rel="manifest">`/theme-color `<meta>` at all. */
export function getPwaConfig(): PwaConfig | undefined {
  return pwaConfig
}

/**
 * Tells the runtime WHERE `pwaPlugin` actually wrote the generated icons/service worker — the
 * client build's own output directory (whatever `zanix space build`'s `--out-dir` used). Icon/
 * service-worker paths under it are always the same deterministic, unhashed convention
 * `pwaPlugin` itself writes to (`icon-naming.ts`'s `iconFileName`, `pwa-plugin.ts`'s
 * `SW_FILE_NAME`) — genuinely never a source-to-hashed-URL mapping the way `loadCometManifest`/
 * `loadCssManifest` need (a service worker specifically NEEDS a stable, unhashed URL to check for
 * its own updates; icons follow the same convention for consistency) — so unlike those two, this
 * only ever needs to remember a single directory, never parse a JSON manifest file.
 *
 * Call this — alongside `loadCometManifest`/`loadCssManifest` — in this app's own `main.ts`,
 * BEFORE `activateApps()`/`Zanix.start()`: `registerPwa` (called synchronously from `setup()`,
 * itself called synchronously during app activation) reads {@linkcode getPwaBuildOutput} ONCE, at
 * route-registration time, to resolve real, static file paths — not per-request — so this must
 * already be set by the time activation runs. A missing call (dev, or prod before the first real
 * build) is not an error: `registerPwa` simply skips icon/service-worker route registration, and
 * `resolvePwaHead` below omits the service-worker `<link>` — `/manifest.webmanifest` alone still
 * works either way, since it needs no built file at all.
 *
 * @param dir - The client build's own output directory (e.g. `'./dist/client'`).
 */
export function loadPwaBuildOutput(dir: string): void {
  pwaBuildOutputDir = dir
}

/** The directory {@linkcode loadPwaBuildOutput} was last called with, or `undefined` if it never
 * was — see that function's own doc for the full reasoning. */
export function getPwaBuildOutput(): string | undefined {
  return pwaBuildOutputDir
}

/** Test-only escape hatch — sets (or clears, via `undefined`) the build output directly, without
 * implying a real build ran. Same convention as `comet-manifest.ts`'s own `setCometManifest`. Not
 * exported from this package's public entry points. */
export function setPwaBuildOutput(dir: string | undefined): void {
  pwaBuildOutputDir = dir
}

/** Derives this app's own {@linkcode DocumentPwa} contribution from whatever's currently
 * registered — `undefined` when no PWA is configured, so a full-document response just omits the
 * head elements entirely rather than rendering an empty/meaningless manifest link.
 *
 * Typed against `render/document-model.ts`'s own renderer-agnostic shape, deliberately, rather than
 * against either renderer's serializer options: PWA is an orthogonal capability of the document, not
 * a feature of React's or Preact's rendering, so neither render path needs to depend on a type
 * owned by the other renderer. */
export function resolvePwaHead(): DocumentPwa | undefined {
  if (!pwaConfig) return undefined
  return {
    manifestHref: MANIFEST_ROUTE,
    themeColor: pwaConfig.themeColor,
    serviceWorkerHref: pwaBuildOutputDir ? SW_ROUTE : undefined,
  }
}
