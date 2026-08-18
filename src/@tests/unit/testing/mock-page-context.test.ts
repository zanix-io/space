import { assertEquals, assertStrictEquals } from '@std/assert'
import { mockPageContext } from 'modules/testing/mod.ts'

Deno.test(
  'mockPageContext: with no overrides, defaults to an empty params object and a localhost request/url pair',
  () => {
    const ctx = mockPageContext()

    assertEquals(ctx.params, {})
    assertEquals(ctx.request.url, 'http://localhost/')
    assertEquals(ctx.url.href, 'http://localhost/')
    assertStrictEquals(ctx.csrfToken, undefined)
    assertStrictEquals(ctx.population, undefined)
  },
)

Deno.test(
  'mockPageContext: a loader receives exactly the params/request/url/csrfToken/population passed as overrides',
  async () => {
    const request = new Request('http://localhost/products/1')
    const ctx = mockPageContext({
      params: { id: '1' },
      request,
      csrfToken: 'test-token',
      population: 'zanix',
    })

    // Proves the shape is what a real `loader` expects — no `SpacePageController` instance
    // involved, matching the "unit" level of the framework's own testing convention.
    function loader(loaderCtx: typeof ctx) {
      return {
        id: loaderCtx.params.id,
        path: loaderCtx.url.pathname,
        token: loaderCtx.csrfToken,
        population: loaderCtx.population,
      }
    }

    const data = await loader(ctx)
    assertEquals(data, { id: '1', path: '/products/1', token: 'test-token', population: 'zanix' })
    assertStrictEquals(ctx.request, request)
  },
)

Deno.test(
  'mockPageContext: an explicit url override is kept as-is, independent of request.url',
  () => {
    const url = new URL('http://localhost/custom')
    const ctx = mockPageContext({ url })

    assertStrictEquals(ctx.url, url)
    assertEquals(ctx.request.url, 'http://localhost/')
  },
)
