// deno-coverage-ignore-file

import type { LayoutProps, PageContext } from 'typings/page.ts'

export const loader = (_ctx: PageContext) => ({ source: 'root' })

export default function RootFixtureLayout(
  { children, data }: LayoutProps<unknown, { source: string }>,
) {
  return (
    <div data-testid='root-layout' data-root-source={data.source}>
      {children}
    </div>
  )
}
