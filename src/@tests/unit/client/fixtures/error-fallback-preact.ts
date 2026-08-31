import { createElement } from 'preact'
import type { ErrorBoundaryProps } from 'typings/page.ts'

/**
 * A real, dynamically-importable Preact `error.tsx` Fallback — what
 * `hydrate-error-boundaries-preact.test.ts`'s own "real import succeeds" cases resolve
 * `hydrateBoundary`'s `import(moduleUrl)` against, standing in for a real app's own `error.tsx`.
 */
export default function ErrorFallback({ error, params }: ErrorBoundaryProps) {
  return createElement(
    'p',
    { class: 'fallback' },
    `fallback:${String(error instanceof Error ? error.message : error)}:${JSON.stringify(params)}`,
  )
}
