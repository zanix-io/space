import type { ReactElement } from 'react'

/** Served by `createNotFoundHandler` when the app never defined its own `routes/not-found.tsx`. */
export function DefaultNotFoundView(): ReactElement {
  return (
    <>
      <title>Page not found</title>
      <h1>404 — Page not found</h1>
    </>
  )
}
