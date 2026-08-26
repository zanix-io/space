// deno-coverage-ignore-file

import type { LayoutProps } from 'typings/page.ts'

export const loader = (): never => {
  throw new Error('fixture-segment-loader-boom')
}

export default function FixtureLayout({ children }: LayoutProps) {
  return <div data-testid='fixture-nested-layout'>{children}</div>
}
