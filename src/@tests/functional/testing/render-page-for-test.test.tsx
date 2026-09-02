// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { createElement as preactElement } from 'preact'
import type { ComponentType as PreactComponentType } from 'preact'
import type { ZanixInteractor } from '@zanix/server'
import { SpacePageController } from 'modules/router/mod.ts'
import { renderPageForTest } from 'modules/testing/mod.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { getPageRenderer, setPageRenderer } from 'modules/router/page-renderer-registry.ts'
import { renderPageResponse as renderPageResponsePreact } from 'modules/router/render-page-preact.ts'

type ProductParams = { id: string }

function ProductView({ id }: { id: string }) {
  return <p data-testid='product-id'>{id}</p>
}

class ProductPage extends SpacePageController<ProductParams> {
  public override loader = (ctx: { params: ProductParams }) => ({
    id: ctx.params.id,
  })
  public override component = ProductView
}

Deno.test(
  'renderPageForTest: runs the real loader→component pipeline and returns matching response/html',
  async () => {
    const { response, html } = await renderPageForTest(ProductPage, {
      id: '42',
    })

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

// A Preact page, declared exactly as `SpacePageController`'s own doc says a `--renderer=preact`
// page declares itself: naming Preact's own `ComponentType` as the third type argument. This used
// not to compile at the `renderPageForTest` call below — the helper pinned that argument to the
// class's own React default, so the ONE public API for testing a page rejected every Preact page,
// even though the runtime it drives (`getPageRenderer()`) is renderer-neutral by construction.
const PreactProductView: PreactComponentType<{ id: string }> = ({ id }) =>
  preactElement('p', { 'data-testid': 'preact-product-id' }, id)

class PreactProductPage
  extends SpacePageController<ProductParams, never, PreactComponentType<{ id: string }>> {
  public override loader = (ctx: { params: ProductParams }) => ({ id: ctx.params.id })
  public override component = PreactProductView
}

Deno.test(
  'renderPageForTest: renders a --renderer=preact page through the real Preact page renderer — ' +
    'the helper is renderer-neutral in its signature, not just in its runtime',
  async () => {
    const previousRenderer = getPageRenderer()
    setActiveRenderer('preact')
    setPageRenderer(renderPageResponsePreact)
    try {
      // No cast on `PreactProductPage` — that is the regression this pins.
      const { response, html } = await renderPageForTest(PreactProductPage, { id: '7' })

      assertEquals(response.status, 200)
      assert(html.includes('data-testid="preact-product-id"'), html)
      assert(html.includes('7'), html)
    } finally {
      setPageRenderer(previousRenderer)
      setActiveRenderer('react')
    }
  },
)

class InteractorProductPage extends SpacePageController<ProductParams, ZanixInteractor> {
  public override loader = (ctx: { params: ProductParams }) => ({ id: ctx.params.id })
  public override component = ProductView
}

Deno.test(
  'renderPageForTest: accepts a page declaring a real Interactor generic — no cast needed',
  async () => {
    // No cast on `InteractorProductPage` — that is the regression this pins.
    const { response, html } = await renderPageForTest(InteractorProductPage, { id: '99' })

    assertEquals(response.status, 200)
    assert(html.includes('data-testid="product-id"'), html)
    assert(html.includes('99'), html)
  },
)
