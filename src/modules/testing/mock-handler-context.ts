import type { HandlerContext } from '@zanix/server'

/**
 * Builds a minimal, spec-compliant `HandlerContext` for tests that need to call a
 * `SpacePageController`'s `handleGet`/`handlePost` directly, without a real HTTP server —
 * the "functional" level of the framework's own testing convention (unit/functional/integration,
 * same as the rest of the Zanix ecosystem). `renderPageForTest` builds one of these internally;
 * reach for this directly only when you need finer control (e.g. testing a custom `@Guard`, or
 * asserting on `ctx.locals` a guard left behind).
 *
 * @example
 * ```ts
 * import { mockHandlerContext } from '@zanix/space/testing'
 *
 * const ctx = mockHandlerContext({ req: new Request('http://localhost/products/1') })
 * const response = await new ProductPage().handleGet(ctx)
 * ```
 */
export function mockHandlerContext(overrides: Partial<HandlerContext> = {}): HandlerContext {
  const req = overrides.req ?? new Request('http://localhost/')
  const url = overrides.url ?? new URL(req.url)

  return {
    id: 'test-context',
    req,
    url,
    payload: { params: {}, search: {}, body: undefined },
    cookies: {},
    locals: {},
    ...overrides,
  } as HandlerContext
}
