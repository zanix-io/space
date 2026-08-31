import type { ErrorBoundaryProps } from 'typings/page.ts'

/**
 * A real, dynamically-importable React `error.tsx` Fallback — what
 * `hydrate-error-boundaries.test.ts`'s own "real import succeeds" cases resolve
 * `hydrateBoundary`'s `import(moduleUrl)` against, standing in for a real app's own `error.tsx`.
 */
export default function ErrorFallback({ error, params }: ErrorBoundaryProps) {
  return (
    <p className='fallback'>
      fallback:{String(error instanceof Error ? error.message : error)}:{JSON.stringify(params)}
    </p>
  )
}
