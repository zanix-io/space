/**
 * `@zanix/space` — Deno-native, React 19 SSR frontend framework for the Zanix ecosystem.
 *
 * This entry point (`.`) is meant for server-side code: authoring an app's manifest
 * ({@linkcode defineSpaceApp}) and the streaming SSR core ({@linkcode renderToResponse},
 * {@linkcode useRequestCache}). It transitively imports `react-dom/server` — client (browser)
 * code must import from `@zanix/space/client` instead, never from here.
 *
 * Implemented so far: app manifest authoring, the streaming SSR core, file-based page routing
 * (path inference from file location, per-segment `layout`/`loading`/`error` composition, and
 * static `redirect`/`cacheControl` with automatic ETag), the server-side half of selective
 * hydration ("Comets" — {@linkcode defineComet}; the client-side counterpart, `hydrateComets`,
 * lives under `@zanix/space/client`), CSS integration (`@zanix/space/vite`'s `cssPlugin`, plus
 * {@linkcode getCssManifest}/{@linkcode loadCssManifest} here), and PWA support
 * ({@linkcode registerPwa}, wired through `defineSpaceApp({ pwa })`). Population/personalization
 * and i18n are not implemented yet — nothing below is a stub for them.
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
  getCssManifest,
  getGlobalCssPaths,
  loadCssManifest,
  renderToResponse,
  RequestCacheProvider,
  resolveCssHrefs,
  setGlobalCssPaths,
  useRequestCache,
} from 'modules/render/mod.ts'
export type { CssManifest, RenderToResponseOptions, RequestCache } from 'modules/render/mod.ts'

export {
  createNotFoundHandler,
  getDefaultPageHeaders,
  loadRoutes,
  Page,
  scanPageFiles,
  setDefaultPageHeaders,
  SpacePageController,
  ZanixSsrController,
} from 'modules/router/mod.ts'
export type {
  BaseContext,
  ClassConstructor,
  DiscoveredPage,
  GenericPayload,
  HandlerContext,
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

export { defineComet, loadCometManifest, resolveCometModuleUrl } from 'modules/comets/mod.ts'
export type { CometManifest, CometProps, CometStrategy } from 'modules/comets/mod.ts'

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
  securityHeadersGuard,
} from 'modules/middleware/mod.ts'
export type {
  CspDirectives,
  CspDirectiveValue,
  CsrfGuardOptions,
  GuardContext,
  GuardResponse,
  MiddlewareGuard,
  SecurityHeadersOptions,
} from 'modules/middleware/mod.ts'

export {
  broadcastSsrModuleChanged,
  SPACE_DEV_SOCKET_ROUTE,
  SpaceDevSocket,
  ZanixWebSocket,
} from 'modules/dev/mod.ts'
export type { SocketPrototype } from 'modules/dev/mod.ts'
