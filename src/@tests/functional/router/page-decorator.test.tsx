import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import { InternalError } from '@zanix/errors'
import {
  bootstrapServers,
  Interactor,
  Provider,
  registerCoreProviderSlot,
  webServerManager,
  ZanixCacheProvider,
  ZanixInteractor,
  ZanixSsrController,
} from '@zanix/server'
import { Page, SpacePageController } from 'modules/router/mod.ts'

function View() {
  return <div>ok</div>
}

Deno.test('Page: a page with no action is reachable via GET but not POST', async () => {
  @Page('page-decorator/get-only')
  class GetOnlyPage extends SpacePageController {
    public override component = View
  }
  void GetOnlyPage

  const servers = await bootstrapServers({ ssr: { port: 20301 } })
  try {
    const getRes = await fetch('http://localhost:20301/page-decorator/get-only')
    assertEquals(getRes.status, 200)
    await getRes.body?.cancel()

    const postRes = await fetch('http://localhost:20301/page-decorator/get-only', {
      method: 'POST',
    })
    // The path IS registered (for GET) — a POST to it is a wrong method, not an unknown route.
    assertEquals(postRes.status, 405)
    await postRes.body?.cancel()
  } finally {
    await webServerManager.stop(servers)
  }
})

Deno.test(
  'Page({headers: {csp: false}}): the options path disables CSP the same way as a static assignment',
  async () => {
    @Page({ path: 'page-decorator/no-csp-via-options', headers: { csp: false } })
    class NoCspViaOptions extends SpacePageController {
      public override component = View
    }
    void NoCspViaOptions

    const servers = await bootstrapServers({ ssr: { port: 20304 } })
    try {
      const res = await fetch('http://localhost:20304/page-decorator/no-csp-via-options')
      assertEquals(res.headers.get('Content-Security-Policy'), null)
      await res.body?.cancel()
    } finally {
      await webServerManager.stop(servers)
    }
  },
)

Deno.test('Page: a page with an action is also reachable via POST', async () => {
  @Page('page-decorator/with-action')
  class ActionPage extends SpacePageController {
    public override component = View
    public override action = () => Promise.resolve(new Response('action-ok'))
  }
  void ActionPage

  const servers = await bootstrapServers({ ssr: { port: 20302 } })
  try {
    const postRes = await fetch('http://localhost:20302/page-decorator/with-action', {
      method: 'POST',
    })
    assertEquals(await postRes.text(), 'action-ok')
  } finally {
    await webServerManager.stop(servers)
  }
})

Deno.test(
  "Page({ Interactor }): a page's loader resolves ZanixCacheProvider through its own " +
    "Interactor's this.cache, and getCachedOrRevalidate actually caches across requests",
  async () => {
    // A minimal, in-memory ZanixCacheProvider — just enough to prove the DI chain resolves and
    // the fetcher only runs on a cache miss, without needing a real Redis/local cache backend.
    class TestCacheProvider extends ZanixCacheProvider {
      #store = new Map<string, unknown>()
      public override getCachedOrRevalidate<V>(
        _provider: 'redis',
        key: string,
        options: { fetcher?: () => V | Promise<V> } = {},
      ): Promise<V> {
        if (this.#store.has(key)) return Promise.resolve(this.#store.get(key) as V)
        return Promise.resolve(options.fetcher?.()).then((value) => {
          this.#store.set(key, value)
          return value as V
        })
      }
    }
    registerCoreProviderSlot('cache', ZanixCacheProvider)
    Provider({ slot: 'cache' })(TestCacheProvider as never)

    let fetchCount = 0
    @Interactor()
    class ProductsInteractor extends ZanixInteractor {
      public getProduct(id: string) {
        return this.cache.getCachedOrRevalidate('redis', `product:${id}`, {
          fetcher: () => {
            fetchCount++
            return { id, name: `Product ${id}` }
          },
        })
      }
    }

    function ProductView({ product }: { product: { id: string; name: string } }) {
      return <p>{product.name}</p>
    }

    @Page({ path: 'page-decorator/cache-fixture/:id', Interactor: ProductsInteractor })
    class ProductPage extends SpacePageController<{ id: string }, ProductsInteractor> {
      public override loader = (ctx: { params: { id: string } }) =>
        this.interactor.getProduct(ctx.params.id).then((product) => ({ product }))
      public override component = ProductView
    }
    void ProductPage

    const servers = await bootstrapServers({ ssr: { port: 20303 } })
    try {
      const first = await fetch('http://localhost:20303/page-decorator/cache-fixture/42')
      assertStringIncludes(await first.text(), '<p>Product 42</p>')
      assertEquals(fetchCount, 1)

      // Second request, same id — served from TestCacheProvider's own store, fetcher not re-run.
      const second = await fetch('http://localhost:20303/page-decorator/cache-fixture/42')
      assertStringIncludes(await second.text(), '<p>Product 42</p>')
      assertEquals(fetchCount, 1)
    } finally {
      await webServerManager.stop(servers)
    }
  },
)

Deno.test("Page: throws if the class doesn't extend SpacePageController", () => {
  class NotAPage extends ZanixSsrController {}

  assertThrows(
    () => Page('bad')(NotAPage as never),
    InternalError,
    "The class 'NotAPage' is not a valid Page. Please extend SpacePageController",
  )
})
