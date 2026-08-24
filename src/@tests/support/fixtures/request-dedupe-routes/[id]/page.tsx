// deno-coverage-ignore-file

import { Page, SpacePageController } from 'modules/router/mod.ts'
import type { PageContext } from 'typings/page.ts'
import { fetchSharedUser } from '../dedupe-counter.ts'

function DedupeFixtureView({ name }: { name: string }) {
  return <p data-testid='fixture-page' data-page-user={name}>{name}</p>
}

@Page()
export default class RequestDedupeFixturePage extends SpacePageController<{ id: string }> {
  public override loader = async (ctx: PageContext<{ id: string }>) => ({
    name: (await ctx.dedupe('shared-user', fetchSharedUser)).name,
  })
  public override component = DedupeFixtureView
}
