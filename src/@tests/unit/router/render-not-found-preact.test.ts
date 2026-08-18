import { assertEquals } from '@std/assert'
import { createElement } from 'preact'
import { renderNotFoundResponse } from 'modules/router/render-not-found-preact.ts'
import type { NotFoundRenderContext } from 'modules/router/not-found-renderer-registry.ts'
import { setDevClientEnabled } from 'modules/dev/dev-client-registry.ts'
import { extractDocumentSemantics } from 'modules/render/document-semantics.ts'
import { SPACE_DEV_SOCKET_ROUTE } from 'modules/dev/dev-socket-route.ts'

// ================================================================================================
// `renderNotFoundResponse` (Preact) — the two branches `not-found-parity.test.tsx` never reaches,
// because every one of its scenarios calls with `fragmentOnly: false` and never toggles the dev
// client on: the Orbit fragment path (both with and without a resolved title) and the dev-client
// script being present on a full document.
// ================================================================================================

function NotFound() {
  return createElement('p', null, 'nothing here')
}

Deno.test(
  'renderNotFoundResponse [preact] fragmentOnly: with a resolved title, the fragment carries a ' +
    'real <title> element alongside the outlet — the same shape a page Orbit fragment takes, for ' +
    "orbit.ts's own extractFragmentTitle",
  async () => {
    const context: NotFoundRenderContext = {
      NotFound,
      RootLayout: undefined,
      head: { title: 'Not found' },
      fragmentOnly: true,
    }

    const response = await renderNotFoundResponse(context)
    const html = await response.text()

    assertEquals(html.includes('<title>Not found</title>'), true, html)
    assertEquals(html.includes('nothing here'), true, html)
    // A fragment, not a full document: no doctype, no <html> shell.
    assertEquals(html.toLowerCase().includes('<!doctype'), false, html)
  },
)

Deno.test(
  'renderNotFoundResponse [preact] fragmentOnly: with no resolved title, the fragment is just the ' +
    'outlet — no empty <title> element ever emitted',
  async () => {
    const context: NotFoundRenderContext = {
      NotFound,
      RootLayout: undefined,
      head: undefined,
      fragmentOnly: true,
    }

    const response = await renderNotFoundResponse(context)
    const html = await response.text()

    assertEquals(html.includes('<title'), false, html)
    assertEquals(html.includes('nothing here'), true, html)
  },
)

Deno.test(
  'renderNotFoundResponse [preact] full document: the dev client script is injected when ' +
    'isDevClientEnabled() is true — the state not-found-parity.test.tsx never exercises',
  async () => {
    setDevClientEnabled(true)
    try {
      const response = await renderNotFoundResponse({
        NotFound,
        RootLayout: undefined,
        head: { title: 'Not found' },
        fragmentOnly: false,
      })
      const html = await response.text()
      const doc = extractDocumentSemantics(html)

      assertEquals(doc.isDocument, true)
      assertEquals(doc.titles, ['Not found'])
      // The dev client script really was injected, not just a document that happens to pass.
      assertEquals(html.includes(SPACE_DEV_SOCKET_ROUTE), true, html)
    } finally {
      setDevClientEnabled(false)
    }
  },
)
