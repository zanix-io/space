// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals, assertFalse } from '@std/assert'
import type { ReactNode } from 'react'
import { HttpError } from '@zanix/errors'
import { attachRequestToError } from '@zanix/server'
import { createNotFoundHandler } from 'modules/router/not-found-handler.ts'
import { setNotFoundComponent, setRootLayout } from 'modules/router/app-shell-registry.ts'
import { ORBIT_FRAGMENT_HEADER, ORBIT_OUTLET_ATTR } from 'modules/router/orbit-protocol.ts'
import { setCssManifest } from 'modules/render/css-manifest.ts'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'

function CustomNotFound() {
  return <p>custom not found</p>
}

function CustomRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='fr'>
      <body data-testid='root-layout'>{children}</body>
    </html>
  )
}

Deno.test('createNotFoundHandler: returns undefined for a non-NOT_FOUND HttpError', async () => {
  setNotFoundComponent(undefined)
  setRootLayout(undefined)
  const handler = createNotFoundHandler()

  const result = await handler(new HttpError('METHOD_NOT_ALLOWED', {}))
  assert(
    result === undefined,
    'a non-404 error must fall through to the default response',
  )
})

Deno.test('createNotFoundHandler: returns undefined for a plain, non-HttpError error', async () => {
  const handler = createNotFoundHandler()

  const result = await handler(new Error('boom'))
  assert(result === undefined)
})

Deno.test(
  'createNotFoundHandler: renders the built-in default view when no not-found.tsx was registered',
  async () => {
    setNotFoundComponent(undefined)
    setRootLayout(undefined)
    const handler = createNotFoundHandler()

    const response = await handler(new HttpError('NOT_FOUND', {}))
    assert(response instanceof Response)
    assertEquals(response.status, 404)
    const html = stripHydrationComments(await response.text())
    assert(html.startsWith('<!DOCTYPE html>'), html)
    assert(html.includes('404'), html)
  },
)

Deno.test(
  "createNotFoundHandler: renders the app's own not-found.tsx when registered",
  async () => {
    setNotFoundComponent(CustomNotFound)
    try {
      const handler = createNotFoundHandler()
      const response = await handler(new HttpError('NOT_FOUND', {}))
      assert(response instanceof Response)
      assertEquals(response.status, 404)
      const html = await response.text()
      assert(html.includes('custom not found'), html)
    } finally {
      setNotFoundComponent(undefined)
    }
  },
)

Deno.test(
  'createNotFoundHandler: wraps the not-found page in the root layout when one is registered',
  async () => {
    setRootLayout(CustomRootLayout)
    try {
      const handler = createNotFoundHandler()
      const response = await handler(new HttpError('NOT_FOUND', {}))
      assert(response instanceof Response)
      const html = stripHydrationComments(await response.text())
      assert(html.includes('<html lang="fr">'), html)
      assert(html.includes('data-testid="root-layout"'), html)
    } finally {
      setRootLayout(undefined)
    }
  },
)

Deno.test(
  'createNotFoundHandler: renders just the outlet fragment for an Orbit navigation, ' +
    'once the request is attached to the error',
  async () => {
    setNotFoundComponent(undefined)
    setRootLayout(undefined)
    const handler = createNotFoundHandler()

    const request = new Request('http://localhost/missing', {
      headers: { [ORBIT_FRAGMENT_HEADER]: '1' },
    })
    const error = attachRequestToError(new HttpError('NOT_FOUND', {}), request)

    const response = await handler(error)
    assert(response instanceof Response)
    assertEquals(response.status, 404)
    const html = stripHydrationComments(await response.text())
    assert(!html.includes('<!DOCTYPE html>'), html)
    assert(!html.includes('<html'), html)
    assert(html.includes(`${ORBIT_OUTLET_ATTR}=""`), html)
    // No inline style, and no built-in stylesheet `<style>` tag either — a fragment has no
    // `<head>` of its own (see `head-markup.ts`'s own doc); it relies on the already-loaded
    // page's own copy of the built-in `display: contents` rule (matched by attribute selector,
    // so it applies to this newly-inserted outlet element too, without needing its own copy).
    assertFalse(html.includes('style="display:contents"'), html)
    assert(html.includes('404'), html)
    assertEquals(response.headers.get('vary'), ORBIT_FRAGMENT_HEADER)
  },
)

Deno.test(
  'createNotFoundHandler: still renders the full document for a plain (non-Orbit) request, ' +
    'even once attached to the error',
  async () => {
    setNotFoundComponent(undefined)
    setRootLayout(undefined)
    const handler = createNotFoundHandler()

    const request = new Request('http://localhost/missing')
    const error = attachRequestToError(new HttpError('NOT_FOUND', {}), request)

    const response = await handler(error)
    assert(response instanceof Response)
    const html = stripHydrationComments(await response.text())
    assert(html.startsWith('<!DOCTYPE html>'), html)
    assertEquals(response.headers.get('vary'), ORBIT_FRAGMENT_HEADER)
  },
)

Deno.test(
  'createNotFoundHandler: links the built stylesheet(s) on a full document, omits them on an ' +
    'Orbit fragment',
  async () => {
    setNotFoundComponent(undefined)
    setRootLayout(undefined)
    setCssManifest({ global: ['/assets/app-hash123.css'] })
    try {
      const handler = createNotFoundHandler()

      const fullResponse = await handler(new HttpError('NOT_FOUND', {}))
      assert(fullResponse instanceof Response)
      const fullHtml = await fullResponse.text()
      assert(
        fullHtml.includes(
          '<link rel="stylesheet" href="/assets/app-hash123.css"',
        ),
        fullHtml,
      )

      const fragmentRequest = new Request('http://localhost/missing', {
        headers: { [ORBIT_FRAGMENT_HEADER]: '1' },
      })
      const fragmentError = attachRequestToError(
        new HttpError('NOT_FOUND', {}),
        fragmentRequest,
      )
      const fragmentResponse = await handler(fragmentError)
      assert(fragmentResponse instanceof Response)
      const fragmentHtml = await fragmentResponse.text()
      assert(!fragmentHtml.includes('stylesheet'), fragmentHtml)
    } finally {
      setCssManifest(undefined)
    }
  },
)
