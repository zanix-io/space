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
export type {
  AppSetupContext,
  ConfigAccessor,
  RuntimeContext,
  SpaceAppConfig,
} from 'typings/manifest.ts'
export type { PwaConfig, PwaShortcut } from 'typings/pwa.ts'

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
  FormatOptions,
  RenderedPageInput,
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
  getActiveRenderer,
  getDefaultPageHeaders,
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
export type {
  ErrorBoundaryProps,
  LayoutProps,
  PageActionContext,
  PageContext,
  RedirectConfig,
} from 'typings/page.ts'
// The renderer-neutral vocabulary `LayoutProps`/`SpacePageController` are now written in — public
// because both of those types name them as their own defaults, and because an app can name them
// directly (e.g. a shared `props.children` type in its own component library). See
// `typings/renderable.ts`'s own module doc.
export type { SpaceChildren, SpaceComponent, SpaceElement } from 'typings/renderable.ts'

export { defineComet, loadCometManifest, resolveCometModuleUrl } from 'modules/comets/mod.ts'
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

export {
  broadcastSsrModuleChanged,
  SPACE_DEV_SOCKET_ROUTE,
  SpaceDevSocket,
  ZanixWebSocket,
} from 'modules/dev/mod.ts'
export type { SocketPrototype } from 'modules/dev/mod.ts'

export { loadMessages } from 'modules/i18n/load-messages.ts'
export type { LoadMessagesOptions, Messages } from 'modules/i18n/load-messages.ts'
// Read-back of `defineSpaceApp({ messagesDir })`'s own eager `setup()` write — same
// `getGlobalCssPaths`/`getPwaConfig` precedent, so `zanix space build`/`dev` can locate the
// configured directory without this package knowing anything about what a build step does with
// it (compiling ICU, or not, is entirely `@zanix/cli`'s own concern — see that package's own
// `compile-messages.ts`).
export { getMessagesDir } from 'modules/i18n/messages-registry.ts'

export {
  buildCanonicalLink,
  buildHreflangLinks,
  buildRobotsTxt,
  buildSitemapXml,
  registerRobots,
  registerSitemap,
} from 'modules/seo/mod.ts'
export type {
  BuildCanonicalLinkOptions,
  BuildHreflangLinksOptions,
  RobotsConfig,
  RobotsRule,
  SitemapAlternate,
  SitemapEntry,
  SitemapSource,
  SpaceRobotsConfig,
} from 'modules/seo/mod.ts'

export { getThemeResolver, setThemeResolver } from 'modules/theme/mod.ts'
export type { ThemeResolveContext, ThemeResolver } from 'modules/theme/mod.ts'

export {
  loadAssetsBuildOutput,
  loadAssetsManifest,
  resolveAssetHref,
} from 'modules/assets/assets-manifest.ts'
