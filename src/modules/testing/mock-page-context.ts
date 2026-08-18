import type { PageContext } from 'typings/page.ts'

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
  }
}
