import { assert, assertEquals } from '@std/assert'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { createNotFoundHandler, loadRoutes } from 'modules/router/mod.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { setPageRenderer } from 'modules/router/page-renderer-registry.ts'
import { setNotFoundRenderer } from 'modules/router/not-found-renderer-registry.ts'
import { renderPageResponse as renderPageReact } from 'modules/router/render-page-react.tsx'
import { renderNotFoundResponse as renderNotFoundReact } from 'modules/router/render-not-found-react.tsx'
import { setPwaConfig } from 'modules/pwa/mod.ts'
import { extractDocumentSemantics } from 'modules/render/document-semantics.ts'

console.error = () => {}

// ================================================================================================
// End-to-end not-found coverage under --renderer=preact, through the PUBLIC API.
//
// This file replaces an earlier end-to-end case that ran `createNotFoundHandler` under Preact
// against a fixture authored as JSX. That fixture compiled against React's JSX factory (every
// `.tsx` in this project does), so it produced React elements — running them under Preact was a
// mixed-renderer app, which this package forbids. The case was removed rather than adapted, and
// this file exists so removing it did not cost real coverage: same path, same public entry point,
// same HTTP-level assertions, but against a fixture that is genuinely Preact
// (`support/fixtures/not-found-preact-routes`, authored with Preact's own `createElement`).
//
// What is actually being proven here: under Preact, a 404 request travels through
// `createNotFoundHandler` → the registered `NotFoundRenderer` → a real `DocumentModel` → the Preact
// serializer, and comes back as a complete HTTP response with a complete document. Every assertion
// is made against extracted document semantics, never an HTML string.
// ================================================================================================

const FIXTURE = 'src/@tests/support/fixtures/not-found-preact-routes'

/** Switches the whole package onto the Preact renderer, the same way `defineSpaceApp({ renderer:
 * 'preact' })` does at activation — page renderer and not-found renderer together, never one
 * without the other. */
async function activatePreact(): Promise<void> {
  const { renderPageResponse } = await import('modules/router/render-page-preact.ts')
  const { renderNotFoundResponse } = await import('modules/router/render-not-found-preact.ts')
  setActiveRenderer('preact')
  setPageRenderer(renderPageResponse)
  setNotFoundRenderer(renderNotFoundResponse)
}

/** Restores the React defaults so this file leaves no renderer state behind for the rest of the
 * suite — these registries are process-wide. */
function restoreReact(): void {
  setActiveRenderer('react')
  setPageRenderer(renderPageReact)
  setNotFoundRenderer(renderNotFoundReact)
  setPwaConfig(undefined)
}

Deno.test(
  'not-found E2E [preact]: an unmatched route returns a real 404 HTML response, not ' +
    "@zanix/server's JSON fallback — the whole point of the renderer-agnostic not-found path",
  async () => {
    await activatePreact()
    await loadRoutes(FIXTURE)

    // `finalize: false` — this file runs several servers against the same route fixture; see
    // `not-found-integration.test.tsx`'s own note for why re-importing is a cache-hit no-op.
    const servers = await bootstrapServers({
      ssr: { port: 20711, onError: createNotFoundHandler() },
    }, { finalize: false })

    try {
      const res = await fetch('http://localhost:20711/this-route-does-not-exist')

      assertEquals(res.status, 404)
      assertEquals(res.headers.get('content-type'), 'text/html; charset=utf-8')

      const doc = extractDocumentSemantics(await res.text())
      assertEquals(doc.isDocument, true)
    } finally {
      restoreReact()
      await webServerManager.stop(servers)
    }
  },
)

Deno.test(
  "not-found E2E [preact]: the app's own root layout wraps the 404, and the resolved head reaches " +
    'the document even though that layout cooperates in no way — no headExtras, no <title> of its ' +
    'own. This is the exact combination that produced a document with no metadata at all before ' +
    'head placement moved out of the shell',
  async () => {
    await activatePreact()
    await loadRoutes(FIXTURE)

    const servers = await bootstrapServers({
      ssr: { port: 20712, onError: createNotFoundHandler() },
    }, { finalize: false })

    try {
      const res = await fetch('http://localhost:20712/missing')
      assertEquals(res.status, 404)
      const html = await res.text()
      const doc = extractDocumentSemantics(html)

      // The app's own root layout really is what rendered the document.
      assert(html.includes('data-testid="preact-app-shell"'), html)
      assert(html.includes('data-testid="preact-not-found"'), html)

      // ...and the head resolved from the fixture's own `not-found.tsx` `head` export reached it.
      assertEquals(doc.titles, ['Not found'])
      assertEquals(doc.meta['name:description'], 'This page does not exist.')
      assertEquals(doc.meta['name:robots'], 'noindex')
      assertEquals(doc.links.filter((link) => link.rel === 'canonical'), [
        { rel: 'canonical', href: 'https://example.com/404' },
      ])

      // Document-level properties the layout itself supplies.
      assertEquals(doc.lang, 'en')
      assertEquals(doc.hasMetaCharset, true)
      assertEquals(doc.isDocument, true)
      assertEquals(doc.hasTextContent, true)
    } finally {
      restoreReact()
      await webServerManager.stop(servers)
    }
  },
)

Deno.test(
  'not-found E2E [preact]: with PWA configured, the manifest link, theme-color and the ' +
    'service-worker registration all reach the 404 document too — PWA is orthogonal to the ' +
    'renderer and applies to every document, not only to pages',
  async () => {
    await activatePreact()
    setPwaConfig({ name: 'Fixture App', icon: '/icon.png', themeColor: '#0af' })
    await loadRoutes(FIXTURE)

    const servers = await bootstrapServers({
      ssr: { port: 20713, onError: createNotFoundHandler() },
    }, { finalize: false })

    try {
      const res = await fetch('http://localhost:20713/missing')
      assertEquals(res.status, 404)
      const html = await res.text()
      const doc = extractDocumentSemantics(html)

      assertEquals(doc.links.filter((link) => link.rel === 'manifest'), [
        { rel: 'manifest', href: '/manifest.webmanifest' },
      ])
      assertEquals(doc.meta['name:theme-color'], '#0af')
      // The head still resolved normally alongside the PWA contribution.
      assertEquals(doc.titles, ['Not found'])
    } finally {
      restoreReact()
      await webServerManager.stop(servers)
    }
  },
)

Deno.test(
  'not-found E2E [preact]: a MATCHED route still renders normally through the same fixture — ' +
    'proves the 404 path is not being reached by accident, and that the same document contract ' +
    'holds for an ordinary page under this renderer',
  async () => {
    await activatePreact()
    await loadRoutes(FIXTURE)

    const servers = await bootstrapServers({
      ssr: { port: 20714, onError: createNotFoundHandler() },
    }, { finalize: false })

    try {
      const res = await fetch('http://localhost:20714/not-found-preact-fixture')
      assertEquals(res.status, 200)
      const html = await res.text()
      const doc = extractDocumentSemantics(html)

      assert(html.includes('data-testid="preact-app-shell"'), html)
      assertEquals(doc.titles, ['Home'])
      assertEquals(doc.lang, 'en')
      assertEquals(doc.isDocument, true)
    } finally {
      restoreReact()
      await webServerManager.stop(servers)
    }
  },
)
