import { createElement } from 'preact'
import type { VNode } from 'preact'

/**
 * Served by `renderLoaderErrorPage` (`loader-error-handler.ts`) under `--renderer=preact` when the
 * route whose `loader` threw declares no `error.tsx` anywhere in its own composition chain — the
 * Preact counterpart to `default-error-view.tsx`, same reasoning as `default-not-found-view-preact.ts`
 * relative to its own React counterpart.
 *
 * Renders only body content, and deliberately says nothing about the underlying error itself — see
 * `default-error-view.tsx`'s own doc for the full reasoning (the real error is already logged; an
 * app that wants to surface it writes its own `error.tsx`).
 *
 * Its `<title>` comes from the normal head/document model, NOT from anything rendered here —
 * Preact has no head hoisting, same reasoning `default-not-found-view-preact.ts` already documents.
 */
export function DefaultErrorView(): VNode<{ 'data-space': string }> {
  return createElement('h1', { 'data-space': 'error' }, 'Something went wrong')
}
