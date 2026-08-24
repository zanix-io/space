// deno-coverage-ignore-file

// No JSX — see the root `layout.tsx`'s own comment for why.
import { createElement } from 'preact'
import { Page, SpacePageController } from 'modules/router/mod.ts'
import type { PageContext } from 'typings/page.ts'
import { fetchSharedUser } from '../dedupe-counter.ts'

function DedupeFixtureView({ name }: { name: string }) {
  return createElement('p', { 'data-testid': 'fixture-page', 'data-page-user': name }, name)
}

// Explicit path, not the pathless inferred form: this fixture's own directory shape (`[id]/`)
// would otherwise infer the SAME route path (`:id`) as the React fixture's own
// `request-dedupe-routes/[id]/page.tsx` — harmless in isolation, but both load into the same
// process's own default Application when this test file runs, and `@zanix/server` rejects two
// targets registering the identical path.
@Page('request-dedupe-preact-fixture/:id')
export default class RequestDedupePreactFixturePage extends SpacePageController<{ id: string }> {
  public override loader = async (ctx: PageContext<{ id: string }>) => ({
    name: (await ctx.dedupe('shared-user', fetchSharedUser)).name,
  })
  public override component = DedupeFixtureView
}
