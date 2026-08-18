// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { useState } from 'react'
import { Page, SpacePageController } from 'modules/router/mod.ts'
import { mockHandlerContext } from 'modules/testing/mod.ts'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'

// Same shape as the comet fixture `react-compiler.test.ts` (integration/bundler) verifies actually
// gets compiled client-side: real `useState`, a derived value with no manual `useMemo`, an inline
// event handler, a top-level Fragment. The point of THIS test is different — it proves the
// opposite side of the same guarantee: production SSR runs directly against source
// (`SpacePageController.handleGet` never goes through Vite/Rolldown/React Compiler at all — see
// the Blueprint's own §6 on why Space's server build is deliberately unbundled), so a component of
// this exact shape must keep producing byte-correct SSR output whether or not React Compiler is
// wired into the CLIENT build pipeline. If this ever broke, it would mean React Compiler adoption
// somehow leaked into the server path — which the architecture (`reactCompilerPreset()`'s own
// `applyToEnvironmentHook: consumer === 'client'` gate, plus this package's own unbundled-SSR
// design) says can't happen.
function DerivedView() {
  const [count] = useState(0)
  const items = ['a', 'bb', 'ccc']
  const visible = items.filter((item) => item.length > count)
  return (
    <>
      <p data-testid='count'>{count}</p>
      <ul>
        {visible.map((item) => <li key={item}>{item}</li>)}
      </ul>
      <button type='button'>increment</button>
    </>
  )
}

@Page('react-compiler-ssr-fixture')
class ReactCompilerSsrPage extends SpacePageController {
  public override component = DerivedView
}
void ReactCompilerSsrPage

Deno.test(
  'SSR remains unaffected by React Compiler: a page shaped exactly like the compiled comet fixture still renders correct HTML through the real (uncompiled, source-run) SSR pipeline',
  async () => {
    const page = new ReactCompilerSsrPage(mockHandlerContext())
    const response = await page.handleGet(mockHandlerContext())
    const html = stripHydrationComments(await response.text())

    assert(html.includes('<p data-testid="count">0</p>'), html)
    assert(html.includes('<li>a</li>'), html)
    assert(html.includes('<li>bb</li>'), html)
    assert(html.includes('<li>ccc</li>'), html)
    assert(html.includes('<button type="button">increment</button>'), html)
    assertEquals(response.status, 200)
  },
)
