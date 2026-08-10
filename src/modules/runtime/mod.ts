/**
 * Runtime module — the entry point for declaring a `@zanix/space` app's manifest.
 *
 * @module
 */
export { defineSpaceApp } from './define-space-app.ts'
// Re-exported because `defineSpaceApp` returns it directly — see manifest.ts's own doc for why
// referenced public types must themselves be public.
export type { ZanixAppDefinition } from '@zanix/app'
export { ZANIX_APP_DEFINITION_BRAND } from '@zanix/app'
