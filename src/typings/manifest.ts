/**
 * Manifest types for a `@zanix/space` frontend app — `SpaceAppConfig` is the surface an author
 * writes when calling `defineSpaceApp()`. It is intentionally scoped to what's implemented so far:
 * app identity, `@zanix/app` pass-through fields, routing/headers/CSS/PWA fields, and the
 * request-render lifecycle hook. Fields for features not built yet (population/personalization,
 * i18n) are added when those are implemented — never stubbed ahead of time with a placeholder
 * type, since that would advertise API surface nothing implements yet.
 *
 * Tailwind/CSS-Modules/vanilla-extract *processing* is still a build-time Vite concern
 * (`cssPlugin`, declared once wherever `vite.config.ts`-equivalent composition happens) — this
 * manifest only carries `globalCss`, which source files count as this app's own global
 * stylesheet(s), the one piece of CSS configuration that genuinely needs a runtime-visible
 * declaration (see `SpaceAppConfig.globalCss`'s own doc for the full reasoning).
 *
 * @module
 */
import type { AppSetupContext, ConfigAccessor, RuntimeContext } from '@zanix/app'
import type { PageHeaderOptions } from 'modules/router/space-page-controller.tsx'
import type { PwaConfig } from './pwa.ts'

// Re-exported (not just imported) because `SpaceAppConfig.setup` below references
// `AppSetupContext`, which extends `RuntimeContext`, which in turn holds a `ConfigAccessor` —
// JSR's doc-lint requires every type reachable from a public export to itself be public,
// transitively. Referencing exactly these three (not the whole `AppDefinition`) is deliberate:
// indexing into `AppDefinition` (e.g. `AppDefinition['setup']`) pulls its *entire* interface into
// this package's public surface for doc-lint purposes, cascading into types `@zanix/space`
// doesn't use yet (`ConfigValueType`, `JobDefinitionEntry`, `AppStartContext`, ...) — reference
// only the types actually used, and this chain does terminate here (verified via `deno doc
// --lint`, not assumed).
export type { AppSetupContext, ConfigAccessor, RuntimeContext }

/**
 * Author-facing configuration for a `@zanix/space` app — the parameter to `defineSpaceApp()`.
 *
 * Only `name` is required. Everything else either has a sensible default or is optional because
 * the app doesn't need it. `name`/`version`/`dependencies` mirror `AppDefinition`'s own field
 * types (primitives and a small self-contained shape — safe to state directly without pulling in
 * `@zanix/app`'s full interface, see `setup` below for the one field where that isn't true).
 */
export interface SpaceAppConfig {
  /** App identity — forwarded as-is to `defineZanixApp({ name })`. Must match `^[a-z][a-z0-9-]*$`
   * (validated by `@zanix/app`'s own `normalize()`, not re-validated here). */
  name: string
  /** Forwarded as-is to `defineZanixApp({ version })` — stored only, no compatibility validation
   * yet (same limitation `@zanix/app` itself documents). */
  version?: string
  /** Forwarded as-is to `defineZanixApp({ dependencies })` — declares which resource slots this
   * app needs, never a concrete resource name (that's the host's `uses` binding). */
  dependencies?: Record<string, { type: string; required?: boolean }>
  /** Root directory `loadRoutes()` scans for `page.tsx` files, resolved automatically as part of
   * this app's own `setup(ctx)` — an author never calls `loadRoutes()` by hand. Defaults to
   * `'./routes'`; a directory that doesn't exist yet is treated as zero pages, not an error, so a
   * brand new app with no `routes/` folder still starts. */
  routesDir?: string
  /**
   * This app's own global stylesheet source path(s) — e.g.
   * `['./styles/reset.css', './styles/app.css']`, resolved automatically as part of this app's
   * own `setup(ctx)`, same timing as `pwa`. Order matters, same as `getCssManifest`'s own shape
   * (later entries can override earlier ones via normal CSS cascade).
   *
   * This is the **single declared source of truth** behind every full-document response's
   * `<link rel="stylesheet">` tags, for BOTH dev and production — never two independent
   * mechanisms:
   * - **In `znx space dev`**: each path resolves directly through `SpaceDevEngine`'s
   *   `transformClientAsset`, with zero build step — no manifest file, no hashing, involved at
   *   all.
   * - **In production**: `cssPlugin`'s own `css-manifest.json` is meant to be exactly these same
   *   files, translated to their real, hashed build-output URLs — never an independently
   *   "discovered" list. **Known, honest gap, not yet wired**: the real client build
   *   (`rollupOptions.input`) doesn't automatically include `globalCss`'s files as build inputs
   *   yet — until that's connected, a production build needs its own `vite.config.ts` to declare
   *   these same paths as real Rollup inputs for `cssPlugin`'s manifest to pick them up. Tracked
   *   as follow-up work, not silently assumed to already work end-to-end.
   *
   * Never used for a Comet's own CSS (`import './x.module.css'` inside a `.tsx` file) — that
   * case resolves on its own, transitively, through the Comet's own build chunk (production) or
   * Vite's client runtime (`/@vite/client`, dev) — see `cometPlugin`'s own doc. `globalCss` is
   * specifically for CSS a page's *initial* HTML needs before any component-level code runs.
   */
  globalCss?: string[]
  /**
   * App-wide default for every page's `headers` (CSP + security headers) — set once here instead
   * of repeating it on every page's own `Page({ headers })`/`static headers`. A specific page's own
   * value, if it ever sets one, still wins over this. `false` disables headers app-wide, for every
   * page that doesn't explicitly opt back in with its own `headers`. Omit to keep
   * `SpacePageController`'s own built-in default (nonce-based CSP + `securityHeadersGuard`'s own
   * defaults). Wired via `setDefaultPageHeaders` — call that directly instead if something needs to
   * set this outside of `defineSpaceApp` (e.g. before the manifest is even built).
   */
  headers?: PageHeaderOptions | false
  /**
   * PWA support — the Web App Manifest, icon routes, and (when `swPath` is set) a generated
   * service worker, all registered as part of this app's own `setup(ctx)`, same timing as
   * `loadRoutes()`. Unlike CSS's build-only config, this genuinely drives runtime behavior (the
   * routes themselves, and the `<link rel="manifest">`/theme-color `<meta>`/service-worker
   * registration script every full-document response gets) — see `PwaConfig`'s own doc for why
   * that split isn't the same as CSS's. `false`/omit for no PWA at all.
   */
  pwa?: PwaConfig | false
  /** Escape hatch for registration that doesn't fit a declarative field yet — forwarded to
   * `defineZanixApp({ setup })`, run AFTER this app's routes have already loaded. */
  setup?: (ctx: AppSetupContext) => void | Promise<void>
}
