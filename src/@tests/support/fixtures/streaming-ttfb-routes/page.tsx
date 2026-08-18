// deno-coverage-ignore-file

import { Page, SpacePageController } from 'modules/router/mod.ts'
// `useRequestCache` is React-only by contract and lives on the React entry point since the
// entry-point split — exactly where a real React page imports it from.
import { useRequestCache } from '../../../../../mod-react.ts'

let releaseGate: () => void = () => {}
/** Held open deliberately so a real HTTP test can prove bytes are already flowing across the wire
 * — headers received, body reader returning chunks — before this promise ever settles. A fixed
 * `setTimeout` (see the `loading-routes` fixture) only proves ordering by wall-clock margin; this
 * proves it by construction, the same technique `@zanix/server`'s own gzip-streaming test
 * (`gzip-ssr-streaming.fixture.ts`) uses for the lower-level, non-Space-rendered case. */
const gate = new Promise<string>((resolve) => {
  releaseGate = () => resolve('resolved-content')
})

/** Lets the test unblock the fixture's own suspended render once it has proven the response
 * started streaming without it. */
export function releaseStreamingGate(): void {
  releaseGate()
}

function GatedView() {
  const value = useRequestCache('streaming-ttfb-fixture-gate', () => gate)
  return <p data-testid='fixture-resolved'>{value}</p>
}

@Page('streaming-ttfb-fixture')
export default class StreamingTtfbFixturePage extends SpacePageController {
  public override component = GatedView
}
