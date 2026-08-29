// deno-coverage-ignore-file

// No JSX — see the root `layout.tsx`'s own comment for why.
import { createElement } from 'preact'
import type { LayoutProps, PageContext } from 'typings/page.ts'
import type { SpaceChildren } from 'typings/renderable.ts'
import { fetchSharedUser } from '../dedupe-counter.ts'

export const loader = (ctx: PageContext) => ctx.dedupe('shared-user', fetchSharedUser)

export default function NestedFixtureLayout(
  { children, data }: LayoutProps<SpaceChildren, { name: string }>,
) {
  return createElement(
    'div',
    { 'data-testid': 'nested-layout', 'data-nested-user': data.name },
    children,
  )
}
