// deno-coverage-ignore-file

import type { LayoutProps, PageContext } from 'typings/page.ts'

export const loader = (ctx: PageContext<{ id: string }>) => ({ nestedId: ctx.params.id })

export default function NestedFixtureLayout(
  { children, data }: LayoutProps<unknown, { nestedId: string }>,
) {
  return (
    <div data-testid='nested-layout' data-nested-id={data.nestedId}>
      {children}
    </div>
  )
}
