import type { ReactElement } from 'react'

/**
 * Served by `createNotFoundHandler` when the app never defined its own `routes/not-found.tsx`.
 *
 * Renders only body content. Its `<title>` comes from `DEFAULT_NOT_FOUND_HEAD`
 * (`not-found-renderer-registry.ts`) through the normal document model — this component no longer
 * renders one itself. It used to, and that worked only because React hoists a `<title>` out of the
 * tree; the Preact counterpart could never do the same, so the two renderers produced different
 * documents from the same built-in view. Sourcing it from the head instead makes them identical,
 * and is the same path an app's own `not-found.tsx` uses when it exports a `head`.
 */
export function DefaultNotFoundView(): ReactElement {
  return <h1>404 — Page not found</h1>
}
