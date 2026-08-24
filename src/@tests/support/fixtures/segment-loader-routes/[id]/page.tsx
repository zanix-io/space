// deno-coverage-ignore-file

import { Page, SpacePageController } from 'modules/router/mod.ts'

function SegmentLoaderView() {
  return <p data-testid='fixture-page'>segment-loader-fixture</p>
}

@Page()
export default class SegmentLoaderFixturePage extends SpacePageController<{ id: string }> {
  public override component = SegmentLoaderView
}
