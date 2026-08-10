// deno-coverage-ignore-file

import type { LayoutProps } from 'typings/page.ts'

export default function FixtureLayout({ children }: LayoutProps) {
  return <div data-testid='fixture-layout'>{children}</div>
}
