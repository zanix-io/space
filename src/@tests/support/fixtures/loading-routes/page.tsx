// deno-coverage-ignore-file

import { Page, SpacePageController } from 'modules/router/mod.ts'
import { useRequestCache } from 'modules/render/mod.ts'

function DelayedView() {
  const value = useRequestCache(
    'loading-fixture-delay',
    // Long enough to comfortably outlast the handful of milliseconds a test takes to get from
    // `handleGet()` resolving to actually pulling the stream's first chunk — too short a delay
    // risks the promise settling before anything ever reads it, in which case React (a pull-based
    // stream) never bothers writing the fallback at all, since nothing observed the pending state.
    () => new Promise<string>((resolve) => setTimeout(() => resolve('resolved-content'), 150)),
  )
  return <p data-testid='fixture-resolved'>{value}</p>
}

@Page('loading-fixture')
export default class LoadingFixturePage extends SpacePageController {
  public override component = DelayedView
}
