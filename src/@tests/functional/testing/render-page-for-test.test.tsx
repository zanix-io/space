import { assert, assertEquals } from '@std/assert'
import { SpacePageController } from 'modules/router/mod.ts'
import { renderPageForTest } from 'modules/testing/mod.ts'

type ProductParams = { id: string }

function ProductView({ id }: { id: string }) {
  return <p data-testid='product-id'>{id}</p>
}

class ProductPage extends SpacePageController<ProductParams> {
  public override loader = (ctx: { params: ProductParams }) => ({ id: ctx.params.id })
  public override component = ProductView
}

Deno.test(
  'renderPageForTest: runs the real loader→component pipeline and returns matching response/html',
  async () => {
    const { response, html } = await renderPageForTest(ProductPage, { id: '42' })

    assertEquals(response.status, 200)
    assert(html.includes('data-testid="product-id"'), html)
    assert(html.includes('42'), html)
  },
)

Deno.test(
  'renderPageForTest: params flow through to the loader exactly as passed, not just hardcoded content',
  async () => {
    const first = await renderPageForTest(ProductPage, { id: 'abc' })
    const second = await renderPageForTest(ProductPage, { id: 'xyz' })

    assert(first.html.includes('abc'), first.html)
    assert(!first.html.includes('xyz'), first.html)
    assert(second.html.includes('xyz'), second.html)
    assert(!second.html.includes('abc'), second.html)
  },
)

Deno.test(
  'renderPageForTest: defaults params to {} when omitted, so a page with no dynamic segments still renders',
  async () => {
    class StaticPage extends SpacePageController {
      public override component = () => <p data-testid='static'>static</p>
    }

    const { response, html } = await renderPageForTest(StaticPage)
    assertEquals(response.status, 200)
    assert(html.includes('data-testid="static"'), html)
  },
)
