import { createElement } from 'preact'
import type { ErrorBoundaryProps } from 'typings/page.ts'

/**
 * A real, dynamically-importable Preact Fallback with ONLY a named export, no `export default` —
 * the exact shape `default-error-view-preact.ts` itself has (`render-page-preact.ts` imports it as
 * `.DefaultErrorView`, never `.default`). Stands in for that file in
 * `hydrate-error-boundaries-preact.test.ts`'s own regression case — see
 * `error-fallback-named-export.tsx`'s own doc (the React sibling of this exact fixture) for the
 * real, reproduced bug this covers.
 */
export function DefaultErrorView({ error, params }: ErrorBoundaryProps) {
  return createElement(
    'p',
    { class: 'fallback' },
    `fallback:${String(error instanceof Error ? error.message : error)}:${JSON.stringify(params)}`,
  )
}
