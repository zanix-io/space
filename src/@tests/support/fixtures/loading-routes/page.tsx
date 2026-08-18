// deno-coverage-ignore-file

import { Page, SpacePageController } from 'modules/router/mod.ts'
// `useRequestCache` is React-only by contract and lives on the React entry point since the
// entry-point split — exactly where a real React page imports it from.
import { useRequestCache } from '../../../../../mod-react.ts'

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
