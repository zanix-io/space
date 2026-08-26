import { Component } from 'react'
import type { ComponentType, ErrorInfo, ReactNode } from 'react'
import type { ErrorBoundaryProps } from 'typings/page.ts'
import logger from '@zanix/logger'

type Props = {
  children: ReactNode
  fallback: ComponentType<ErrorBoundaryProps>
}

type State = { hasError: boolean; error: unknown }

/**
 * Wraps a route segment with its nearest `error.tsx` fallback. React has no hook-based equivalent
 * to `componentDidCatch`/`getDerivedStateFromError`, so this stays a small class component —
 * purely internal wiring for `SpacePageController.handleGet`; a page author never imports or
 * extends this directly, only ever writes an `error.tsx` accepting `ErrorBoundaryProps`.
 *
 * **What this actually recovers during server rendering, and what it doesn't yet**: React's
 * server renderer never invokes `getDerivedStateFromError`/`componentDidCatch` for a segment that
 * throws synchronously outside a `Suspense` boundary — that's always a fatal, response-breaking
 * error, no matter how many error boundaries sit above it (`composeSegments` in
 * `space-page-controller.ts` always wraps a segment that has an `error.tsx` in a `Suspense`, for
 * exactly this reason). Even wrapped in `Suspense`, this boundary's `render()` never actually runs
 * during the SAME server response either — React instead emits that segment's `Suspense` fallback
 * (or nothing, if there is none) plus an instruction to finish that segment on the client. This
 * class's fallback UI only becomes visible once the page is hydrated and React replays the failure
 * client-side — which requires this package's client hydration story (not implemented yet) to be
 * wired up. Until then, an `error.tsx` still does real, useful work: it's the difference between a
 * segment failure staying a `200` with a blank/loading placeholder for that segment versus taking
 * down the whole response as a `500` — it just doesn't render its own content yet.
 */
export class SpaceErrorBoundary extends Component<Props, State> {
  public override state: State = { hasError: false, error: undefined }

  public static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, error }
  }

  public override componentDidCatch(error: unknown, info: ErrorInfo): void {
    logger.error(
      'Uncaught error in a Space page segment',
      error,
      info.componentStack,
    )
  }

  private reset = (): void => this.setState({ hasError: false, error: undefined })

  public override render(): ReactNode {
    if (!this.state.hasError) return this.props.children
    const Fallback = this.props.fallback
    return <Fallback error={this.state.error} reset={this.reset} />
  }
}
