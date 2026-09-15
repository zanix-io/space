// deno-coverage-ignore-file

import { Page, SpacePageController } from 'modules/router/mod.ts'
import type { PageActionContext } from 'typings/page.ts'

function FixtureView() {
  return <p>never reached — the action always throws first</p>
}

@Page({ path: 'action-error-fixture', action: { onError: 'render' } })
export default class ActionErrorFixturePage extends SpacePageController {
  public override component = FixtureView
  public override action = (_ctx: PageActionContext): never => {
    throw new Error('fixture-action-boom')
  }
}
