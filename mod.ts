/**
 * `@zanix/space` — Deno-native, renderer-agnostic SSR frontend framework for the Zanix ecosystem.
 *
 * This entry point (`.`) is the framework itself: app manifest authoring
 * ({@linkcode defineSpaceApp}), file-based page routing ({@linkcode loadRoutes},
 * {@linkcode SpacePageController}, {@linkcode Page}), selective hydration
 * ({@linkcode defineComet}), the document/head model, SEO, PWA, i18n, middleware, assets and
 * build-time validation. **It contains no renderer implementation and no code path that can load
 * one** — importing it never evaluates `react`, `react-dom/server` or `preact`.
 *
 * An app installs exactly one renderer, once, from its own main module, matching its
 * `defineSpaceApp({ renderer })`:
 *
 * - `import '@zanix/space/react'` — React 19: streaming SSR, `Suspense`/`loading.tsx`,
 *   `renderToResponse`, `useRequestCache`.
 * - `import '@zanix/space/preact'` — Preact core: synchronous SSR, no `Suspense` (see that entry
 *   point's own doc for the two capabilities that are absent by contract).
 *
 * `defineSpaceApp({ renderer })` stays the single source of truth for which renderer a project
 * uses; the entry point supplies the implementation and is checked against that declaration.
 *
 * Client (browser) code imports from `@zanix/space/client` or `@zanix/space/client/preact` instead,
 * never from here.
 *
 * @module
 */
export { defineSpaceApp, ZANIX_APP_DEFINITION_BRAND } from 'modules/runtime/mod.ts'
export type { ZanixAppDefinition } from 'modules/runtime/mod.ts'
export { defineBootstrapSpaceAppConfig, getBootstrapSpaceAppConfig } from 'modules/runtime/mod.ts'
export type { BootstrapRemoteAppOptions } from 'modules/runtime/mod.ts'
export type {
  AppSetupContext,
  ConfigAccessor,
  RuntimeContext,
  SpaceAppConfig,
} from 'typings/manifest.ts'
export type { PwaConfig, PwaShortcut } from 'typings/pwa.ts'
// Re-exported (type-only — zero runtime cost, confirmed via `deno info --json --min-dep-age=0`:
// this entry point resolves no npm package through this) because `SpaceAppConfig.assetsApi`
// references `AssetsControllerOptions`, and `AssetsControllerOptions.service` references
// `AssetService` — same "every type reachable from a public export must itself be public" doc-lint
// rule this file's own `AppSetupContext`/`ConfigAccessor`/`RuntimeContext` re-export above already
// exists for. Sourced from each type's own narrow `-types.ts` sibling (not the real controller/
// service implementation file, which value-imports `@zanix/server` decorators and `sharp`) so this
// entry point's own reachable graph never touches them.
export type { AssetsControllerOptions } from 'modules/assets-api/controllers/assets-controller-types.ts'
export type { AssetService, CreateAssetCommand } from 'modules/assets-api/asset-service-types.ts'
// Same "every type reachable from a public export must itself be public" rule, for
// `SpaceAppConfig.logApi` — sourced from the narrow `log-controller-types.ts` sibling, never the
// real controller file (which value-imports `@zanix/server` decorators, `@zanix/logger`, and
// `./rtos/log.rto.ts`), so this entry point's own reachable graph never touches them. `defineComet`
// (this same barrel) is what every Comet imports, so `.` is unavoidably part of every client
// bundle's own graph — the real controller file has no business being part of it too.
export type {
  LogApiControllerOptions,
  LogApiRateLimitOptions,
} from 'modules/log-api/controllers/log-controller-types.ts'
// Same "every type reachable from a public export must itself be public" rule, for
// `SpaceAppConfig.optimize`/`SpaceAppConfig.media` below — sourced from each plugin's own narrow
// `-types.ts` sibling (not the real plugin file, which value-imports `sharp`/`vite`) so this entry
// point's own reachable graph never touches them (verified via `deno info --json --min-dep-age=0`).
export type { AssetsOptimizeOptions } from 'modules/bundler/assets-plugin-types.ts'
export type { MediaOptimizeOptions } from 'modules/bundler/media-plugin-types.ts'
export type {
  AssetKind,
  AssetRecord,
  AssetStatus,
  AssetTransformRequest,
  AssetVariant,
  AssetVariantBase,
  AudioAssetVariant,
  ImageAssetVariant,
  ThumbnailAssetVariant,
  VideoAssetVariant,
} from 'modules/assets-api/typings.ts'
export type { UploadedAsset } from 'modules/assets-api/upload.ts'
export type {
  VoiceAudioFormat,
  VoiceAudioTransformOptions,
} from 'modules/media/audio/policies/voice.ts'
export type { VideoBreakpointName } from 'modules/media/video-breakpoints.ts'

export {
  addGlobalCssPaths,
  getCssManifest,
  getGlobalCssPaths,
  loadCssManifest,
  resolveCssHrefs,
  setGlobalCssPaths,
} from 'modules/render/mod.ts'
export type { CssManifest, StylesheetRef } from 'modules/render/mod.ts'
export {
  getClientEntry,
  loadClientEntryManifest,
  resolveClientEntrySpecifier,
  resolveClientEntryUrl,
  setClientEntry,
} from 'modules/render/mod.ts'

export {
  formatDiagnostic,
  formatDiagnostics,
  getRule,
  getValidationConfig,
  hasBlockingDiagnostics,
  isNormative,
  mergeValidationConfig,
  resolveSeverity,
  resolveValidationFlags,
  RULES,
  setValidationConfig,
  sortDiagnostics,
  summarize,
  UNAUTOMATABLE,
  validateDocuments,
  validateRenderedDocument,
  validateRenderedDocuments,
} from 'modules/validation/mod.ts'
export type {
  Diagnostic,
  DiagnosticCategory,
  DiagnosticPhase,
  DiagnosticSeverity,
  DocumentSemantics,
  FormatOptions,
  RenderedPageInput,
  ResolvedHead,
  ResolvedValidationFlags,
  RuleBasis,
  RuleDefinition,
  SeverityResolution,
  StaticAppInput,
  StaticPageInput,
  ValidationConfig,
  ValidationFlags,
  ValidationPhases,
} from 'modules/validation/mod.ts'

export {
  createNotFoundHandler,
  getActionFieldError,
  getActionFieldValue,
  getActiveRenderer,
  getDefaultPageHeaders,
  getRoutesDir,
  globalErrorHandler,
  loadRoutes,
  Page,
  scanPageFiles,
  setDefaultPageHeaders,
  SpacePageController,
  ZanixSsrController,
} from 'modules/router/mod.ts'
export type { RendererKind } from 'modules/router/mod.ts'
export type {
  BaseContext,
  ClassConstructor,
  ComposableErrorHandler,
  DiscoveredPage,
  GenericPayload,
  HandlerContext,
  HeadDescriptor,
  HeadLinkTag,
  HeadMetaTag,
  ImportedModule,
  LoadRoutesOptions,
  OnErrorHandler,
  PageHeaderOptions,
  PageOptions,
  PageSegmentFiles,
  Session,
  SessionTypes,
  SpacePageExtensions,
  TargetBaseClass,
  ZanixClassDecorator,
  ZanixInteractorClass,
  ZanixInteractorGeneric,
} from 'modules/router/mod.ts'
/** Re-exported because `PageOptions.action` (above) references it — see `@zanix/server`'s own
 * `mod.ts` for the same reasoning applied to its own RTO-based validation options. */
export type { RtoTypes } from '@zanix/types'
export type {
  ErrorBoundaryProps,
  LayoutProps,
  NotFoundProps,
  PageActionContext,
  PageContext,
  PageFieldErrors,
  RedirectConfig,
} from 'typings/page.ts'
// The renderer-neutral vocabulary `LayoutProps`/`SpacePageController` are now written in — public
// because both of those types name them as their own defaults, and because an app can name them
// directly (e.g. a shared `props.children` type in its own component library). See
// `typings/renderable.ts`'s own module doc.
export type { SpaceChildren, SpaceComponent, SpaceElement } from 'typings/renderable.ts'

// `defineComet`/`loadCometManifest`/`resolveCometModuleUrl` are deliberately NOT re-exported here
// — see `./comet`'s own export block in `deno.jsonc` and `modules/comets/mod.ts`'s own module doc.
// This barrel is what a real browser's own dependency graph reaches when pre-bundling `.` for a
// Comet's `import { defineComet } from '@zanix/space'` (the OLD import path) — and `.` ALSO
// exports genuinely server/dev-only code elsewhere in this same file (`defineSpaceApp`,
// `SpaceDevSocket` — the latter using real TC39 decorators Vite's normal transform can't parse at
// all). A bundler resolving `.` as a whole has no way to know a Comet only ever needed
// `defineComet`'s own narrow slice — confirmed empirically as a real, hard build failure, not a
// theoretical one. Type-only exports stay here regardless (erased at build time, zero resolution
// cost either way) — only the three FUNCTIONS moved.
export type {
  CometBoundaryComponent,
  CometComponent,
  CometManifest,
  CometProps,
  CometStrategy,
} from 'modules/comets/mod.ts'

export {
  buildWebManifest,
  getPwaBuildOutput,
  getPwaConfig,
  iconRoute,
  loadPwaBuildOutput,
  MANIFEST_ROUTE,
  registerPwa,
  setPwaConfig,
  SW_ROUTE,
} from 'modules/pwa/mod.ts'

export {
  CSP_NONCE_LOCALS_KEY,
  cspGuard,
  CSRF_TOKEN_LOCALS_KEY,
  csrfGuard,
  defineMiddleware,
  definePreHandler,
  getUserPreHandler,
  langGuard,
  langPreHandler,
  POPULATION_LOCALS_KEY,
  populationGuard,
  securityHeadersGuard,
} from 'modules/middleware/mod.ts'
export type {
  CspDirectives,
  CspDirectiveValue,
  CsrfGuardOptions,
  GuardContext,
  GuardResponse,
  LangGuardOptions,
  LangPreHandlerOptions,
  MiddlewareGuard,
  PopulationGuardOptions,
  PreHandler,
  SecurityHeadersOptions,
} from 'modules/middleware/mod.ts'

// Sourced from `modules/dev/socket-exports.ts`, not `modules/dev/mod.ts`'s own full barrel — that
// barrel also co-locates `spacePlugin` (`@vitejs/plugin-react`/`@preact/preset-vite`, both
// renderers' Fast Refresh tooling, regardless of which one an app installs), which this entry point
// must never resolve merely by re-exporting `SpaceDevSocket`.
export {
  broadcastSsrModuleChanged,
  SPACE_DEV_SOCKET_ROUTE,
  SpaceDevSocket,
  ZanixWebSocket,
} from 'modules/dev/socket-exports.ts'
export type { SocketPrototype } from 'modules/dev/socket-exports.ts'
// `broadcastSsrModuleChanged`'s own parameter type — same "every type reachable from a public
// export must itself be public" rule as `AssetsOptimizeOptions`/`MediaOptimizeOptions` above.
export type { SsrModuleChangedEvent } from 'modules/dev/socket-exports.ts'

export { loadMessages } from 'modules/i18n/load-messages.ts'
export type {
  CompiledMessageNode,
  LoadMessagesOptions,
  Messages,
} from 'modules/i18n/load-messages.ts'
// Read-back of `defineSpaceApp({ messagesDir })`'s own eager `setup()` write — same
// `getGlobalCssPaths`/`getPwaConfig` precedent, so `zanix space build`/`dev` can locate the
// configured directory without this package knowing anything about what a build step does with
// it (compiling ICU, or not, is entirely `@zanix/cli`'s own concern — see that package's own
// `compile-messages.ts`).
export { DEFAULT_IMPLICIT_LANG, getMessagesDir } from 'modules/i18n/messages-registry.ts'

export {
  buildCanonicalLink,
  buildHreflangLinks,
  buildRobotsTxt,
  buildSitemapXml,
  getSitemapDeclaration,
  getSitemapManifest,
  loadSitemapManifest,
  registerRobots,
  registerSitemap,
  setSitemapDeclaration,
} from 'modules/seo/mod.ts'
export type {
  BuildCanonicalLinkOptions,
  BuildHreflangLinksOptions,
  RobotsConfig,
  RobotsRule,
  SitemapAlternate,
  SitemapDeclaration,
  SitemapEntry,
  SitemapSource,
  SpaceRobotsConfig,
} from 'modules/seo/mod.ts'

export { getThemeResolver, setThemeResolver } from 'modules/theme/mod.ts'
export type { ThemeResolveContext, ThemeResolver } from 'modules/theme/mod.ts'

export {
  /** Tells the runtime WHERE `assetsPlugin` wrote the hashed asset files — the client build's own
   * output directory. Call this, alongside `loadAssetsManifest`, before serving any requests. */
  loadAssetsBuildOutput,
  /** Loads the manifest `assetsPlugin` writes during a production client build, correlating each
   * asset's stable path to its real, content-hashed build URL. Call this once, before serving any
   * requests; a missing file is not an error (dev, or no `assetsDir` declared). */
  loadAssetsManifest,
  /** Resolves an asset's stable path (`'logo.svg'`) to its real, content-hashed build URL
   * (`/assets/logo-a1b2c3.svg`) when a manifest was loaded — falls back to the stable, unhashed
   * path otherwise; never throws. */
  resolveAssetHref,
} from 'modules/assets/assets-manifest.ts'

export {
  /** Builds the real provider embed URL (YouTube/Vimeo `iframe src`) for a `'provider'`
   * `DetectedVideoSource`, applying `autoplay`/`muted`/`loop`/`controls` as that provider's own
   * query parameters. */
  buildProviderEmbedUrl,
  /** Classifies a `src` string into a `DetectedVideoSource` — YouTube/Vimeo with id extraction, a
   * generic-URL fallback for any other embeddable host, or a file-extension fallback for a
   * local/CDN video file. Pure, synchronous, never throws. */
  detectVideoSource,
} from 'modules/assets/video-source.ts'
export type {
  /** The result of classifying a `src` string — a discriminated union on `type`: `'provider'`
   * (YouTube/Vimeo, id extracted), `'iframe'` (any other embeddable URL), `'file'` (a recognized
   * video container), or `'unknown'`. */
  DetectedVideoSource,
  /** A video provider `@zanix/space` gives first-class embed support to: `'youtube'` or
   * `'vimeo'`. */
  VideoProvider,
  /** `buildProviderEmbedUrl` options for a Vimeo provider source. */
  VimeoEmbedOptions,
  /** `buildProviderEmbedUrl` options for a YouTube provider source. */
  YoutubeEmbedOptions,
} from 'modules/assets/video-source.ts'
