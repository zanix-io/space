import type { ReactElement } from 'react'

/**
 * Served by `renderLoaderErrorPage` (`loader-error-handler.ts`) when the route whose `loader`
 * threw declares no `error.tsx` anywhere in its own composition chain — the loader-error
 * counterpart to `DefaultNotFoundView`, same file and same reasoning, just for the other document
 * this package renders on its own.
 *
 * Renders only body content, and deliberately says nothing about the underlying error itself: the
 * real error is already logged before this ever renders (`loader-error-handler.ts`'s own
 * `logger.error` call), and is never assumed safe to show an end user just because a route opted
 * into no `error.tsx` of its own — the same "never persist/report on this framework's own behalf"
 * boundary `loader-error-handler.ts`'s doc already draws. An app that wants to surface real error
 * detail writes its own `error.tsx`, which receives the exact same `ErrorBoundaryProps.error` this
 * component ignores.
 *
 * Its `<title>` comes from the normal head/document model, same as `DefaultNotFoundView` — this
 * component renders no `<title>` of its own, for the identical React-hoisting-vs-Preact reason
 * documented there.
 */
export function DefaultErrorView(): ReactElement {
  return <h1 data-space='error'>Something went wrong</h1>
}
