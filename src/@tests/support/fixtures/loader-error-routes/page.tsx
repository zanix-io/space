// deno-coverage-ignore-file

import { Page, SpacePageController } from 'modules/router/mod.ts'

function HomeView() {
  return <p>never reached — the loader always throws first</p>
}

@Page('loader-error-fixture')
export default class LoaderErrorFixturePage extends SpacePageController {
  public override loader = (): never => {
    throw new Error('fixture-loader-boom')
  }
  public override component = HomeView
}
