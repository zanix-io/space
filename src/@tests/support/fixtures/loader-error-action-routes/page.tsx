// deno-coverage-ignore-file

import { BaseRTO, IsEmail } from '@zanix/validator'
import { Page, SpacePageController } from 'modules/router/mod.ts'
import type { PageActionContext } from 'typings/page.ts'

class FixtureActionBody extends BaseRTO {
  @IsEmail({ expose: true })
  accessor email!: string
}

function FixtureView() {
  return <p>never reached — the loader always throws first</p>
}

@Page({ path: 'loader-error-action-fixture', action: { Body: FixtureActionBody } })
export default class LoaderErrorActionFixturePage extends SpacePageController {
  // Runs for BOTH a plain `GET` and the `422` re-render `handlePost` triggers when `action`'s own
  // `Body` fails validation — this fixture only exercises the latter (see the test file), matching
  // `#renderInvalidAction`'s own doc: "`loader` runs exactly as it does for a GET."
  public override loader = (): never => {
    throw new Error('fixture-action-loader-boom')
  }
  public override component = FixtureView
  public override action = (_ctx: PageActionContext) =>
    Promise.resolve(new Response('never reached'))
}
