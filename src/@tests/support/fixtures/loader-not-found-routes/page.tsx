// deno-coverage-ignore-file

import { HttpError } from '@zanix/errors'
import { Page, SpacePageController } from 'modules/router/mod.ts'

function HomeView() {
  return <p>never reached — the loader always throws first</p>
}

@Page('loader-not-found-fixture')
export default class LoaderNotFoundFixturePage extends SpacePageController {
  public override loader = (): never => {
    throw new HttpError('NOT_FOUND', { message: 'fixture-resource-missing' })
  }
  public override component = HomeView
}
