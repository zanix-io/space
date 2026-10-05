import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { loadRoutes } from 'modules/router/mod.ts'
import { mockHandlerContext } from 'modules/testing/mod.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { setPageRenderer } from 'modules/router/page-renderer-registry.ts'
import { setLoaderErrorRenderer } from 'modules/router/loader-error-renderer-registry.ts'
import { setNotFoundRenderer } from 'modules/router/not-found-renderer-registry.ts'
import { renderPageResponse as renderPageReact } from 'modules/router/render-page-react.tsx'
import { renderLoaderErrorResponse as renderLoaderErrorReact } from 'modules/router/render-loader-error-react.tsx'
import { renderNotFoundResponse as renderNotFoundReact } from 'modules/router/render-not-found-react.tsx'
import { setErrorResponseFormat } from 'modules/router/error-response-format-registry.ts'
import LoaderErrorNoBoundaryFixturePage from '../../support/fixtures/loader-error-no-boundary-routes/page.tsx'

console.error = () => {}

/**
 * A `POST` to a page that declares no `action` answers `405` + `Allow: GET, HEAD`. A document
 * request (`Accept: text/html`, a browser form submission) gets the rendered error view; any other
 * request keeps `@zanix/server`'s JSON error response.
 *
 * @module
 */

const FIXTURE = 'src/@tests/support/fixtures/loader-error-no-boundary-routes'

function post(accept?: string) {
  return mockHandlerContext({
    req: new Request('http://localhost/es/forbidden', {
      method: 'POST',
      headers: accept ? { accept } : {},
    }),
  })
}

Deno.test('handlePost without action [react]: a document request gets a 405 HTML error page', async () => {
  await loadRoutes(FIXTURE)
  const ctx = post('text/html,application/xhtml+xml;q=0.9,*/*;q=0.8')
  const response = await new LoaderErrorNoBoundaryFixturePage(ctx).handlePost(ctx)

  assertEquals(response.status, 405)
  assertEquals(response.headers.get('allow'), 'GET, HEAD')
  assert(response.headers.get('content-type')?.startsWith('text/html'))
  const html = await response.text()
  assert(!html.includes('"HttpError"') && !html.includes('METHOD_NOT_ALLOWED'), html)
})

Deno.test('handlePost without action [react]: json and no-accept requests keep the JSON error', async () => {
  await loadRoutes(FIXTURE)
  const responses = await Promise.all(
    ['application/json', undefined, '*/*'].map((accept) => {
      const ctx = post(accept)
      return new LoaderErrorNoBoundaryFixturePage(ctx).handlePost(ctx)
    }),
  )
  for (const response of responses) {
    assertEquals(response.status, 405)
    assertEquals(response.headers.get('allow'), 'GET, HEAD')
  }
  assertEquals(
    (await Promise.all(responses.map((r) => r.json()))).map((b) => b.message),
    ['METHOD_NOT_ALLOWED', 'METHOD_NOT_ALLOWED', 'METHOD_NOT_ALLOWED'],
  )
})

Deno.test("handlePost without action [react]: errorResponse 'json' keeps JSON for a document request", async () => {
  setErrorResponseFormat('json')
  try {
    await loadRoutes(FIXTURE)
    const ctx = post('text/html')
    const response = await new LoaderErrorNoBoundaryFixturePage(ctx).handlePost(ctx)
    assertEquals(response.status, 405)
    assertEquals(response.headers.get('allow'), 'GET, HEAD')
    assertEquals((await response.json()).message, 'METHOD_NOT_ALLOWED')
  } finally {
    setErrorResponseFormat(undefined)
  }
})

Deno.test('handlePost without action [preact]: a document request gets a 405 HTML error page', async () => {
  const preactPage = await import('modules/router/render-page-preact.ts')
  const preactError = await import('modules/router/render-loader-error-preact.ts')
  const preactNotFound = await import('modules/router/render-not-found-preact.ts')
  setActiveRenderer('preact')
  setPageRenderer(preactPage.renderPageResponse)
  setLoaderErrorRenderer(preactError.renderLoaderErrorResponse)
  setNotFoundRenderer(preactNotFound.renderNotFoundResponse)
  try {
    await loadRoutes('src/@tests/support/fixtures/not-found-preact-routes')
    const { default: HomePage } = await import(
      '../../support/fixtures/not-found-preact-routes/page.tsx'
    )
    const ctx = post('text/html')
    const response = await new HomePage(ctx).handlePost(ctx)
    assertEquals(response.status, 405)
    assertEquals(response.headers.get('allow'), 'GET, HEAD')
    assert(response.headers.get('content-type')?.startsWith('text/html'))
    assert(!(await response.text()).includes('METHOD_NOT_ALLOWED'))
  } finally {
    setActiveRenderer('react')
    setPageRenderer(renderPageReact)
    setLoaderErrorRenderer(renderLoaderErrorReact)
    setNotFoundRenderer(renderNotFoundReact)
  }
})
