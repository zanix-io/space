// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { Page, SpacePageController } from 'modules/router/mod.ts'
import { langPreHandler } from 'modules/middleware/mod.ts'

let loaderRuns = 0

function HomeView({ lang }: { lang?: string }) {
  return <p>{`home lang: ${lang ?? 'none'}`}</p>
}

// The shape of a real consumer: a top-level `routes/[lang]/page` plus a nested one.
@Page({ path: ':lang', headers: false })
class HomePage extends SpacePageController {
  public override loader = (ctx: { params: { lang?: string } }) => {
    loaderRuns++
    return { lang: ctx.params.lang }
  }
  public override component = HomeView
}
void HomePage

@Page({ path: ':lang/products', headers: false })
class ProductsPage extends SpacePageController {
  public override loader = (ctx: { params: { lang?: string } }) => ({ lang: ctx.params.lang })
  public override component = HomeView
}
void ProductsPage

Deno.test(
  'a framework path the app never registered answers 404, not the [lang] page nor a 500; ' +
    'real language URLs keep working',
  async () => {
    const servers = await bootstrapServers({
      ssr: {
        port: 20509,
        preHandler: langPreHandler({ availableLangs: ['en', 'es'], defaultLang: 'en' }),
      },
    })
    try {
      const paths = ['/manifest.webmanifest', '/sw.js', '/robots.txt']
      const responses = await Promise.all(
        paths.map((path) => fetch(`http://localhost:20509${path}`, { redirect: 'manual' })),
      )
      for (const [index, res] of responses.entries()) {
        const path = paths[index]
        assertEquals(res.status, 404, path)
        // The app's not-found document, not a bare error body.
        assert((res.headers.get('content-type') ?? '').includes('text/html'), path)
        // The garbage segment is never persisted as the language cookie.
        assertEquals(res.headers.get('set-cookie'), null, path)
      }
      await Promise.all(responses.map((res) => res.body?.cancel()))
      assertEquals(loaderRuns, 0)

      const home = await fetch('http://localhost:20509/es')
      assertEquals(home.status, 200)
      assert((await home.text()).includes('home lang: es'))
      assertEquals(loaderRuns, 1)

      const nested = await fetch('http://localhost:20509/en/products')
      assertEquals(nested.status, 200)
      assert((await nested.text()).includes('home lang: en'))

      const post = await fetch('http://localhost:20509/robots.txt', { method: 'POST' })
      assertEquals(post.status, 404)
      await post.body?.cancel()
    } finally {
      await webServerManager.stop(servers)
    }
  },
)
