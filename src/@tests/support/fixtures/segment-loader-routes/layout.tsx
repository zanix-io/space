// deno-coverage-ignore-file

import type { LayoutProps, PageContext } from 'typings/page.ts'
import type { SpaceChildren } from 'typings/renderable.ts'

export const loader = (_ctx: PageContext) => ({ source: 'root' })

export default function RootFixtureLayout(
  { children, data }: LayoutProps<SpaceChildren, { source: string }>,
) {
  return (
    <div data-testid='root-layout' data-root-source={data.source}>
      {children}
    </div>
  )
}
