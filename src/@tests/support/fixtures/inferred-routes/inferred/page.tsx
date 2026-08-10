// deno-coverage-ignore-file

import { Page, SpacePageController } from 'modules/router/mod.ts'

function View() {
  return <p>inferred-ok</p>
}

@Page()
export default class InferredPage extends SpacePageController {
  public override component = View
}
