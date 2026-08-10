// deno-coverage-ignore-file

import { Page, SpacePageController } from 'modules/router/mod.ts'

function HomeView() {
  return <p>home with custom html layout</p>
}

@Page('html-layout-fixture')
export default class HtmlLayoutFixturePage extends SpacePageController {
  public override component = HomeView
}
