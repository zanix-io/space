import type { PageContext } from 'typings/page.ts'
import { createDedupeCache } from '../router/request-dedupe.ts'

/**
 * Builds a minimal `PageContext` for testing a page's `loader`/`action` as a plain function —
 * the "unit" level of the framework's own testing convention (unit/functional/integration). No
 * rendering, no HTTP, no `SpacePageController` instance involved: just the object shape `loader`
 * itself receives.
 *
 * @example
 * ```ts
 * import { mockPageContext } from '@zanix/space/testing'
 *
 * const data = await new ProductPage().loader(mockPageContext({ params: { id: '1' } }))
 * ```
 */
export function mockPageContext<Params = Record<string, string>>(
  overrides: Partial<PageContext<Params>> = {},
): PageContext<Params> {
  const request = overrides.request ?? new Request('http://localhost/')
  const url = overrides.url ?? new URL(request.url)

  return {
    request,
    url,
    params: (overrides.params ?? {}) as Params,
    csrfToken: overrides.csrfToken,
    population: overrides.population,
    session: overrides.session,
    // A fresh cache per call, same as the real `toPageContext` (`space-page-controller.ts`) —
    // `overrides.dedupe` still wins when a test wants to assert on a SHARED cache across several
    // `mockPageContext()`-received loaders (pass the same `createDedupeCache()` result to each).
    dedupe: overrides.dedupe ?? createDedupeCache(),
  }
}
