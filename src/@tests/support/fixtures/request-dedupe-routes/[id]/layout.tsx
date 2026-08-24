// deno-coverage-ignore-file

import type { LayoutProps, PageContext } from 'typings/page.ts'
import { fetchSharedUser } from '../dedupe-counter.ts'

export const loader = (ctx: PageContext) => ctx.dedupe('shared-user', fetchSharedUser)

export default function NestedFixtureLayout(
  { children, data }: LayoutProps<unknown, { name: string }>,
) {
  return (
    <div data-testid='nested-layout' data-nested-user={data.name}>
      {children}
    </div>
  )
}
