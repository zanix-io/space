// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { Page, SpacePageController } from 'modules/router/mod.ts'
import { buildCanonicalLink } from 'modules/seo/canonical.ts'
import { buildHreflangLinks } from 'modules/seo/hreflang.ts'
import type { HeadLinkTag } from 'modules/router/mod.ts'

console.error = () => {}

function ProductView() {
  return <p>product</p>
}

type LoaderData = { link: HeadLinkTag[] }

@Page({ path: ':lang/hreflang-e2e/products', headers: false })
class ProductsPage extends SpacePageController<{ lang: string }> {
  public override loader = (ctx: { url: URL; params: { lang: string } }): LoaderData => ({
    link: [
      ...buildHreflangLinks({
        url: ctx.url,
        lang: ctx.params.lang,
        availableLangs: ['en', 'es'],
        defaultLang: 'en',
      }),
      buildCanonicalLink({ url: ctx.url }),
    ],
  })
  public static override head = (data: LoaderData) => ({ link: data.link })
  public override component = ProductView
}
void ProductsPage

Deno.test(
  'buildHreflangLinks/buildCanonicalLink end to end: real <link> tags in a real SSR response, ' +
    "driven entirely through a page's own loader + static head, no new rendering machinery",
  async () => {
    const servers = await bootstrapServers({ ssr: { port: 22203 } })
    try {
      const res = await fetch(
        'http://localhost:22203/en/hreflang-e2e/products?utm_source=newsletter',
      )
      assertEquals(res.status, 200)
      const html = await res.text()

      assert(
        html.includes(
          '<link rel="alternate" hreflang="en" href="http://localhost:22203/en/hreflang-e2e/products"',
        ),
        html,
      )
      assert(
        html.includes(
          '<link rel="alternate" hreflang="es" href="http://localhost:22203/es/hreflang-e2e/products"',
        ),
        html,
      )
      assert(
        html.includes(
          '<link rel="alternate" hreflang="x-default" href="http://localhost:22203/en/hreflang-e2e/products"',
        ),
        html,
      )
      // The canonical link drops the query string (?utm_source=newsletter).
      assert(
        html.includes(
          '<link rel="canonical" href="http://localhost:22203/en/hreflang-e2e/products"',
        ),
        html,
      )
    } finally {
      await webServerManager.stop(servers)
    }
  },
)
