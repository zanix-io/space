// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { bootstrapServers, Guard, webServerManager } from '@zanix/server'
import { Page, SpacePageController } from 'modules/router/mod.ts'
import { populationGuard } from 'modules/middleware/mod.ts'

function ProductsView({ population }: { population?: string }) {
  // A single interpolated string, not adjacent text+expression children — React's streaming
  // renderer inserts an HTML comment between sibling text nodes to preserve hydration boundaries,
  // which would otherwise split the literal substring these tests search for.
  return <p>{`population: ${population ?? 'none'}`}</p>
}

@Page({ path: 'population-guard/products', headers: false })
@Guard(populationGuard())
class ProductsPage extends SpacePageController {
  public override loader = (ctx: { population?: string }) => ({ population: ctx.population })
  public override component = ProductsView
}
void ProductsPage

@Page({ path: 'population-guard/:population/products', headers: false })
@Guard(populationGuard())
class ProductsByParamPage extends SpacePageController {
  public override loader = (ctx: { population?: string }) => ({ population: ctx.population })
  public override component = ProductsView
}
void ProductsByParamPage

// One `bootstrapServers()`/one Deno.test, several fetches against the SAME running server —
// mirrors `csrf-guard.test.tsx`'s own structure. `@Page()`'s class-decorator registration runs
// once at module-eval time (not a plain, re-callable function — see the architecture guidance on
// registration functions), and `bootstrapServers()`'s own route registry is wiped on every
// finalized boot cycle; a SECOND `bootstrapServers()` call in this same process would find no
// routes left to serve, since the decorators that registered them never re-run.
Deno.test(
  'populationGuard end to end: query string, route param, cookie, and the no-signal fallback',
  async () => {
    const servers = await bootstrapServers({ ssr: { port: 20502 } })
    try {
      // Query string resolves it and persists it to a cookie.
      const queryRes = await fetch(
        'http://localhost:20502/population-guard/products?population=zanix',
      )
      const setCookie = queryRes.headers.get('set-cookie')
      assert(setCookie, 'expected populationGuard to issue a Set-Cookie')
      assert(setCookie.includes('X-Znx-Population=zanix'))
      assert(setCookie.includes('SameSite=Lax'))
      assertEquals(setCookie.includes('HttpOnly'), false)
      assert((await queryRes.text()).includes('population: zanix'))

      // A route param resolves it exactly the same way.
      const paramRes = await fetch('http://localhost:20502/population-guard/zanix/products')
      assert((await paramRes.text()).includes('population: zanix'))

      // With only the cookie (no param, no query), the very first SSR response already has the
      // right population — no second round trip, and no need to re-issue the same cookie.
      const cookieRes = await fetch('http://localhost:20502/population-guard/products', {
        headers: { cookie: 'X-Znx-Population=zanix' },
      })
      assertEquals(cookieRes.headers.get('set-cookie'), null)
      assert((await cookieRes.text()).includes('population: zanix'))

      // With no param, query, or cookie at all, the page still renders normally.
      const bareRes = await fetch('http://localhost:20502/population-guard/products')
      assertEquals(bareRes.status, 200)
      assertEquals(bareRes.headers.get('set-cookie'), null)
      assert((await bareRes.text()).includes('population: none'))
    } finally {
      await webServerManager.stop(servers)
    }
  },
)
