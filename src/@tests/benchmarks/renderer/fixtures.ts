/**
 * Shared, renderer-agnostic data for every `*.bench.ts` file in this directory — the SAME data
 * feeds both the React and Preact component variants (`react-components.tsx`/
 * `preact-components.ts`) for a given scenario, so a timing difference between them can only come
 * from the renderer itself, never from the two conditions silently rendering different content.
 *
 * @module
 */

export interface Item {
  id: number
  label: string
  score: number
}

export function makeItems(n: number): Item[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    label: `item-${i}`,
    score: i % 7,
  }))
}

/** The three tree sizes every size-sensitive scenario in this directory measures at. */
export const TREE_SIZES = { small: 10, medium: 100, large: 1000 } as const

/** How many independent SSR passes `repeated-renders.bench.ts` runs per measured iteration —
 * simulating a server handling several requests for the same small component back to back, NOT a
 * client-side incremental re-render (Deno has no DOM/persistent reconciler to re-render against;
 * see that file's own doc for why this is a structurally different measurement). */
export const REPEATED_RENDER_COUNT = 50
