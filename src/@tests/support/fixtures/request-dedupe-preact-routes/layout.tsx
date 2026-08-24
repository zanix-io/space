// deno-coverage-ignore-file

// Plain `createElement` from 'preact', deliberately no JSX — every `.tsx` in `@zanix/space`'s own
// tree compiles JSX against this PACKAGE's own fixed `jsxImportSource: 'react'` regardless of which
// renderer is active at runtime (see `define-comet.ts`'s own doc for the identical reasoning behind
// `getCometElementFactory`), so a JSX-authored fixture can never validly exercise real Preact
// rendering from inside this package's own tests — same pattern `orbit-fragment-preact.test.tsx`
// already establishes for exactly this reason.
import { createElement } from 'preact'
import type { LayoutProps, PageContext } from 'typings/page.ts'
import { fetchSharedUser } from './dedupe-counter.ts'

export const loader = (ctx: PageContext) => ctx.dedupe('shared-user', fetchSharedUser)

export default function RootFixtureLayout(
  { children, data }: LayoutProps<unknown, { name: string }>,
) {
  return createElement(
    'div',
    { 'data-testid': 'root-layout', 'data-root-user': data.name },
    children,
  )
}
