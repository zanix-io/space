/**
 * Manifest types for a `@zanix/space` frontend app — `SpaceAppConfig` is the surface an author
 * writes when calling `defineSpaceApp()`. It is intentionally scoped to what's implemented so far:
 * app identity, `@zanix/app` pass-through fields, routing/headers/CSS/PWA/`messagesDir` fields, and
 * the request-render lifecycle hook. Fields for features not built yet are added when those are
 * implemented — never stubbed ahead of time with a placeholder type, since that would advertise API
 * surface nothing implements yet. Population/language IDENTIFICATION isn't a manifest field at all
 * — `populationGuard`/`langPreHandler`/`langGuard` (`modules/middleware`) are opted into per-page or
 * via `defineMiddleware()`, not declared here.
 *
 * Tailwind/CSS-Modules/vanilla-extract *processing* is still a build-time Vite concern
 * (`cssPlugin`, declared once wherever `vite.config.ts`-equivalent composition happens) — this
 * manifest only carries `globalCss`, which source files count as this app's own global
 * stylesheet(s), the one piece of CSS configuration that genuinely needs a runtime-visible
 * declaration (see `SpaceAppConfig.globalCss`'s own doc for the full reasoning).
 *
 * @module
 */
import type { AppSetupContext, ConfigAccessor, RuntimeContext } from '@zanix/app/runtime'
import type { PageHeaderOptions } from 'modules/router/space-page-controller.ts'
import type { SitemapSource } from 'modules/seo/sitemap.ts'
import type { SpaceRobotsConfig } from 'modules/seo/robots.ts'
import type { ThemeResolver } from 'modules/theme/theme-registry.ts'
import type { StylesheetRef } from 'modules/render/css-manifest.ts'
import type { PwaConfig } from './pwa.ts'
import type { ValidationConfig } from 'modules/validation/engine.ts'
import type { AssetsOptimizeOptions } from 'modules/bundler/assets-plugin-types.ts'
import type { MediaOptimizeOptions } from 'modules/bundler/media-plugin-types.ts'
import type { AssetsControllerOptions } from 'modules/assets-api/controllers/assets-controller-types.ts'
import type { LogApiControllerOptions } from 'modules/log-api/controllers/log-controller-types.ts'

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
  /** Root directory (or directories) `loadRoutes()` scans for `page.tsx` files, resolved
   * automatically as part of this app's own `setup(ctx)` — an author never calls `loadRoutes()` by
   * hand. Defaults to `'./routes'`; a directory that doesn't exist yet is treated as zero pages, not
   * an error, so a brand new app with no `routes/` folder still starts.
   *
   * An array (mirroring `@zanix/core`'s own `rootDir: string[]`) lets a HOST compose a base app's
   * pages with its own override directory without forking either tree — e.g.
   * `['./overrides', './node_modules/@acme/shop-app/routes']` overrides only the pages it declares,
   * falling back to the base app's own for everything else. Two distinct resolution rules apply, in
   * this order of `routesDir`:
   * - **Pages**: first-match-wins by route path — a page found in an earlier directory shadows the
   *   same route in a later one entirely; the later directory's own version is never even imported.
   * - **`layout.tsx`/`not-found.tsx` directly at a directory's root**: whole-app singletons, resolved
   *   ONCE — the first directory that declares either file wins, app-wide, regardless of which
   *   directory ends up serving any given page.
   *
   * A page's own nested `layout.tsx`/`error.tsx`/`loading.tsx` chain (its ancestors, not the app
   * root) is always resolved entirely within the SAME directory that provided that page — never
   * completed by reaching into a different `routesDir` entry for a missing ancestor. This is
   * deliberate: assembling a page from one directory's file and a layout from another's would
   * produce a "Frankenstein page" whose pieces were never designed to compose together. */
  routesDir?: string | string[]
  /**
   * Root directory (or directories) of static assets (images, fonts) this app serves at
   * `/assets/<relative-path>` — e.g. `assetsDir: './assets'` with a file at
   * `./assets/logo.svg` serves it at `/assets/logo.svg`. Resolved once, automatically, as part of
   * this app's own `setup(ctx)` (same timing as `routesDir`) — an author never scans or registers
   * this by hand.
   *
   * **Omitted entirely by default — no directory is scanned, no route is registered, at zero
   * cost.** Unlike `routesDir` (every Space app has pages, so it defaults to `'./routes'`), not
   * every app has extra static assets beyond what Comets/`globalCss` already cover — declaring
   * `assetsDir` is an explicit opt-in, so an app that never declares it never changes behavior.
   *
   * An array (mirroring `routesDir`'s own precedent) lets a HOST compose a base app's own assets
   * with its own override directory without forking either tree — e.g.
   * `['./assets-override', './node_modules/@acme/shop-app/assets']` overrides only the files it
   * declares, falling back to the base app's own for everything else. Resolution is first-match-wins
   * by relative path, evaluated independently per file — identical in spirit to `routesDir`'s own
   * page resolution, simpler in practice since an asset is a single, self-contained file with no
   * ancestor chain to keep from crossing directories.
   *
   * **An asset is only overridable if it's referenced by this stable public path** (a string, e.g.
   * `/assets/logo.svg`, or a future `resolveAssetHref('logo.svg')`) — never via a bare
   * `import logo from './logo.svg'` inside a component, which resolves through Vite's own module
   * graph, entirely independent of `assetsDir`'s own resolution. Deliberately out of scope: making a
   * module-imported asset host-overridable would require Vite-level module aliasing, a different,
   * bigger mechanism not built here.
   *
   * Also deliberately out of scope: PWA icons/favicon, which stay under `pwaPlugin`/`registerPwa` —
   * a separate, already-working pipeline for site identity, not general component-referenced
   * content.
   *
   * Served via a single route (`@zanix/server`'s own trailing catch-all, `Get('/assets/:path*')`)
   * over the already-resolved `Map` — never by concatenating the request's own path against the
   * filesystem directly, so a path that was never actually resolved (including any attempted
   * traversal) simply isn't a key in that `Map` and 404s like any other unmatched route. The exact
   * same resolution/serving code runs in both `znx space dev` and production — no separate
   * build-time-only path to keep in sync. The catch-all preserves the request's own casing (see
   * `@zanix/server`'s own CHANGELOG), so `/assets/Logo.svg` and `/assets/logo.svg` resolve to
   * different `Map` entries if both genuinely exist on disk, exactly as a real filesystem would.
   */
  assetsDir?: string | string[]
  /**
   * Opt-in `assetsPlugin({ optimize })` policy for whatever `assetsDir` above resolves —
   * responsive breakpoints/alternate formats for raster images, `.svg` minification, and a
   * cross-build transform cache (`cacheDir`), exactly the same `AssetsOptimizeOptions` shape a
   * hand-written `vite.config.ts` calling `assetsPlugin` directly already accepts (see that
   * function's own doc for the full contract — this field changes nothing about WHAT it does,
   * only WHERE the decision to enable it is declared).
   *
   * **Omitted entirely by default — no optimization runs, `assetsPlugin`'s own pre-existing
   * hash-and-emit behavior stays completely unchanged**, same convention as `assetsDir` itself:
   * declaring `optimize` without also declaring `assetsDir` does nothing (there is nothing to
   * optimize), and `assetsPlugin` is never even added to the build's own plugin list unless
   * `assetsDir` resolves to something.
   *
   * Stored eagerly, same timing as `assetsDir` (see `defineSpaceApp`'s own doc) — `zanix space
   * build` reads it back via `getOptimizeConfig()` without needing `activateApps()` to have run,
   * the same real gap `assetsDir` itself already needed fixing for.
   *
   * A build script that calls `assetsPlugin` directly (never through `defineSpaceApp`/
   * `buildSpaceClient` at all) is entirely unaffected by this field — it keeps passing its own
   * `optimize` object straight to `assetsPlugin`, exactly as before.
   */
  optimize?: AssetsOptimizeOptions
  /**
   * Opt-in `mediaPlugin({ optimize })` policy for whatever `assetsDir` above resolves — video
   * breakpoint/format variants and thumbnail extraction, exactly the same `MediaOptimizeOptions`
   * shape a hand-written `vite.config.ts` calling `mediaPlugin` directly already accepts (see that
   * function's own doc for the full contract).
   *
   * A deliberate SIBLING to `optimize` above, never folded into it — `assetsPlugin`/`mediaPlugin`
   * are two independent plugins sharing one manifest (see `AssetManifestRegistry`'s own doc), so
   * their own config surfaces stay independent too.
   *
   * **Omitted entirely by default — `mediaPlugin` never even runs, at zero cost** — same
   * convention `optimize`/`assetsDir` themselves already establish: declaring `media` without also
   * declaring `assetsDir` does nothing (there's nothing to scan), and a project with no video
   * assets at all pays nothing either way.
   *
   * Stored eagerly, same timing as `assetsDir`/`optimize` (see `defineSpaceApp`'s own doc) —
   * `zanix space build` reads it back via `getMediaConfig()` without needing `activateApps()` to
   * have run.
   *
   * A build script that calls `mediaPlugin` directly (never through `defineSpaceApp`/
   * `buildSpaceClient` at all) is entirely unaffected by this field — it keeps passing its own
   * `optimize` object straight to `mediaPlugin`, exactly as before.
   */
  media?: MediaOptimizeOptions
  /**
   * Root directory (or directories) of i18n message catalogs this app resolves via `loadMessages()`
   * — e.g. `messagesDir: './messages'` with `./messages/en/index.json` resolves `loadMessages({
   * lang: 'en' })`. Stored as-is, EAGERLY (same timing as `assetsDir`'s own path, NOT inside
   * `setup(ctx)` — so `zanix space build`, which never calls `activateApps()`, can still read it
   * back via `getMessagesDir()`); the actual per-`(lang, population)` file reads are LAZY, done by
   * `loadMessages()` on first access — unlike `assetsDir`, which eagerly scans into a `Map` upfront
   * (worth doing there because it must serve arbitrary request paths; a message catalog has a
   * small, bounded key space instead).
   *
   * **Omitted entirely by default — no directory is read, at zero cost**, same reasoning as
   * `assetsDir`: not every app needs i18n content.
   *
   * An array (mirroring `routesDir`/`assetsDir`'s own precedent) lets a HOST compose a base app's
   * own catalogs with its own override directory without forking either tree — first-match-wins,
   * resolved independently for the base file and the population-override file (so a base catalog
   * resolved from one directory and an override resolved from a different one is fine, same
   * independent-per-relative-path philosophy `assetsDir` already establishes).
   *
   * Convention: `{messagesDir}/{lang}/index.json` for the base catalog, and
   * `{messagesDir}/{lang}/populations/{population}.json` for a population override (only the keys
   * that differ from the base need to be present) — see `loadMessages()`'s own doc for the full
   * resolution/merge/caching contract.
   *
   * **Never overwritten by `zanix space build`.** Compiling this directory's ICU strings to AST
   * writes to `{clientBuildDir}/messages/...` instead (when `clientBuildDir` is also set) —
   * `messagesDir` itself stays the developer's own editable ICU source, in dev AND in a built
   * project's own working copy. See `loadMessages()`'s own doc for the exact production read path.
   */
  messagesDir?: string | string[]
  /**
   * This app's own global stylesheet source path(s) — e.g.
   * `['./styles/reset.css', './styles/app.css']`, resolved automatically, eagerly, as part of THIS
   * `defineSpaceApp()` call itself (same timing as `pwa`/`headers` — never deferred to `setup(ctx)`).
   * Order matters, same as `getCssManifest`'s own shape (later entries can override earlier ones via
   * normal CSS cascade) — preserved exactly through the build (`css-manifest.json`'s `global` entries
   * are written in this same declared order, never re-sorted).
   *
   * A plain `string` is the original, unchanged contract. An entry can also be
   * `{href, media}` (the same `StylesheetRef` shape `getCssManifest()`'s own `global`/`comets`
   * scopes use) to give that ONE stylesheet a `media` attribute — e.g.
   * `{href: './styles/mobile.css', media: '(max-width: 599px)'}` renders
   * `<link rel="stylesheet" href="..." media="(max-width: 599px)">`. `media` is opaque, author-
   * supplied data: Space never parses it, validates it, or ships any breakpoint presets/names —
   * an invalid media query is simply ignored by the browser, same as if hand-written in HTML.
   * Deliberately only affects render-blocking/applicability, never bytes transferred — the browser
   * still downloads a non-matching stylesheet, just without blocking first render on it.
   *
   * **Composes across apps, automatically — a HOST never needs to know a base app's own paths.**
   * Every `defineSpaceApp({ globalCss })` call APPENDS to a single, process-wide list (via
   * `addGlobalCssPaths`) rather than replacing it — so if a base app's own `defineSpaceApp()` call
   * executes first (e.g. its module is activated before a host's own customization app), and the
   * host's own `defineSpaceApp({ globalCss: ['./custom.css'] })` executes after, `getGlobalCssPaths()`
   * resolves to `['./base.css', './custom.css']` — the base app's own declaration preserved, the
   * host's own appended after it, letting normal cascade/specificity decide what actually overrides
   * what. Neither app references the other's file paths; composition is purely a function of WHEN
   * each `defineSpaceApp()` call runs, same "declaration order wins" principle `activateApps()`'s own
   * `onStart` sequencing already follows — never a separately-declared priority. An app that omits
   * `globalCss` entirely contributes nothing, leaving whatever another app already declared untouched.
   *
   * This is the **single declared source of truth** behind every full-document response's
   * `<link rel="stylesheet">` tags, for BOTH dev and production — never two independent
   * mechanisms:
   * - **In `znx space dev`**: each path resolves directly through `SpaceDevEngine`'s
   *   `transformClientAsset`, with zero build step — no manifest file, no hashing, involved at
   *   all.
   * - **In production**: `cssPlugin`'s own `css-manifest.json` is exactly these same files,
   *   translated to their real, hashed build-output URLs — never an independently "discovered"
   *   list. `buildSpaceClient({ globalCss })` (`modules/bundler/build-client.ts`) is what wires
   *   each path as a real `rollupOptions.input` entry; its own `globalCss` option DEFAULTS to
   *   `getGlobalCssPaths()` — the same already-composed (base + host) list this field populates —
   *   so a build script that imports the app's `space.app.ts` before calling `buildSpaceClient()`
   *   needs no separate `globalCss` declaration of its own. A build script that never imports
   *   `space.app.ts` (or wants to build against a different list on purpose) still can, by passing
   *   `globalCss` explicitly to `buildSpaceClient()`.
   *
   * Never used for a Comet's own CSS (`import './x.module.css'` inside a `.tsx` file) — that
   * case resolves on its own, transitively, through the Comet's own build chunk (production) or
   * Vite's client runtime (`/@vite/client`, dev) — see `cometPlugin`'s own doc. `globalCss` is
   * specifically for CSS a page's *initial* HTML needs before any component-level code runs.
   */
  globalCss?: StylesheetRef[]
  /**
   * Overrides this app's default, auto-generated client entry with a real source file of your
   * own — e.g. `'./src/main.client.ts'`. **Omitting this is the normal, recommended case**: every
   * app already gets `hydrateComets()`/`initOrbit()` wired automatically, with a correct CSP
   * `nonce`, with zero configuration — that pair IS the entire client-side setup a Comet-based app
   * ever needs (see `docs/comets.md`'s/`docs/orbit.md`'s own client-entry examples, unchanged).
   * Set this ONLY when a project genuinely needs extra client-side code of its own — analytics, a
   * global error handler, a service-worker registration not already covered by `pwa`. Your own
   * file is then fully responsible for calling `hydrateComets()`/`initOrbit()` itself, exactly like
   * today's documented example — this option REPLACES the auto-generated default, it doesn't
   * compose with it.
   *
   * Same dev/prod duality as `globalCss`, resolved through the identical mechanism:
   * - **In `znx space dev`**: resolves directly through `SpaceDevEngine`'s `transformClientAsset`
   *   (an override) or `clientEntryPlugin`'s own `load` hook (the auto-generated default) — no
   *   manifest file, no hashing, no build step involved either way.
   * - **In production**: `clientEntryPlugin`'s own `client-entry-manifest.json` is this same
   *   entry, translated to its real, hashed build-output URL. `buildSpaceClient()`
   *   (`modules/bundler/build-client.ts`) always includes a `rollupOptions.input` entry for
   *   whichever specifier `resolveClientEntrySpecifier()` (`modules/render/client-entry.ts`)
   *   resolves to — the default virtual entry, or this override once configured.
   *
   * Unlike `globalCss` (a genuinely composable list across multiple `defineSpaceApp()` calls),
   * this is a plain last-wins REPLACE — a host overriding a base app's own entry point discards
   * the base app's own choice entirely, since there is no real "run two client entries" use case.
   */
  clientEntry?: string
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
   * Runtime, per-request design-token personalization — `resolve(ctx)` receives this request's own
   * `population`/`lang`/`request` and returns a `Record<string, string>` of `--space-*` custom
   * property overrides (or `undefined`/`{}` for "no override, the static `globalCss` tokens apply
   * as-is") — injected as a nonced `<style>` block on every full-document response. App-wide only in
   * this first version — no per-page override. See `docs/theming.md` for the full static-token
   * convention this layers on top of, and `theme/theme-registry.ts`'s own doc for the exact
   * precedence (a guard-registered CSP always still applies to whatever this resolves — see
   * `PageOptions.headers`'s own doc — and a custom page/app CSP that replaces the framework's own
   * default must grant its own `style-src` + nonce for a resolved override to actually apply, same
   * disclosure the nonce-based `script-src` default already requires).
   *
   * @example
   * ```ts
   * defineSpaceApp({
   *   name: 'storefront',
   *   theme: {
   *     resolve: ({ population }) =>
   *       population === 'tenant-b' ? { '--space-color-primary': '#16a34a' } : undefined,
   *   },
   * })
   * ```
   */
  theme?: { resolve: ThemeResolver }

  /**
   * Opts this app into carrying `Date`, `Map` and `Set` across the server → client boundary.
   *
   * Space's data channel — `renderToResponse`'s own `initialState` and a Comet's own props — is
   * plain JSON (see `initial-state-global.ts` for the full contract). That contract documents
   * three values it cannot carry faithfully: a `Date` arrives as an ISO string, and a `Map` or
   * `Set` arrives as `{}` with every entry lost. Enabling this makes those three round-trip as
   * real instances.
   *
   * **App-wide, deliberately, and off by default.** A payload written by one half of an app and
   * read by the other has to agree on the format, which a per-page or per-Comet flag could not
   * guarantee. With it off, nothing changes at all: no envelope, no markers, not one extra byte,
   * and behaviour identical to before this option existed.
   *
   * Scoped to exactly those three types, and there is no extension point on purpose — a general
   * richer-than-JSON wire format is explicitly not something this package builds (see this
   * package's own architecture decision). `BigInt`, functions, class instances and circular
   * references behave exactly as the contract already documents, enabled or not.
   *
   * @example
   * ```ts
   * defineSpaceApp({ name: 'storefront', serialization: { extendedTypes: true } })
   * ```
   */
  serialization?: { extendedTypes?: boolean }
  /**
   * PWA support — the Web App Manifest, icon routes, and (once `loadPwaBuildOutput` has run) a
   * generated service worker, all registered as part of this app's own `setup(ctx)`, same timing as
   * `loadRoutes()`. Unlike CSS's build-only config, this genuinely drives runtime behavior (the
   * routes themselves, and the `<link rel="manifest">`/theme-color `<meta>`/service-worker
   * registration script every full-document response gets) — see `PwaConfig`'s own doc for why
   * that split isn't the same as CSS's. `false`/omit for no PWA at all.
   */
  pwa?: PwaConfig | false
  /**
   * The client build's own output directory (e.g. `'./.dist/client'`, matching `zanix space
   * build`'s own default `--out-dir`) — when set, this app's own `setup(ctx)` automatically loads
   * every production manifest a real build wrote there (`loadCometManifest`,
   * `loadClientEntryManifest`, `loadCssManifest`, `loadAssetsManifest`, `loadAssetsBuildOutput`,
   * `loadPwaBuildOutput`, `loadSitemapManifest` (this last one only ever matters for
   * `sitemap: 'auto'` above) — in that order, `loadPwaBuildOutput` before `loadSitemapManifest`
   * since `registerPwa` reads its own build output back immediately afterward, same timing
   * constraint that already applied when a `main.ts` called these by hand), so a production
   * `main.ts` no longer has to call any of them itself.
   *
   * **Omitted entirely by default — no file is read, at zero cost**, same convention as
   * `assetsDir`/`pwa`/`sitemap` above. Safe to set unconditionally in a `space.app.ts` a dev
   * server also imports: this whole block is skipped entirely under `znx space dev`
   * (`isDevClientEnabled()`) — NOT because a missing manifest file would be an error (each of the
   * seven already tolerates that fine), but because a STALE one on disk very much isn't harmless. A
   * real `zanix space build` and `znx space dev` commonly point at the same `clientBuildDir` on
   * the same machine, and an earlier build's real output already sitting there is the common case
   * during local development, not a rare one — loading it under dev would resolve every Comet to
   * that OLD build's own hashed chunk names instead of the current source Vite is actually
   * serving. Confirmed as a real failure, not hypothetical: a stale React-Compiler-transformed
   * chunk from a previous build, loaded into a fresh dev session's own React instance, threw
   * `Cannot read properties of null (reading 'useMemoCache')` on hydration.
   *
   * Still call any of the seven loaders yourself, directly, only for an unusual layout this option
   * doesn't fit — e.g. a build output split across more than one directory. Setting this AND
   * calling one of the seven loaders by hand for the same app double-loads that one manifest
   * harmlessly (the second call simply overwrites the first with the same file's own contents).
   */
  clientBuildDir?: string
  /**
   * `sitemap.xml`, registered as a real route (`GET /sitemap.xml`), not a build-time static file —
   * this stays SSR-native/edge-friendly, with no build step required. A plain array is resolved
   * once, at zero per-request cost; a function is invoked once and its result cached for the
   * process lifetime, so it always reflects whatever was live at the last process start (a product
   * catalog, a CMS) without repeating that work on every crawler hit — an app that needs
   * sub-restart freshness owns that itself, this package doesn't impose one. **Omitted entirely by
   * default — no route registered, at zero cost**, same convention as `assetsDir`/`messagesDir`.
   * See `buildSitemapXml`'s own doc (`modules/seo/sitemap.ts`) for the exact XML contract: proper
   * escaping, only standard tags in the `urlset`, and correct per-language cross-referencing.
   *
   * `'auto'` derives entries from this app's own static route tree instead of a hand-written
   * source: every discovered page whose route carries no dynamic segment, declares no
   * unconditional `redirect`, and whose resolved head carries no `noindex` — the same static
   * discovery `zanix space build`/`zanix space dev` already run for document validation, so no
   * per-page declaration is needed beyond what routing itself already captures. A route needing
   * entries this can't derive (a dynamic segment backed by a database, a custom priority/
   * `changefreq`) still uses an explicit array or function instead — `'auto'` only ever replaces
   * the "no sitemap at all" case, never composes with a hand-written one. One exception: a route
   * whose ONLY dynamic segment is `langPreHandler`'s own registered `:lang` param still qualifies
   * (when `langPreHandler` is registered), expanding into one entry per `availableLangs` instead of
   * being excluded. See `deriveAutoSitemapEntries`'s own doc (`modules/bundler/auto-sitemap.ts`) for
   * exactly which pages qualify.
   *
   * `zanix space build` writes derived `'auto'` entries to `{outDir}/sitemap-manifest.json` —
   * **production only reads that back when `clientBuildDir` (below) is also set**, since that's
   * the only place `setup()` calls `loadSitemapManifest` automatically. Without `clientBuildDir`,
   * call `loadSitemapManifest` yourself from `main.ts` (see that function's own doc,
   * `modules/seo/sitemap-manifest.ts`) — omitting both means `GET /sitemap.xml` never registers in
   * production at all, even though a real build already derived the entries.
   */
  sitemap?: SitemapSource | 'auto'
  /**
   * `robots.txt`, registered as a real route (`GET /robots.txt`). A raw `string` is served
   * byte-for-byte, no processing; a structured `{ rules, includeSitemap? }` config auto-appends a
   * `Sitemap:` line when `sitemap` (above) is also configured. **Omitted entirely by default — no
   * route registered, at zero cost.** See `buildRobotsTxt`'s own doc (`modules/seo/robots.ts`).
   */
  robots?: SpaceRobotsConfig
  /**
   * Activates the Asset API (`POST /assets/audio|image|video`, `GET /assets/:id[/status|/download]`)
   * — registered as a real `ZanixController` (`createAssetsController`, `modules/assets-api/`), as
   * part of this app's own `setup(ctx)`, same timing as `loadRoutes()`/`registerPwa()`. **Not the
   * same feature as `assetsDir`/`optimize`/`media` above** — those cover STATIC, build-time,
   * Vite-bundled files (images/fonts hashed and served from a directory this app ships with); this
   * is the DYNAMIC upload/transform/store API (`AssetService`), backed by whatever `AssetStorage`/
   * `AssetRepository` the caller composed — the two are unrelated features that happen to share the
   * word "asset."
   *
   * `service` is the one required field — an already-built `AssetService` (`createAssetService`,
   * `modules/assets-api/`), composed by the CALLER from real infrastructure. This package never
   * builds that infrastructure itself: `@zanix/space` has no dependency on `@zanix/datamaster` (or
   * any other storage/database package) anywhere in its own runtime, and this field doesn't change
   * that — it only activates HTTP routes over a service object handed to it already assembled. A
   * real composition (S3-backed storage, a Mongo-backed file registry, key rotation, ...) lives in
   * the consuming application's own bootstrap, wiring `@zanix/datamaster`'s `S3ObjectStorage`/
   * `MongoFileRepository` into `createAssetService({ storage, repository })` before ever reaching
   * this field. `prefix`/`guards` forward as-is to `createAssetsController` — see
   * `AssetsControllerOptions`'s own doc, in particular why every route denies-by-default until real
   * `guards` are passed.
   *
   * **Omitted entirely by default — no route registered, at zero cost**, same convention every
   * other opt-in feature in this manifest already follows.
   *
   * @example
   * ```ts
   * import { createAssetService } from '@zanix/space/assets-api'
   * // Composed elsewhere, from real infrastructure this package never imports:
   * // const storage = new S3ObjectStorage({ ... })          // @zanix/datamaster
   * // const repository = new MongoFileRepository(...)              // @zanix/datamaster (adapted)
   *
   * export default defineSpaceApp({
   *   name: 'storefront',
   *   assetsApi: {
   *     service: createAssetService({ storage, repository }),
   *     guards: { write: [authGuard], read: [authGuard] },
   *   },
   * })
   * ```
   */
  assetsApi?: AssetsControllerOptions
  /**
   * Extra configuration for the ALWAYS-ON Log API (`POST /api/log`, `modules/log-api/`) — unlike
   * `assetsApi` above, this isn't an opt-in feature (there's no "off" state; every `@zanix/space`
   * app registers this route, see `createLogApiController`'s own doc for why), so this field only
   * ever forwards `guards`/`rateLimit`, two DIFFERENT knobs over the same default guard:
   * - `guards` — extra guards appended AFTER the default `rateLimitGuard`, never replacing it. See
   *   `LogApiControllerOptions.guards`'s own doc for the full composition contract (deliberately
   *   additive-only, unlike `assetsApi.guards` above — it can only tighten, never loosen).
   * - `rateLimit` — overrides the default guard's own `anonymousLimit`/`windowSeconds`/
   *   `trustProxyHeader` outright. See `LogApiRateLimitOptions`'s own doc — this is the real
   *   "change the floor" surface for an app whose traffic profile or deployment topology (whether
   *   it genuinely sits behind a trusted reverse proxy) differs from the framework's own default.
   *
   * **Omitted entirely by default** — the route still registers with just its own default rate
   * limit, no extra guards.
   *
   * @example
   * ```ts
   * export default defineSpaceApp({
   *   name: 'storefront',
   *   logApi: {
   *     rateLimit: { anonymousLimit: 60 },
   *     guards: [myExtraAbuseCheckGuard],
   *   },
   * })
   * ```
   */
  logApi?: Pick<LogApiControllerOptions, 'guards' | 'rateLimit'>
  /** Escape hatch for registration that doesn't fit a declarative field yet — forwarded to
   * `defineZanixApp({ setup })`, run AFTER this app's routes have already loaded. */
  setup?: (ctx: AppSetupContext) => void | Promise<void>
  /**
   * Which renderer this app's pages/Comets are authored against. Defaults to `'react'` — the same
   * behavior as omitting this field entirely.
   *
   * `'preact'` selects Preact **core** (never `preact/compat`) for the whole app, at both the
   * runtime layer (this field) and the build layer (`spacePlugin({ renderer: 'preact' })`, set
   * separately in `vite.config.ts` — same two-places-by-design split `globalCss`'s own doc already
   * has for a build-vs-runtime concern). It is a deliberately smaller, specialized renderer, not a
   * drop-in replacement for `'react'` — a page using `loading.tsx` or `useRequestCache` fails
   * explicitly under it (at route-registration time for the former, at first call for the latter)
   * rather than silently degrading: Preact core has no `Suspense`/`use()` to back either capability.
   */
  renderer?: 'react' | 'preact'
  /**
   * What this app's own BUILT-IN error/not-found fallback (`DefaultErrorView`/`DefaultNotFoundView`)
   * renders when a route declares no `error.tsx`/`not-found.tsx` of its own. Defaults to `'view'` —
   * the same behavior as omitting this field entirely (a real, rendered HTML document, wrapped in
   * the app's root layout).
   *
   * `'json'` is for an app that never wants to serve a rendered HTML page at all — a pure API/
   * backend built on `@zanix/space` purely for its routing, with no document shell of its own. The
   * JSON body is `serializeError(error)` (`@zanix/errors`) for a data-phase (`loader`) failure, or
   * `serializeError(new HttpError('NOT_FOUND'))` for a 404 — the SAME redacted, structured shape
   * `logger.error(...)` and `@zanix/server`'s own HTTP error responses already use everywhere else
   * in this ecosystem.
   *
   * Never overrides an app's OWN `error.tsx`/`not-found.tsx` — declaring one is already an explicit
   * choice to render a real page, regardless of this flag; it only decides what happens when a
   * route declares none at all. Also never applies to a RENDER-phase failure with no `error.tsx`
   * anywhere in a page's own composition chain (`composeSegments`'s own `DefaultErrorView` fallback,
   * see that function's own doc): by the time that's reached, React's own response has typically
   * already started streaming as `text/html`, with no way to retroactively become JSON — keeping
   * that ONE fallback format-independent (always HTML, on both renderers) avoids a flag that would
   * silently work for Preact and not for React.
   */
  errorResponse?: 'view' | 'json'
  /**
   * Document validation policy for this project — which rules participate, at what severity, and
   * whether warnings block a build.
   *
   * Omitted runs the framework's own defaults. `false` disables document validation entirely, for a
   * project that has decided this is not for them.
   *
   * The three axes are independent by design and it is worth knowing which one to reach for:
   * `strict` is enforcement policy (no active warning stays a warning), `rules` handles activation
   * and per-rule severity, and `exempt` excludes routes that are not documents. See
   * `ValidationConfig`'s own doc for the exact precedence.
   *
   * @example
   * ```ts
   * export default defineSpaceApp({
   *   name: 'storefront',
   *   validation: {
   *     strict: true,                          // CI: no active warning stays a warning
   *     rules: { SEO002: true, A11Y007: 'info' }, // opt in, at catalog severity / explicitly
   *     exempt: ['preview/**'],
   *   },
   * })
   * ```
   */
  validation?: ValidationConfig | false
}
