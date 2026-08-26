// deno-coverage-ignore-file

import { Page, SpacePageController } from 'modules/router/mod.ts'

function HomeView() {
  return <p>home</p>
}

@Page('nested-loader-error-fixture')
export default class NestedLoaderErrorFixturePage extends SpacePageController {
  public override component = HomeView
}
