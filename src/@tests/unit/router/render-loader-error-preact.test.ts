import { assertEquals } from '@std/assert'
import { createElement } from 'preact'
import { renderLoaderErrorResponse } from 'modules/router/render-loader-error-preact.ts'
import type { LoaderErrorRenderContext } from 'modules/router/loader-error-renderer-registry.ts'
import { setDevClientEnabled } from 'modules/dev/dev-client-registry.ts'
import { SPACE_DEV_SOCKET_ROUTE } from 'modules/dev/dev-socket-route.ts'
import { setPwaBuildOutput, setPwaConfig } from 'modules/pwa/pwa-registry.ts'
import { SW_ROUTE } from 'modules/pwa/web-manifest.ts'
import { ORBIT_OUTLET_ATTR } from 'modules/router/orbit-protocol.ts'

// ================================================================================================
// `renderLoaderErrorResponse` (Preact) — the branches `loader-error-default-view-parity.test.tsx`
// never reaches, because its only scenario calls with `fragmentOnly: false`, no PWA build output
// registered, and the dev client left off: the Orbit fragment path, the dev-client script being
// present on a full document, and the service-worker registration script that only renders once a
// PWA build output has been loaded.
// ================================================================================================

function FallbackView({ error }: { error: unknown }) {
  return createElement('p', { 'data-testid': 'fallback' }, String((error as Error).message))
}

Deno.test(
  'renderLoaderErrorResponse [preact] fragmentOnly: returns just the outlet fragment — no doctype, ' +
    'no <html> shell, same shape a page Orbit fragment takes',
  async () => {
    const context: LoaderErrorRenderContext = {
      ErrorFallback: FallbackView,
      RootLayout: undefined,
      error: new Error('fixture-loader-boom'),
      formattedError: {},
      params: {},
      fragmentOnly: true,
    }

    const response = await renderLoaderErrorResponse(context)
    const html = await response.text()

    assertEquals(html.includes('fixture-loader-boom'), true, html)
    // Preact serializes a boolean/empty-string attribute bare, with no `=""` — unlike React's own
    // counterpart, which always renders the explicit `=""` form.
    assertEquals(html.includes(ORBIT_OUTLET_ATTR), true, html)
    // A fragment, not a full document: no doctype, no <html> shell.
    assertEquals(html.toLowerCase().includes('<!doctype'), false, html)
    assertEquals(html.includes('<html'), false, html)
  },
)

Deno.test(
  'renderLoaderErrorResponse [preact] full document: the dev client script is injected when ' +
    'isDevClientEnabled() is true — the state loader-error-default-view-parity.test.tsx never ' +
    'exercises',
  async () => {
    setDevClientEnabled(true)
    try {
      const response = await renderLoaderErrorResponse({
        ErrorFallback: FallbackView,
        RootLayout: undefined,
        error: new Error('fixture-loader-boom'),
        formattedError: {},
        params: {},
        fragmentOnly: false,
      })
      const html = await response.text()

      assertEquals(html.toLowerCase().includes('<!doctype'), true, html)
      // The dev client script really was injected, not just a document that happens to pass.
      assertEquals(html.includes(SPACE_DEV_SOCKET_ROUTE), true, html)
    } finally {
      setDevClientEnabled(false)
    }
  },
)

Deno.test(
  'renderLoaderErrorResponse [preact] full document: the service-worker registration script is ' +
    'rendered once a PWA build output has been loaded — the branch loader-error-default-view-parity' +
    '.test.tsx never exercises (no PWA configured there at all)',
  async () => {
    setPwaConfig({ name: 'Fixture App', icon: '/icon.png' })
    setPwaBuildOutput('/tmp/dist/client')
    try {
      const response = await renderLoaderErrorResponse({
        ErrorFallback: FallbackView,
        RootLayout: undefined,
        error: new Error('fixture-loader-boom'),
        formattedError: {},
        params: {},
        fragmentOnly: false,
      })
      const html = await response.text()

      assertEquals(html.includes(SW_ROUTE), true, html)
      assertEquals(html.includes('serviceWorker'), true, html)
    } finally {
      setPwaConfig(undefined)
      setPwaBuildOutput(undefined)
    }
  },
)
