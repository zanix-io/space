// deno-coverage-ignore-file
import { Page, SpacePageController } from 'modules/router/mod.ts'

function HomeView() {
  return <p>fixture-app home</p>
}

@Page('')
export default class FixtureHomePage extends SpacePageController {
  public override component = HomeView
}
