// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { Page, SpacePageController } from 'modules/router/mod.ts'

function View({ lang }: { lang?: string }) {
  return <p>{`lang: ${lang ?? 'none'}`}</p>
}

@Page({ path: ':lang', headers: false })
class DynamicPage extends SpacePageController {
  public override loader = (ctx: { params: { lang?: string } }) => ({ lang: ctx.params.lang })
  public override component = View
}
void DynamicPage

Deno.test(
  'without langPreHandler there is no language registry: a ":lang" param is any value and renders',
  async () => {
    const servers = await bootstrapServers({ ssr: { port: 20510 } })
    try {
      const res = await fetch('http://localhost:20510/anything')
      assertEquals(res.status, 200)
      assert((await res.text()).includes('lang: anything'))
    } finally {
      await webServerManager.stop(servers)
    }
  },
)
