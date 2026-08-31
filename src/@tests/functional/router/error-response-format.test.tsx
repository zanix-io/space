// Installs a renderer, exactly as a real app does — the JSON short-circuit itself is
// renderer-agnostic (it returns BEFORE ever reaching a renderer-specific render function), but
// `loadRoutes()`/`handleGet` still need one installed for everything else they touch.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { HttpError } from '@zanix/errors'
import { createNotFoundHandler, loadRoutes } from 'modules/router/mod.ts'
import { mockHandlerContext } from 'modules/testing/mod.ts'
import { setNotFoundComponent, setRootLayout } from 'modules/router/app-shell-registry.ts'
import { setErrorResponseFormat } from 'modules/router/error-response-format-registry.ts'
import LoaderErrorNoBoundaryFixturePage from '../../support/fixtures/loader-error-no-boundary-routes/page.tsx'

/**
 * `defineSpaceApp({ errorResponse: 'json' })` — checked ONLY for the two recovery paths that know
 * their outcome before anything has started rendering (a data-phase `loader` failure, and a 404):
 * see `SpaceAppConfig.errorResponse`'s own doc for the full contract, including why a render-phase
 * failure with no `error.tsx` is deliberately NOT one of them.
 *
 * @module
 */

console.error = () => {}

Deno.test(
  "renderLoaderErrorPage: with errorResponse: 'json' and no error.tsx anywhere, returns a plain " +
    "safe JSON body (@zanix/server's own httpErrorResponse allowlist) instead of DefaultErrorView, " +
    'with the real HTTP status preserved and no internal `stack` leaked',
  async () => {
    setErrorResponseFormat('json')
    try {
      await loadRoutes('src/@tests/support/fixtures/loader-error-no-boundary-routes')
      const ctx = mockHandlerContext()
      const page = new LoaderErrorNoBoundaryFixturePage(ctx)
      const response = await page.handleGet(ctx)

      assertEquals(response.status, 500)
      assertEquals(response.headers.get('content-type'), 'application/json')
      const body = await response.json()
      assertEquals(body.name, 'Error')
      assertEquals(body.message, 'fixture-no-boundary-loader-boom')
      assert(!('DefaultErrorView' in body), 'must never be the rendered view, only the error')
      // The real regression this locks in: `serializeError(error)`'s own default
      // (`withStackTrace: true`) used to ship this server's real absolute file paths to whoever
      // calls this endpoint — `httpErrorResponse`'s safe-by-default allowlist never includes it.
      assert(!('stack' in body), "must never leak this server's own internal stack trace")
    } finally {
      setErrorResponseFormat(undefined)
    }
  },
)

Deno.test(
  "renderLoaderErrorPage: with errorResponse left at its default ('view'), the SAME fixture " +
    'still renders DefaultErrorView as before — the flag changes nothing unless explicitly set',
  async () => {
    await loadRoutes('src/@tests/support/fixtures/loader-error-no-boundary-routes')
    const ctx = mockHandlerContext()
    const page = new LoaderErrorNoBoundaryFixturePage(ctx)
    const response = await page.handleGet(ctx)

    assertEquals(response.status, 500)
    const html = await response.text()
    assert(html.includes('data-space="error"'), html)
  },
)

Deno.test(
  "createNotFoundHandler: with errorResponse: 'json' and no not-found.tsx, returns a plain safe " +
    "JSON 404 body (@zanix/server's own httpErrorResponse allowlist) instead of DefaultNotFoundView",
  async () => {
    setErrorResponseFormat('json')
    setNotFoundComponent(undefined)
    setRootLayout(undefined)
    try {
      const handler = createNotFoundHandler()
      const response = await handler(new HttpError('NOT_FOUND'))

      assert(response, 'a real NOT_FOUND HttpError must always produce a response')
      assertEquals(response.status, 404)
      assertEquals(response.headers.get('content-type'), 'application/json')
      const body = await response.json()
      assertEquals(body.name, 'HttpError')
      assertEquals(body.status.code, 'NOT_FOUND')
      // Same regression this file's loader-error case above locks in — see that test's own doc.
      assert(!('stack' in body), "must never leak this server's own internal stack trace")
    } finally {
      setErrorResponseFormat(undefined)
    }
  },
)
