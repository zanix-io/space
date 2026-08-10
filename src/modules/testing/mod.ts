/**
 * Testing module — helpers for `unit`/`functional` tests of a `@zanix/space` page, following the
 * same `unit`/`functional`/`integration` convention already established across the Zanix ecosystem.
 * Import from `@zanix/space/testing`, never from the package's root entry point.
 *
 * @module
 */
export { mockPageContext } from './mock-page-context.ts'
export { mockHandlerContext } from './mock-handler-context.ts'
export { renderPageForTest } from './render-page-for-test.ts'
export type { RenderPageForTestResult } from './render-page-for-test.ts'
