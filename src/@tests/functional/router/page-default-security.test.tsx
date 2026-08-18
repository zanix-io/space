// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals, assertMatch } from '@std/assert'
import { SpacePageController } from 'modules/router/mod.ts'
import { mockHandlerContext } from 'modules/testing/mod.ts'
import { setCssManifest } from 'modules/render/css-manifest.ts'

function View() {
  return <p>ok</p>
}

Deno.test(
  "SpacePageController.handleGet: Page()'s default CSP is nonce-based, and the SAME nonce shows " +
    'up on the rendered initial-state script — not just in the header',
  async () => {
    class DefaultCspPage extends SpacePageController {
      public override component = View
      public override loader = () => ({})
    }

    const response = await new DefaultCspPage(mockHandlerContext()).handleGet(
      mockHandlerContext(),
    )
    const csp = response.headers.get('Content-Security-Policy')
    assert(csp, 'expected a Content-Security-Policy header')
    assertMatch(
      csp,
      /^default-src 'self'; script-src 'self' 'nonce-([^']+)'; style-src 'self' 'nonce-\1'$/,
    )

    const nonce = csp.match(/'nonce-([^']+)'/)?.[1]
    assert(nonce, 'expected to extract a nonce from the CSP header')

    const html = await response.text()
    const escapedNonce = nonce.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assertMatch(html, new RegExp(`<script[^>]*\\bnonce="${escapedNonce}"`))
  },
)

Deno.test(
  "SpacePageController.handleGet: a globalCss entry's own `media` never changes the CSP header " +
    '— byte-identical (nonce aside) to the same stylesheet with no `media` at all, since `media` ' +
    "is orthogonal to style-src's own origin/nonce model (P2-12a)",
  async () => {
    class DefaultCspPage extends SpacePageController {
      public override component = View
    }
    const normalizeNonce = (csp: string) => csp.replace(/nonce-[^']+/g, 'nonce-X')
    try {
      setCssManifest({ global: ['/assets/app-hash.css'] })
      const withoutMedia = await new DefaultCspPage(mockHandlerContext()).handleGet(
        mockHandlerContext(),
      )
      const cspWithoutMedia = withoutMedia.headers.get('Content-Security-Policy')
      await withoutMedia.body?.cancel()
      assert(cspWithoutMedia, 'expected a Content-Security-Policy header')

      setCssManifest({
        global: [{ href: '/assets/app-hash.css', media: '(max-width: 599px)' }],
      })
      const withMedia = await new DefaultCspPage(mockHandlerContext()).handleGet(
        mockHandlerContext(),
      )
      const cspWithMedia = withMedia.headers.get('Content-Security-Policy')
      await withMedia.body?.cancel()
      assert(cspWithMedia, 'expected a Content-Security-Policy header')

      assertEquals(normalizeNonce(cspWithMedia), normalizeNonce(cspWithoutMedia))
    } finally {
      setCssManifest(undefined)
    }
  },
)

Deno.test(
  'SpacePageController.handleGet: two requests to the same page get two different nonces',
  async () => {
    class DefaultCspPage extends SpacePageController {
      public override component = View
    }

    const first = await new DefaultCspPage(mockHandlerContext()).handleGet(
      mockHandlerContext(),
    )
    const second = await new DefaultCspPage(mockHandlerContext()).handleGet(
      mockHandlerContext(),
    )
    await first.body?.cancel()
    await second.body?.cancel()

    const firstCsp = first.headers.get('Content-Security-Policy')
    const secondCsp = second.headers.get('Content-Security-Policy')
    assert(firstCsp && secondCsp)
    assert(firstCsp !== secondCsp, 'expected a fresh nonce per request')
  },
)

Deno.test(
  'SpacePageController.handleGet: headers: { csp: false } disables just CSP, keeping the rest',
  async () => {
    class NoCspPage extends SpacePageController {
      public static override headers = { csp: false as const }
      public override component = View
    }

    const response = await new NoCspPage(mockHandlerContext()).handleGet(
      mockHandlerContext(),
    )
    assertEquals(response.headers.get('Content-Security-Policy'), null)
    // csp is one field among others in `headers` — disabling it doesn't disable the rest.
    assertEquals(response.headers.get('X-Frame-Options'), 'SAMEORIGIN')
    await response.body?.cancel()
  },
)

Deno.test(
  'SpacePageController.handleGet: a static headers.csp object applies exactly that policy, with no nonce',
  async () => {
    class CustomCspPage extends SpacePageController {
      public static override headers = {
        csp: { 'default-src': ["'none'"], 'img-src': ["'self'"] },
      }
      public override component = View
    }

    const response = await new CustomCspPage(mockHandlerContext()).handleGet(
      mockHandlerContext(),
    )
    assertEquals(
      response.headers.get('Content-Security-Policy'),
      "default-src 'none'; img-src 'self'",
    )
    await response.body?.cancel()
  },
)

Deno.test(
  "SpacePageController.handleGet: Page()'s default security headers are present",
  async () => {
    class DefaultHeadersPage extends SpacePageController {
      public override component = View
    }

    const response = await new DefaultHeadersPage(mockHandlerContext())
      .handleGet(
        mockHandlerContext(),
      )
    assertEquals(response.headers.get('X-Frame-Options'), 'SAMEORIGIN')
    assertEquals(
      response.headers.get('Referrer-Policy'),
      'strict-origin-when-cross-origin',
    )
    assertEquals(response.headers.get('X-Content-Type-Options'), 'nosniff')
    await response.body?.cancel()
  },
)

Deno.test(
  'SpacePageController.handleGet: static headers: false disables everything, CSP included',
  async () => {
    class NoSecurityHeadersPage extends SpacePageController {
      public static override headers = false as const
      public override component = View
    }

    const response = await new NoSecurityHeadersPage(mockHandlerContext())
      .handleGet(
        mockHandlerContext(),
      )
    assertEquals(response.headers.get('Content-Security-Policy'), null)
    assertEquals(response.headers.get('X-Frame-Options'), null)
    assertEquals(response.headers.get('Referrer-Policy'), null)
    assertEquals(response.headers.get('X-Content-Type-Options'), null)
    await response.body?.cancel()
  },
)

Deno.test(
  'SpacePageController.handleGet: static headers object overrides just the given fields',
  async () => {
    class CustomHeadersPage extends SpacePageController {
      public static override headers = { frameOptions: 'DENY' as const }
      public override component = View
    }

    const response = await new CustomHeadersPage(mockHandlerContext())
      .handleGet(
        mockHandlerContext(),
      )
    assertEquals(response.headers.get('X-Frame-Options'), 'DENY')
    // Untouched fields still get their own defaults, same as securityHeadersGuard's own doc.
    assertEquals(
      response.headers.get('Referrer-Policy'),
      'strict-origin-when-cross-origin',
    )
    await response.body?.cancel()
  },
)
