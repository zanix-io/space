// deno-coverage-ignore-file

import { Page, SpacePageController } from 'modules/router/mod.ts'

function HomeView() {
  return <p>home</p>
}

@Page('not-found-fixture')
export default class NotFoundFixtureHomePage extends SpacePageController {
  public override component = HomeView
}
