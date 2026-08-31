// deno-coverage-ignore-file
import { Page, SpacePageController } from 'modules/router/mod.ts'

function BoomView(): never {
  throw new Error('fixture-render-boom-no-boundary')
}

@Page('render-error-no-boundary-fixture')
export default class RenderErrorNoBoundaryFixturePage extends SpacePageController {
  public override component = BoomView
}
