import { assert, assertEquals } from '@std/assert'
import { createElement } from 'preact'
import { SpacePageController } from 'modules/router/mod.ts'
import { setPageTree } from 'modules/router/page-tree-registry.ts'
import { mockPageContext } from 'modules/testing/mod.ts'
import { renderPageResponse } from 'modules/router/render-page-preact.ts'
import { buildCanonicalLink } from 'modules/seo/canonical.ts'
import { buildHreflangLinks } from 'modules/seo/hreflang.ts'
import type { HeadLinkTag } from 'modules/router/mod.ts'

console.error = () => {}

// Preact counterpart of `hreflang-canonical.test.tsx` (React) — SAME `buildHreflangLinks`/
// `buildCanonicalLink` output, SAME collision scenario (current lang === default lang, so the
// `hreflang="en"` and `hreflang="x-default"` entries legitimately share one `href` — exactly the
// case the `rel+href+hreflang` dedup key fix in `head-descriptor.ts` exists for). `resolveHead`
// itself is already a pure, renderer-agnostic function shared by both renderers (proven by
// construction), so the collision-survives-dedup behavior is already covered by the unit test in
// `head-descriptor.test.ts`. What that test canNOT cover is the LAST, renderer-specific step: a
// resolved `HeadLinkTag` (built by `buildHreflangLinks`, keys in `rel, hreflang, href` order) gets
// spread onto a real element and serialized to a literal HTML string — `document-shell-preact.ts`
// for Preact, `render-to-response.tsx` for React — a different code path per renderer, each with
// its own attribute-serialization behavior. Uses `renderPageResponse`/`setPageTree` directly (the
// established pattern for this file's own Preact-path tests — see `render-page-preact.test.tsx`),
// not `bootstrapServers` over real HTTP: `setActiveRenderer('preact')` alone does not flip which
// `PageRenderer` `SpacePageController.handleGet` calls (that is `page-renderer-registry.ts`'s own
// `pageRenderer`, wired by `defineSpaceApp({ renderer: 'preact' })`, never by this package's own
// test suite) — confirmed empirically: an earlier version of this test used `bootstrapServers` +
// `setActiveRenderer('preact')` and the response came back as a REAL React-rendered 500, React's
// own `console.error` even printing "Invalid DOM property `hreflang`. Did you mean `hrefLang`?" —
// proof the render never actually reached Preact at all.
// The third type argument is how a Preact page declares its own renderer's component type — see
// `SpacePageController`'s own `TComponent` doc. Without it the class is checked against React's
// `ComponentType`, which a Preact page can never satisfy.
class HreflangPreactPage extends SpacePageController<{ lang: string }> {
  public override component = null
  public static override head = (data: { link: HeadLinkTag[] }) => ({ link: data.link })
}

Deno.test(
  'render-page-preact head: buildHreflangLinks/buildCanonicalLink real output, same collision ' +
    'scenario as the React e2e test (current lang === default lang, so hreflang="en" and ' +
    'hreflang="x-default" share one href) — both survive as their own literal <link> tag through ' +
    "Preact's own real render-to-string serialization, not just React's",
  async () => {
    function Ok() {
      return createElement('p', null, 'ok')
    }
    setPageTree(HreflangPreactPage, { filePath: '/fake/hreflang-preact.tsx', segments: [] })

    const url = new URL('http://localhost/en/products?utm_source=newsletter')
    const link: HeadLinkTag[] = [
      ...buildHreflangLinks({
        url,
        lang: 'en',
        availableLangs: ['en', 'es'],
        defaultLang: 'en',
      }),
      buildCanonicalLink({ url }),
    ]

    const pageCtx = mockPageContext({ url, params: { lang: 'en' } })
    const response = await renderPageResponse(
      HreflangPreactPage,
      Ok,
      pageCtx,
      { link },
      false,
      undefined,
      undefined,
    )
    const html = await response.text()

    assert(
      html.includes('<link rel="alternate" hreflang="en" href="http://localhost/en/products"'),
      html,
    )
    assert(
      html.includes('<link rel="alternate" hreflang="es" href="http://localhost/es/products"'),
      html,
    )
    // The collision case: same href as the "en" entry above, distinct hreflang — must survive as
    // its OWN literal tag, not get silently dropped by the dedup key (the bug looked like exactly
    // this before the fix: only one of these two would have made it into `resolved.link`).
    assert(
      html.includes(
        '<link rel="alternate" hreflang="x-default" href="http://localhost/en/products"',
      ),
      html,
    )
    const hreflangOccurrences = html.match(/hreflang="/g) ?? []
    assertEquals(hreflangOccurrences.length, 3, html)
    // The canonical link drops the query string (?utm_source=newsletter), same as under React.
    assert(html.includes('<link rel="canonical" href="http://localhost/en/products"'), html)
  },
)
