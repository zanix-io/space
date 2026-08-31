import { Component } from 'react'
import type { ComponentType, ErrorInfo, ReactNode } from 'react'
import type { ErrorBoundaryProps } from 'typings/page.ts'
import type { Messages } from 'modules/i18n/load-messages.ts'
import logger from '@zanix/logger'
import { serializeError } from '@zanix/errors'

type Props = {
  children: ReactNode
  fallback: ComponentType<ErrorBoundaryProps>
  params: Record<string, string>
  /** See `ErrorBoundaryProps.messages`'s own doc — resolved once by `composeSegments`
   * (`render-page-react.tsx`), before render even starts, and only ever forwarded here as-is. */
  messages?: Messages
}

type State = {
  hasError: boolean
  error: unknown
  /** Computed here for type/behavioral symmetry with `error-boundary-preact.ts`'s own state, even
   * though (see this class's own doc) `render()`'s `hasError` branch never actually executes during
   * a real server response — `hydrate-error-boundaries.ts` computes ITS OWN
   * `ErrorBoundaryProps.formattedError` independently, client-side, for the one case that does. */
  formattedError: ReturnType<typeof serializeError>
}

/**
 * Wraps a route segment with its nearest `error.tsx` fallback. React has no hook-based equivalent
 * to `componentDidCatch`/`getDerivedStateFromError`, so this stays a small class component —
 * purely internal wiring for `SpacePageController.handleGet`; a page author never imports or
 * extends this directly, only ever writes an `error.tsx` accepting `ErrorBoundaryProps`.
 *
 * **What this actually recovers during server rendering, and what happens instead**: React's
 * server renderer never invokes `getDerivedStateFromError`/`componentDidCatch` for a segment that
 * throws synchronously outside a `Suspense` boundary — that's always a fatal, response-breaking
 * error, no matter how many error boundaries sit above it (`composeSegments` in
 * `render-page-react.tsx` always wraps a segment that has an `error.tsx` in a `Suspense`, for
 * exactly this reason). Even wrapped in `Suspense`, this boundary's `render()` never actually runs
 * during the SAME server response either — React instead emits that segment's own postponed-
 * recovery marker (or nothing, if there is none) plus an instruction to finish that segment on the
 * client. This class's own `render()` `hasError` branch is consequently DEAD CODE in production —
 * it exists for type/behavioral symmetry with `error-boundary-preact.ts`'s own (real, reachable)
 * counterpart, not because anything here ever actually runs it. The real client-side recovery is
 * `hydrate-error-boundaries.ts`, a SEPARATE module that reads that same postponed marker directly
 * and mounts `error.tsx`'s Fallback fresh, with its own independently-computed
 * `ErrorBoundaryProps` (including `formattedError`) — never through this class at all. Until a
 * segment actually fails, none of this matters: an `error.tsx` still does real, useful work simply
 * by being wrapped in `Suspense` here — it's the difference between a segment failure staying a
 * `200` with a blank/loading placeholder for that segment versus taking down the whole response as
 * a `500`.
 *
 * `params` is threaded through regardless (an `error.tsx` under a `[lang]/...` segment can read
 * `params.lang`) — the exact same `ErrorBoundaryProps` contract the Preact renderer already renders
 * synchronously today (see `error-boundary-preact.ts`'s own doc).
 */
export class SpaceErrorBoundary extends Component<Props, State> {
  public override state: State = { hasError: false, error: undefined, formattedError: {} }

  public static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, error, formattedError: serializeError(error) }
  }

  public override componentDidCatch(error: unknown, info: ErrorInfo): void {
    logger.error(
      'Uncaught error in a Space page segment',
      error,
      info.componentStack,
    )
  }

  private reset = (): void =>
    this.setState({ hasError: false, error: undefined, formattedError: {} })

  public override render(): ReactNode {
    if (!this.state.hasError) return this.props.children
    const Fallback = this.props.fallback
    return (
      <Fallback
        error={this.state.error}
        formattedError={this.state.formattedError}
        reset={this.reset}
        params={this.props.params}
        messages={this.props.messages}
      />
    )
  }
}
