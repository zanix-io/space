// deno-coverage-ignore-file

import { Page, SpacePageController } from 'modules/router/mod.ts'

function BoomView(): never {
  throw new Error('fixture-boom')
}

@Page('layout-error-fixture')
export default class LayoutErrorFixturePage extends SpacePageController {
  public override component = BoomView
}
