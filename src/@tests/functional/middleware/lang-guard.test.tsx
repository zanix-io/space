// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { bootstrapServers, Guard, webServerManager } from '@zanix/server'
import { Page, SpacePageController } from 'modules/router/mod.ts'
import { langGuard, populationGuard } from 'modules/middleware/mod.ts'

function ProductsView({ lang, population }: { lang?: string; population?: string }) {
  // A single interpolated string — see population-guard.test.tsx for why (React inserts an HTML
  // comment between adjacent text/expression children that would split a substring assertion).
  return <p>{`lang: ${lang ?? 'none'} | population: ${population ?? 'none'}`}</p>
}

@Page({ path: ':lang/lang-guard/products', headers: false })
@Guard(langGuard())
class ProductsPage extends SpacePageController {
  public override loader = (ctx: { params: { lang?: string } }) => ({ lang: ctx.params.lang })
  public override component = ProductsView
}
void ProductsPage

// Both guards run on the same route, each independently issuing their own `Set-Cookie` — the real
// scenario the `@zanix/server` `mainGuard` fix (Headers-based accumulation instead of an
// object-spread that clobbered same-name headers) exists for.
@Page({ path: ':lang/lang-guard/composed/products', headers: false })
@Guard(langGuard())
@Guard(populationGuard())
class ComposedProductsPage extends SpacePageController {
  public override loader = (ctx: { params: { lang?: string }; population?: string }) => ({
    lang: ctx.params.lang,
    population: ctx.population,
  })
  public override component = ProductsView
}
void ComposedProductsPage

// One `bootstrapServers()`/one Deno.test, several fetches against the SAME running server — same
// structure `population-guard.test.tsx`/`csrf-guard.test.tsx` already use, for the same reason
// (`@Page()`'s registration only runs once at module-eval time).
Deno.test(
  'langGuard end to end: refreshes a stale cookie on an already-prefixed request, and coexists ' +
    "with populationGuard's own Set-Cookie on the same route without either clobbering the other",
  async () => {
    const servers = await bootstrapServers({ ssr: { port: 20507 } })
    try {
      // A stale `en` cookie visiting an `/es/...` URL directly (no redirect involved at all,
      // exactly the case langPreHandler alone can't cover) gets refreshed to `es`.
      const staleRes = await fetch('http://localhost:20507/es/lang-guard/products', {
        headers: { cookie: 'X-Znx-Lang=en' },
      })
      const setCookie = staleRes.headers.get('set-cookie')
      assert(setCookie, 'expected langGuard to refresh the stale cookie')
      assert(setCookie.includes('X-Znx-Lang=es'))
      assert((await staleRes.text()).includes('lang: es'))

      // Already matching the cookie: no re-issued Set-Cookie.
      const freshRes = await fetch('http://localhost:20507/es/lang-guard/products', {
        headers: { cookie: 'X-Znx-Lang=es' },
      })
      assertEquals(freshRes.headers.get('set-cookie'), null)

      // Both guards on the same route each set their own cookie — both must survive on the wire,
      // as SEPARATE `Set-Cookie` headers, not one overwriting the other.
      const composedRes = await fetch(
        'http://localhost:20507/es/lang-guard/composed/products?population=zanix',
        { headers: { cookie: 'X-Znx-Lang=en' } },
      )
      const allCookies = composedRes.headers.getSetCookie()
      assertEquals(allCookies.length, 2)
      assert(allCookies.some((c) => c.includes('X-Znx-Lang=es')))
      assert(allCookies.some((c) => c.includes('X-Znx-Population=zanix')))
      const body = await composedRes.text()
      assert(body.includes('lang: es'))
      assert(body.includes('population: zanix'))
    } finally {
      await webServerManager.stop(servers)
    }
  },
)
