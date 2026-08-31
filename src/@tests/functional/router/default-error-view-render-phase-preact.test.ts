import { assert, assertEquals } from '@std/assert'
import '@zanix/space/preact'
import { SpacePageController } from 'modules/router/mod.ts'
import { setPageTree } from 'modules/router/page-tree-registry.ts'
import { mockPageContext } from 'modules/testing/mod.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { renderPageResponse } from 'modules/router/render-page-preact.ts'
import { ERROR_BOUNDARY_MODULE_ATTR } from 'modules/router/error-boundary-marker.ts'

// See `default-error-view-render-phase.test.tsx`'s own module doc (React's counterpart) for the
// full reasoning — split into its own file for the same reason every other renderer-specific test
// pair in this package is split.

console.error = () => {}

function BoomView(): never {
  throw new Error('fixture-render-boom-no-boundary-preact')
}

type Params = Record<string, never>
class BoomPage extends SpacePageController<Params> {
  public override component = BoomView
}

Deno.test(
  'composeSegments (preact): a render-phase throw with NO error.tsx anywhere renders ' +
    'DefaultErrorView for real (synchronous recovery, no postponed marker needed) — never the ' +
    'empty 500 this used to produce',
  async () => {
    setActiveRenderer('preact')
    setPageTree(BoomPage, { segments: [{}], filePath: '/fake/routes/page.tsx' })

    const response = await renderPageResponse(
      BoomPage,
      BoomView,
      mockPageContext({ params: {} }),
      undefined,
      false,
      undefined,
      undefined,
    )
    const html = await response.text()

    assertEquals(response.status, 200, html)
    assert(html.includes('data-space="error"'), html)
    assert(html.includes('Something went wrong'), html)
    assert(html.includes(`${ERROR_BOUNDARY_MODULE_ATTR}="`), html)
    assert(html.includes('default-error-view-preact.ts'), html)
  },
)
