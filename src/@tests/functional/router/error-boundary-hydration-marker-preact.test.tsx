import { assert, assertFalse } from '@std/assert'
import { createElement } from 'preact'
import '@zanix/space/preact'
import { SpacePageController } from 'modules/router/mod.ts'
import type { ErrorBoundaryProps } from 'typings/page.ts'
import { setPageTree } from 'modules/router/page-tree-registry.ts'
import { mockPageContext } from 'modules/testing/mod.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { renderPageResponse } from 'modules/router/render-page-preact.ts'
import {
  ERROR_BOUNDARY_MODULE_ATTR,
  ERROR_BOUNDARY_MSG_ATTR,
} from 'modules/router/error-boundary-marker.ts'

/**
 * Locks the Preact-specific half of the same contract `error-boundary-hydration-marker.test.tsx`
 * locks for React: the wrapper is added CONDITIONALLY here (only once `SpaceErrorBoundary`
 * actually caught something), unlike React's unconditional wrapper — see
 * `error-boundary-preact.ts`'s own doc for why this renderer CAN know in advance, every other
 * renderer's server render already having produced the real answer synchronously.
 *
 * @module
 */

console.error = () => {}

type Params = Record<string, never>

function BoomView(): never {
  throw new Error('preact-fixture-boom')
}

function FixtureError({ error }: ErrorBoundaryProps) {
  return createElement('p', { 'data-testid': 'fixture-error' }, String((error as Error).message))
}

class BoomPage extends SpacePageController<Params> {
  public override component = BoomView
}

function OkView() {
  return createElement('p', { 'data-testid': 'fixture-ok' }, 'all good')
}

class OkPage extends SpacePageController<Params> {
  public override component = OkView
}

Deno.test(
  'SpaceErrorBoundary (preact): a segment that actually fails gets the data-error-module wrapper, ' +
    "carrying the real caught error's own message as data-error-msg — for hydrateErrorBoundaries " +
    'to reconstruct client-side',
  async () => {
    setActiveRenderer('preact')
    setPageTree(BoomPage, {
      segments: [{ error: FixtureError, errorFilePath: '/fake/routes/error.tsx' }],
      filePath: '/fake/routes/page.tsx',
    })

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

    assert(html.includes(`${ERROR_BOUNDARY_MODULE_ATTR}="`), html)
    assert(html.includes(`${ERROR_BOUNDARY_MSG_ATTR}="preact-fixture-boom"`), html)
    assert(html.includes('data-testid="fixture-error"'), html)
    assert(html.includes('preact-fixture-boom'), html)
  },
)

Deno.test(
  'SpaceErrorBoundary (preact): a segment that renders successfully carries NO wrapper at all — ' +
    'unlike React, this renderer already knows, at render time, that nothing needs recovering',
  async () => {
    setActiveRenderer('preact')
    setPageTree(OkPage, {
      segments: [{ error: FixtureError, errorFilePath: '/fake/routes/error.tsx' }],
      filePath: '/fake/routes/page.tsx',
    })

    const response = await renderPageResponse(
      OkPage,
      OkView,
      mockPageContext({ params: {} }),
      undefined,
      false,
      undefined,
      undefined,
    )
    const html = await response.text()

    assertFalse(html.includes(`${ERROR_BOUNDARY_MODULE_ATTR}="`), html)
    assert(html.includes('data-testid="fixture-ok"'), html)
  },
)
