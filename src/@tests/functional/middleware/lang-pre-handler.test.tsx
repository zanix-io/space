// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { Page, SpacePageController } from 'modules/router/mod.ts'
import { langPreHandler } from 'modules/middleware/mod.ts'

function ProductsView({ lang }: { lang?: string }) {
  return <p>{`lang: ${lang ?? 'none'}`}</p>
}

@Page({ path: ':lang/products', headers: false })
class ProductsPage extends SpacePageController {
  public override loader = (ctx: { params: { lang?: string } }) => ({ lang: ctx.params.lang })
  public override component = ProductsView
}
void ProductsPage

Deno.test(
  'langPreHandler end to end: an un-prefixed request 301-redirects before the route ever matches, ' +
    'a prefixed one reaches the real page, and framework routes are untouched',
  async () => {
    const servers = await bootstrapServers({
      ssr: {
        port: 20506,
        preHandler: langPreHandler({ availableLangs: ['en', 'es'], defaultLang: 'en' }),
      },
    })
    try {
      // No lang prefix: redirected before any route (including the health check below) could
      // have mattered — `manual` redirect mode so we can inspect the 301 instead of following it.
      const bare = await fetch('http://localhost:20506/products', { redirect: 'manual' })
      assertEquals(bare.status, 301)
      assertEquals(bare.headers.get('location'), 'http://localhost:20506/en/products')
      await bare.body?.cancel()

      // Already prefixed: falls through, the real page renders.
      const prefixed = await fetch('http://localhost:20506/en/products')
      assertEquals(prefixed.status, 200)
      assert((await prefixed.text()).includes('lang: en'))

      // A framework-internal route is never redirected, even with no lang prefix of its own.
      const health = await fetch('http://localhost:20506/health', { redirect: 'manual' })
      assertEquals(health.status, 200)
    } finally {
      await webServerManager.stop(servers)
    }
  },
)
