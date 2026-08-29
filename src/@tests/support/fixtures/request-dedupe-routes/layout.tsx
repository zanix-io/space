// deno-coverage-ignore-file

import type { LayoutProps, PageContext } from 'typings/page.ts'
import type { SpaceChildren } from 'typings/renderable.ts'
import { fetchSharedUser } from './dedupe-counter.ts'

export const loader = (ctx: PageContext) => ctx.dedupe('shared-user', fetchSharedUser)

export default function RootFixtureLayout(
  { children, data }: LayoutProps<SpaceChildren, { name: string }>,
) {
  return (
    <div data-testid='root-layout' data-root-user={data.name}>
      {children}
    </div>
  )
}
