import { assert, assertEquals, assertFalse } from '@std/assert'
import { createElement } from 'preact'
import { BUILTIN_CSS } from 'modules/render/builtin-css.ts'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { ORBIT_FRAGMENT_HEADER, ORBIT_OUTLET_ATTR } from 'modules/router/orbit-protocol.ts'
import { Page, SpacePageController } from 'modules/router/mod.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { setPageRenderer } from 'modules/router/page-renderer-registry.ts'
import { renderPageResponse as renderPageResponsePreact } from 'modules/router/render-page-preact.ts'
import { renderPageResponse as renderPageResponseReact } from 'modules/router/render-page-react.tsx'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'

console.error = () => {}

function Greeting() {
  return createElement('p', null, 'hello')
}

@Page('orbit-fragment-preact-fixture')
class OrbitFragmentPreactPage extends SpacePageController {
  public override component = Greeting
}
void OrbitFragmentPreactPage

/**
 * Preact counterpart of `orbit-fragment.test.tsx`'s first test (React) — same real HTTP contract
 * (`bootstrapServers` + real `fetch`, both a full document and an Orbit-fragment request against
 * the same route), proving the fragment/full-document negotiation is genuinely renderer-agnostic
 * at the HTTP level, not something only ever exercised through React.
 *
 * `setActiveRenderer('preact')` alone does NOT make `SpacePageController.handleGet` actually
 * render through Preact — confirmed empirically elsewhere in this suite
 * (`hreflang-canonical-preact.test.tsx`'s own doc comment: an earlier attempt using
 * `bootstrapServers` + `setActiveRenderer('preact')` came back as a REAL React-rendered 500). The
 * real seam `handleGet` calls through is `page-renderer-registry.ts`'s `getPageRenderer()`, wired
 * by `defineSpaceApp({ renderer: 'preact' })`'s own `setup(ctx)` via `setPageRenderer(...)` — so
 * this test wires that registry directly, the same two calls `defineSpaceApp` itself makes
 * (`setActiveRenderer('preact')` + `setPageRenderer(renderPageResponsePreact)`), without pulling in
 * the rest of `defineSpaceApp`'s own setup semantics this test has no need for.
 */
Deno.test(
  'Orbit fragment negotiation (Preact): the same route serves a full document normally, and just the outlet content for an Orbit request, through the REAL Preact renderer',
  async () => {
    setActiveRenderer('preact')
    setPageRenderer(renderPageResponsePreact)

    const servers = await bootstrapServers({ ssr: { port: 20811 } })
    try {
      const fullRes = await fetch(
        'http://localhost:20811/orbit-fragment-preact-fixture',
      )
      const fullHtml = stripHydrationComments(await fullRes.text())
      // Preact's own doctype prefix is lowercase (`render-to-response-preact.ts`'s own
      // `<!doctype html>` literal) — deliberately distinct from React's uppercase
      // `<!DOCTYPE html>` (`document-shell.tsx`), so this assertion is renderer-accurate, not just
      // copy-pasted from the React test.
      assert(fullHtml.startsWith('<!doctype html>'), fullHtml)
      // `preact-render-to-string` serializes an empty-string attribute value as a bare attribute
      // name (`data-space-outlet`), not `data-space-outlet=""` like React's own serializer —
      // confirmed empirically against the real response, not assumed from the React test's own
      // assertion shape.
      assert(fullHtml.includes(ORBIT_OUTLET_ATTR), fullHtml)
      // display:contents comes from the built-in stylesheet rule, never an inline style
      // attribute (a strict style-src with no unsafe-inline silently drops those).
      assert(fullHtml.includes(BUILTIN_CSS), fullHtml)
      assertFalse(fullHtml.includes('style="display:contents"'), fullHtml)
      assert(fullHtml.includes('<p>hello</p>'), fullHtml)
      assertEquals(fullRes.headers.get('vary'), ORBIT_FRAGMENT_HEADER)

      const fragmentRes = await fetch(
        'http://localhost:20811/orbit-fragment-preact-fixture',
        {
          headers: { [ORBIT_FRAGMENT_HEADER]: '1' },
        },
      )
      const fragmentHtml = stripHydrationComments(await fragmentRes.text())
      assert(!fragmentHtml.includes('<!doctype html>'), fragmentHtml)
      assert(!fragmentHtml.includes('<html'), fragmentHtml)
      assert(fragmentHtml.includes(ORBIT_OUTLET_ATTR), fragmentHtml)
      assert(fragmentHtml.includes('<p>hello</p>'), fragmentHtml)
      assertEquals(fragmentRes.headers.get('vary'), ORBIT_FRAGMENT_HEADER)

      // Same identity as the React test: both responses derive their ETag from the same (absent)
      // loader data, so they must match — proving the fragment/full-document split doesn't affect
      // caching semantics for Preact either.
      assertEquals(
        fullRes.headers.get('etag'),
        fragmentRes.headers.get('etag'),
      )
    } finally {
      setActiveRenderer('react')
      setPageRenderer(renderPageResponseReact)
      await webServerManager.stop(servers)
    }
  },
)
