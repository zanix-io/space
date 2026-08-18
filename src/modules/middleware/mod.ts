/**
 * Middleware module — process-wide guards for every SSR page route, over `@zanix/server`'s own
 * guard pipeline (no new guard mechanism of its own). `langPreHandler` is the one export here that
 * isn't a guard — it runs BEFORE route matching, via `@zanix/server`'s own `preHandler` hook.
 * `langGuard` is its companion guard, for the one case `langPreHandler` can't cover on its own (see
 * that export's own doc).
 *
 * @module
 */
export { defineMiddleware } from './define-middleware.ts'
export { CSP_NONCE_LOCALS_KEY, cspGuard } from './csp-guard.ts'
export type { CspDirectives, CspDirectiveValue } from './csp-guard.ts'
export { securityHeadersGuard } from './security-headers-guard.ts'
export type { SecurityHeadersOptions } from './security-headers-guard.ts'
export { CSRF_TOKEN_LOCALS_KEY, csrfGuard } from './csrf-guard.ts'
export type { CsrfGuardOptions } from './csrf-guard.ts'
export { POPULATION_LOCALS_KEY, populationGuard } from './population-guard.ts'
export type { PopulationGuardOptions } from './population-guard.ts'
export { langPreHandler } from './lang-pre-handler.ts'
export type { LangPreHandlerOptions } from './lang-pre-handler.ts'
export { langGuard } from './lang-guard.ts'
export type { LangGuardOptions } from './lang-guard.ts'
export type { GuardContext, GuardResponse, MiddlewareGuard, PreHandler } from '@zanix/server'
