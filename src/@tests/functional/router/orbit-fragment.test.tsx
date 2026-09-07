// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals, assertFalse, assertMatch } from '@std/assert'
import { Suspense, use } from 'react'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { ORBIT_FRAGMENT_HEADER, ORBIT_OUTLET_ATTR } from 'modules/router/orbit-protocol.ts'
import { loadRoutes, Page, SpacePageController } from 'modules/router/mod.ts'
import { mockHandlerContext } from 'modules/testing/mod.ts'
import { setCssManifest } from 'modules/render/css-manifest.ts'
import { BUILTIN_CSS } from 'modules/render/builtin-css.ts'
import { setPwaConfig } from 'modules/pwa/pwa-registry.ts'
import { extractFragmentTitle } from 'modules/client/orbit.ts'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'

function Greeting() {
  return <p>hello</p>
}

/** Genuinely suspends (a real `use()` over a real pending promise) long enough that at least one
 * sibling boundary's own content already flushed first — the real shape that produces React's own
 * streaming placeholder (`<template id="B:n">`) plus its later `$RC`/`$RB` reveal script, not just
 * a same-tick resolution `renderToResponse` would inline directly with no script at all. */
function Delayed({ ms, id }: { ms: number; id: string }) {
  const value = use(new Promise<string>((resolve) => setTimeout(() => resolve('ready'), ms)))
  return <p id={id}>{value}</p>
}

function StreamingPage() {
  return (
    <div>
      <Suspense fallback={<p>loading a</p>}>
        <Delayed ms={10} id='a' />
      </Suspense>
      <Suspense fallback={<p>loading b</p>}>
        <Delayed ms={30} id='b' />
      </Suspense>
    </div>
  )
}

@Page('orbit-fragment-streaming-fixture')
class OrbitFragmentStreamingPage extends SpacePageController {
  public override component = StreamingPage
}
void OrbitFragmentStreamingPage

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
      // display:contents comes from the built-in stylesheet rule, never an inline style
      // attribute (a strict style-src with no unsafe-inline silently drops those).
      assert(fullHtml.includes(BUILTIN_CSS), fullHtml)
      assertFalse(fullHtml.includes('style="display:contents"'), fullHtml)
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

Deno.test(
  "Orbit fragment negotiation: a fragment's own streaming Suspense reveal script (React's `$RC`) " +
    "carries the SAME nonce as that exact response's own Content-Security-Policy header — a real, " +
    "reproduced regression otherwise: orbit.ts's own reviveFragmentScripts only revives a script " +
    "whose nonce matches the fragment's own header, so a reveal script with no nonce at all (what " +
    'a fragment render produces if its own nonce is never threaded through, unlike a full ' +
    "document's) is silently rejected and never runs — the boundary it belongs to stays an inert, " +
    'hidden placeholder forever, with no error anywhere and a normal 200 response',
  async () => {
    const page = new OrbitFragmentStreamingPage(mockHandlerContext())

    const fragmentResponse = await page.handleGet(
      mockHandlerContext({
        req: new Request('http://localhost/', {
          headers: { [ORBIT_FRAGMENT_HEADER]: '1' },
        }),
      }),
    )
    const csp = fragmentResponse.headers.get('Content-Security-Policy')
    assert(csp, 'expected a Content-Security-Policy header on the fragment response too')
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1]
    assert(nonce, 'expected to extract a nonce from the fragment CSP header')

    const html = await fragmentResponse.text()
    // Both boundaries resolve inside the buffered fragment body regardless of streaming shape
    // (`response.text()` only ever returns once the whole stream ends) — the real question is
    // whether React's OWN reveal-machinery scripts, if this page's streaming shape produced any,
    // carry the matching nonce. `data-testid`-free plain `<script>` tags with no `nonce` attribute
    // at all would mean the regression is back.
    assert(html.includes('id="a">ready'), html)
    assert(html.includes('id="b">ready'), html)
    // At least one real inline `<script>` must carry the matching nonce — never zero. A reveal
    // script with NO `nonce` attribute at all (this file's own `matchAll` below still finds the
    // `<script>` tag itself, just without a nonce to check) is exactly what the regression looked
    // like: present in the body, silently rejected client-side, never asserted as a hard failure
    // by a check that only verifies nonce VALUES it happens to find rather than requiring one.
    let noncedScriptCount = 0
    for (const scriptTag of html.matchAll(/<script(\s[^>]*)?>/g)) {
      const attrs = scriptTag[1] ?? ''
      assert(attrs.includes('nonce='), `expected every inline <script> to carry a nonce: ${attrs}`)
      assertMatch(attrs, new RegExp(`\\bnonce="${nonce}"`))
      noncedScriptCount++
    }
    assert(noncedScriptCount > 0, `expected at least one inline <script> in the fragment: ${html}`)
  },
)
