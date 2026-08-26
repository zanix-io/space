// deno-coverage-ignore-file

import { Page, SpacePageController } from 'modules/router/mod.ts'

function HomeView() {
  return <p>never reached — the loader always throws first</p>
}

/**
 * Deliberately declares NO `error.tsx` anywhere in its own composition chain (no sibling
 * `error.tsx`, no ancestor one either) — the one case `loader-error-handler.ts`'s own built-in
 * `DefaultErrorView` fallback exists for.
 */
@Page('loader-error-no-boundary-fixture')
export default class LoaderErrorNoBoundaryFixturePage extends SpacePageController {
  public override loader = (): never => {
    throw new Error('fixture-no-boundary-loader-boom')
  }
  public override component = HomeView
}
