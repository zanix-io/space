/**
 * Resolves every segment's own `layout.tsx` `loader` in a page's composition chain — the one piece
 * of that resolution genuinely shared between renderers, called identically from each renderer's own
 * `composeSegments` (`render-page-react.tsx`/`render-page-preact.ts`), the same way both already
 * share `resolveHead` (`head-descriptor.ts`) for the per-segment `head` chain.
 *
 * @module
 */
import type { PageContext } from 'typings/page.ts'
import type { ResolvedSegment } from './page-tree-registry.ts'

/**
 * Resolves every segment's own `loader` (if it declared one) against the SAME `ctx`, all in
 * PARALLEL via a single `Promise.all` — never sequentially, and never letting one segment's own
 * `data` depend on another's. This is deliberately the one property a page's own single loader
 * already had (resolves before render, no waterfall) extended per segment, not RSC's arbitrary-depth
 * per-component fetching — see `LayoutProps.data`'s own doc (`typings/page.ts`) for the full
 * contract, including what happens when a segment's `loader` throws.
 *
 * @param segments - A page's own composition chain, root-first — exactly `PageTree.segments`, as
 * `getPageTree` returns it.
 * @param ctx - The SAME `PageContext` a page's own `loader` receives for this request.
 * @returns Each segment's own resolved `data`, index-aligned with `segments` — `undefined` at any
 * index whose segment declared no `loader`.
 */
export function resolveSegmentData(
  segments: ResolvedSegment[],
  ctx: PageContext,
): Promise<unknown[]> {
  return Promise.all(segments.map((segment) => segment.loader?.(ctx)))
}
