import { assertEquals } from '@std/assert'
import { renderLoaderErrorResponse } from 'modules/router/render-loader-error-react.tsx'
import type { LoaderErrorRenderContext } from 'modules/router/loader-error-renderer-registry.ts'
import { setDevClientEnabled } from 'modules/dev/dev-client-registry.ts'
import { SPACE_DEV_SOCKET_ROUTE } from 'modules/dev/dev-socket-route.ts'
import { ORBIT_OUTLET_ATTR } from 'modules/router/orbit-protocol.ts'

// ================================================================================================
// `renderLoaderErrorResponse` (React) — the branches `loader-error-default-view-parity.test.tsx`
// never reaches, because its only scenario calls with `fragmentOnly: false` and never toggles the
// dev client on: the Orbit fragment path, and the dev-client script being present on a full
// document. Neither of these is otherwise exercised: `page-composition.test.tsx`'s own loader-error
// fixtures only ever cover a plain GET, never an Orbit navigation, and the dev client stays off in
// every one of them.
// ================================================================================================

function FallbackView({ error }: { error: unknown }) {
  return <p data-testid='fallback'>{String((error as Error).message)}</p>
}

Deno.test(
  'renderLoaderErrorResponse [react] fragmentOnly: returns just the outlet fragment — no doctype, ' +
    'no <html> shell, same shape a page Orbit fragment takes',
  async () => {
    const context: LoaderErrorRenderContext = {
      ErrorFallback: FallbackView,
      RootLayout: undefined,
      error: new Error('fixture-loader-boom'),
      fragmentOnly: true,
    }

    const response = await renderLoaderErrorResponse(context)
    const html = await response.text()

    assertEquals(html.includes('fixture-loader-boom'), true, html)
    assertEquals(html.includes(`${ORBIT_OUTLET_ATTR}=""`), true, html)
    // A fragment, not a full document: no doctype, no <html> shell.
    assertEquals(html.toLowerCase().includes('<!doctype'), false, html)
    assertEquals(html.includes('<html'), false, html)
  },
)

Deno.test(
  'renderLoaderErrorResponse [react] full document: the dev client script is injected when ' +
    'isDevClientEnabled() is true — the state loader-error-default-view-parity.test.tsx never ' +
    'exercises',
  async () => {
    setDevClientEnabled(true)
    try {
      const response = await renderLoaderErrorResponse({
        ErrorFallback: FallbackView,
        RootLayout: undefined,
        error: new Error('fixture-loader-boom'),
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
