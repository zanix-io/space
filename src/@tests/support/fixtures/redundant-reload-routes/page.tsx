// deno-coverage-ignore-file

import { Page, SpacePageController } from 'modules/router/mod.ts'

function View() {
  return <p>redundant-reload-ok</p>
}

@Page()
export default class RedundantReloadPage extends SpacePageController {
  public override component = View
}
