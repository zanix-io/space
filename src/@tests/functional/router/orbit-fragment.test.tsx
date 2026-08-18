// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { ORBIT_FRAGMENT_HEADER, ORBIT_OUTLET_ATTR } from 'modules/router/orbit-protocol.ts'
import { loadRoutes, Page, SpacePageController } from 'modules/router/mod.ts'
import { mockHandlerContext } from 'modules/testing/mod.ts'
import { setCssManifest } from 'modules/render/css-manifest.ts'
import { setPwaConfig } from 'modules/pwa/pwa-registry.ts'
import { extractFragmentTitle } from 'modules/client/orbit.ts'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'

function Greeting() {
  return <p>hello</p>
}

@Page('orbit-fragment-fixture')
class OrbitFragmentPage extends SpacePageController {
  public static override cacheControl = 'public, max-age=60'
  public override component = Greeting
}
void OrbitFragmentPage

@Page('orbit-fragment-head-fixture')
class OrbitFragmentHeadPage extends SpacePageController {
  public override component = Greeting
  public static override head = { title: 'Fragment Fixture Title' }
}
void OrbitFragmentHeadPage

Deno.test(
  "Orbit fragment negotiation: the same route serves a full document normally, and just the outlet's content for an Orbit request",
  async () => {
    const servers = await bootstrapServers({ ssr: { port: 20801 } })
    try {
      const fullRes = await fetch(
        'http://localhost:20801/orbit-fragment-fixture',
      )
      const fullHtml = stripHydrationComments(await fullRes.text())
      assert(fullHtml.startsWith('<!DOCTYPE html>'), fullHtml)
      assert(fullHtml.includes(`${ORBIT_OUTLET_ATTR}=""`), fullHtml)
      // display:contents so the outlet never breaks a root layout's own grid/flex layout.
      assert(fullHtml.includes('style="display:contents"'), fullHtml)
      assert(fullHtml.includes('<p>hello</p>'), fullHtml)
      // The full response is cacheable — its ETag varies by this same header, per the response.
      assertEquals(fullRes.headers.get('vary'), ORBIT_FRAGMENT_HEADER)

      const fragmentRes = await fetch(
        'http://localhost:20801/orbit-fragment-fixture',
        {
          headers: { [ORBIT_FRAGMENT_HEADER]: '1' },
        },
      )
      const fragmentHtml = stripHydrationComments(await fragmentRes.text())
      assert(!fragmentHtml.includes('<!DOCTYPE html>'), fragmentHtml)
      assert(!fragmentHtml.includes('<html'), fragmentHtml)
      assert(fragmentHtml.includes(`${ORBIT_OUTLET_ATTR}=""`), fragmentHtml)
      assert(fragmentHtml.includes('<p>hello</p>'), fragmentHtml)
      assertEquals(fragmentRes.headers.get('vary'), ORBIT_FRAGMENT_HEADER)

      // Both responses carry the exact same ETag — a fragment's content is a subset of the full
      // document's, but both derive it from the same loader data (there's no loader here, so both
      // hash the same `undefined`).
      assertEquals(
        fullRes.headers.get('etag'),
        fragmentRes.headers.get('etag'),
      )
    } finally {
      await webServerManager.stop(servers)
    }
  },
)

Deno.test(
  'Orbit fragment negotiation: Vary is set even for a page with no cacheControl — the body ' +
    'shape still depends on ORBIT_FRAGMENT_HEADER regardless of caching config',
  async () => {
    const page = new OrbitFragmentHeadPage(mockHandlerContext())

    const fullResponse = await page.handleGet(mockHandlerContext())
    assertEquals(fullResponse.headers.get('vary'), ORBIT_FRAGMENT_HEADER)

    const fragmentResponse = await page.handleGet(
      mockHandlerContext({
        req: new Request('http://localhost/', {
          headers: { [ORBIT_FRAGMENT_HEADER]: '1' },
        }),
      }),
    )
    assertEquals(fragmentResponse.headers.get('vary'), ORBIT_FRAGMENT_HEADER)
  },
)

Deno.test(
  'Orbit fragment negotiation: a full document links its built stylesheet(s); a fragment omits ' +
    'them entirely, since its styles are already loaded on the page it swaps into',
  async () => {
    setCssManifest({ global: ['/assets/app-hash123.css'] })
    try {
      const page = new OrbitFragmentPage(mockHandlerContext())

      const fullResponse = await page.handleGet(mockHandlerContext())
      const fullHtml = await fullResponse.text()
      assert(
        fullHtml.includes(
          '<link rel="stylesheet" href="/assets/app-hash123.css"',
        ),
        fullHtml,
      )

      const fragmentResponse = await page.handleGet(
        mockHandlerContext({
          req: new Request('http://localhost/', {
            headers: { [ORBIT_FRAGMENT_HEADER]: '1' },
          }),
        }),
      )
      const fragmentHtml = await fragmentResponse.text()
      assert(!fragmentHtml.includes('stylesheet'), fragmentHtml)
    } finally {
      setCssManifest(undefined)
    }
  },
)

Deno.test(
  'Orbit fragment negotiation: a full document links the manifest + theme-color when a PWA is ' +
    'configured; a fragment omits both, since they are page-independent',
  async () => {
    setPwaConfig({
      name: 'Storefront',
      themeColor: '#2563eb',
      icon: '/tmp/icon.png',
    })
    try {
      const page = new OrbitFragmentPage(mockHandlerContext())

      const fullResponse = await page.handleGet(mockHandlerContext())
      const fullHtml = await fullResponse.text()
      assert(
        fullHtml.includes('<link rel="manifest" href="/manifest.webmanifest"'),
        fullHtml,
      )
      assert(
        fullHtml.includes('<meta name="theme-color" content="#2563eb"'),
        fullHtml,
      )

      const fragmentResponse = await page.handleGet(
        mockHandlerContext({
          req: new Request('http://localhost/', {
            headers: { [ORBIT_FRAGMENT_HEADER]: '1' },
          }),
        }),
      )
      const fragmentHtml = await fragmentResponse.text()
      assert(!fragmentHtml.includes('manifest'), fragmentHtml)
      assert(!fragmentHtml.includes('theme-color'), fragmentHtml)
    } finally {
      setPwaConfig(undefined)
    }
  },
)

Deno.test(
  "Orbit fragment negotiation: a root layout's header/footer stay outside the outlet marker",
  async () => {
    await loadRoutes('src/@tests/support/fixtures/not-found-routes')

    const servers = await bootstrapServers({ ssr: { port: 20802 } })
    try {
      const fragmentRes = await fetch(
        'http://localhost:20802/not-found-fixture',
        {
          headers: { [ORBIT_FRAGMENT_HEADER]: '1' },
        },
      )
      const html = stripHydrationComments(await fragmentRes.text())
      assert(!html.includes('data-testid="app-shell"'), html)
      assert(html.includes(`${ORBIT_OUTLET_ATTR}=""`), html)
      assert(html.includes('home'), html)
    } finally {
      await webServerManager.stop(servers)
    }
  },
)

Deno.test(
  "Orbit fragment negotiation: a page's resolved head title round-trips through the REAL " +
    'client-side extractFragmentTitle (modules/client/orbit.ts) — server emits it, the exact ' +
    'same function Orbit itself calls on every navigation correctly extracts AND strips it, ' +
    "proving this package's new head-management feature is actually compatible with Orbit's " +
    'own already-existing title sync, not just superficially similar',
  async () => {
    const page = new OrbitFragmentHeadPage(mockHandlerContext())

    const fragmentResponse = await page.handleGet(
      mockHandlerContext({
        req: new Request('http://localhost/', {
          headers: { [ORBIT_FRAGMENT_HEADER]: '1' },
        }),
      }),
    )
    const fragmentHtml = await fragmentResponse.text()

    const { title, body } = extractFragmentTitle(fragmentHtml)
    assertEquals(title, 'Fragment Fixture Title')
    assert(!body.includes('<title'), body)
    assert(body.includes('<p>hello</p>'), body)
  },
)
