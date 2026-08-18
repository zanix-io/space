import { createElement } from 'preact'
import type { VNode } from 'preact'

/**
 * Served by `createNotFoundHandler` under `--renderer=preact` when the app never defined its own
 * `routes/not-found.tsx` — the Preact counterpart to `default-not-found-view.tsx`.
 *
 * Renders only body content. Its `<title>` comes from `DEFAULT_NOT_FOUND_HEAD`
 * (`not-found-renderer-registry.ts`) through the normal document model, NOT from a `<title>`
 * rendered here — Preact has no head hoisting, so a title rendered inside body content would never
 * reach `<head>` at all. React's counterpart currently renders its own `<title>` in JSX and gets
 * away with it purely because of hoisting; both now also receive the same resolved head, so the two
 * produce the same document either way.
 */
export function DefaultNotFoundView(): VNode {
  return createElement('h1', null, '404 — Page not found')
}
