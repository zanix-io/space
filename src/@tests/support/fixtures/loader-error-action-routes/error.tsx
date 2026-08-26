// deno-coverage-ignore-file

import type { ErrorBoundaryProps } from 'typings/page.ts'

export default function FixtureError({ error }: ErrorBoundaryProps) {
  return <p data-testid='fixture-action-loader-error'>{String((error as Error).message)}</p>
}
