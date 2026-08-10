import { assertEquals } from '@std/assert'
import { SpacePageController } from 'modules/router/mod.ts'
import {
  getDefaultPageHeaders,
  resetDefaultPageHeaders,
  setDefaultPageHeaders,
} from 'modules/router/default-page-headers.ts'
import { mockHandlerContext } from 'modules/testing/mod.ts'

function View() {
  return <p>ok</p>
}

// Global, module-level state (same shape/reasoning as @zanix/utils's setDefaultRedactOptions) —
// reset in a `finally` so this test's own default never leaks into another test file sharing the
// same process/test run.
Deno.test(
  'setDefaultPageHeaders: an app-wide default applies to a page that never sets its own headers',
  async () => {
    setDefaultPageHeaders({ frameOptions: 'DENY', csp: { 'default-src': ["'none'"] } })
    try {
      class NoOwnHeadersPage extends SpacePageController {
        public override component = View
      }

      const response = await new NoOwnHeadersPage(mockHandlerContext()).handleGet(
        mockHandlerContext(),
      )
      assertEquals(response.headers.get('X-Frame-Options'), 'DENY')
      assertEquals(response.headers.get('Content-Security-Policy'), "default-src 'none'")
      await response.body?.cancel()
    } finally {
      resetDefaultPageHeaders()
    }
  },
)

Deno.test(
  "setDefaultPageHeaders: a page's own static headers still wins over the app-wide default",
  async () => {
    setDefaultPageHeaders({ frameOptions: 'DENY' })
    try {
      class OwnHeadersPage extends SpacePageController {
        public static override headers = { frameOptions: 'SAMEORIGIN' as const }
        public override component = View
      }

      const response = await new OwnHeadersPage(mockHandlerContext()).handleGet(
        mockHandlerContext(),
      )
      assertEquals(response.headers.get('X-Frame-Options'), 'SAMEORIGIN')
      await response.body?.cancel()
    } finally {
      resetDefaultPageHeaders()
    }
  },
)

Deno.test(
  "setDefaultPageHeaders: a page's own headers: false still wins, even over an app-wide default",
  async () => {
    setDefaultPageHeaders({ frameOptions: 'DENY' })
    try {
      class NoHeadersAtAllPage extends SpacePageController {
        public static override headers = false as const
        public override component = View
      }

      const response = await new NoHeadersAtAllPage(mockHandlerContext()).handleGet(
        mockHandlerContext(),
      )
      assertEquals(response.headers.get('X-Frame-Options'), null)
      assertEquals(response.headers.get('Content-Security-Policy'), null)
      await response.body?.cancel()
    } finally {
      resetDefaultPageHeaders()
    }
  },
)

Deno.test(
  'setDefaultPageHeaders: false disables headers app-wide for any page with no headers of its own',
  async () => {
    setDefaultPageHeaders(false)
    try {
      class NoOwnHeadersPage extends SpacePageController {
        public override component = View
      }

      const response = await new NoOwnHeadersPage(mockHandlerContext()).handleGet(
        mockHandlerContext(),
      )
      assertEquals(response.headers.get('X-Frame-Options'), null)
      assertEquals(response.headers.get('Content-Security-Policy'), null)
      await response.body?.cancel()
    } finally {
      resetDefaultPageHeaders()
    }
  },
)

Deno.test('getDefaultPageHeaders: undefined until setDefaultPageHeaders is called', () => {
  resetDefaultPageHeaders()
  assertEquals(getDefaultPageHeaders(), undefined)
})

Deno.test(
  'a page overriding just ONE field keeps every OTHER field from the app-wide default — ' +
    'merged field by field, not replaced as a whole object',
  async () => {
    setDefaultPageHeaders({ frameOptions: 'DENY', csp: { 'default-src': ["'none'"] } })
    try {
      class PartialOverridePage extends SpacePageController {
        public static override headers = { noSniff: false }
        public override component = View
      }

      const response = await new PartialOverridePage(mockHandlerContext()).handleGet(
        mockHandlerContext(),
      )
      // The field the page actually touched:
      assertEquals(response.headers.get('X-Content-Type-Options'), null)
      // Fields the page never mentioned — must survive from the app-wide default, not silently
      // fall back to the framework's own built-in defaults.
      assertEquals(response.headers.get('X-Frame-Options'), 'DENY')
      assertEquals(response.headers.get('Content-Security-Policy'), "default-src 'none'")
      await response.body?.cancel()
    } finally {
      resetDefaultPageHeaders()
    }
  },
)

Deno.test(
  "a page's own csp fully replaces the app-wide csp (not merged directive by directive), " +
    'while other fields still merge normally',
  async () => {
    setDefaultPageHeaders({
      frameOptions: 'DENY',
      csp: { 'default-src': ["'none'"], 'img-src': ["'self'"] },
    })
    try {
      class OwnCspPage extends SpacePageController {
        public static override headers = { csp: { 'default-src': ["'self'"] } }
        public override component = View
      }

      const response = await new OwnCspPage(mockHandlerContext()).handleGet(mockHandlerContext())
      assertEquals(response.headers.get('Content-Security-Policy'), "default-src 'self'")
      // frameOptions was never touched by this page — still comes from the app-wide default.
      assertEquals(response.headers.get('X-Frame-Options'), 'DENY')
      await response.body?.cancel()
    } finally {
      resetDefaultPageHeaders()
    }
  },
)
