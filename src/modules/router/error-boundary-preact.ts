import { Component, createElement, options } from 'preact'
import type { ComponentChildren, ComponentType, VNode } from 'preact'
import type { ErrorBoundaryProps } from 'typings/page.ts'
import logger from '@zanix/logger'

type Props = {
  children: ComponentChildren
  fallback: ComponentType<ErrorBoundaryProps>
}

type State = { hasError: boolean; error: unknown }

// Preact core's `getDerivedStateFromError`/`componentDidCatch` support is real (see
// `preact/src/diff/catch-error.js` — no `preact/compat` needed for the class-component API
// itself), but `preact-render-to-string`'s SSR path does NOT invoke it unless this exact flag is
// set first: without it, a thrown render error propagates straight past this boundary, uncaught;
// with it, the boundary's `componentDidCatch`/fallback both fire correctly. Set once, at module
// load — this
// module is only ever reached via `render-page-preact.ts`'s own dynamic import (see
// `page-renderer-registry.ts`), so a React-only app never touches Preact's `options` object at all.
// Cast needed because Preact's own `Options` type doesn't declare this field (real, supported, and
// documented by `preact-render-to-string` itself regardless) — narrowed to exactly the one field
// being added, not `any`, so this cast can't
// silently hide a typo anywhere else `options` might be touched later in this same module.
const preactOptions = options as unknown as { errorBoundaries: boolean }
preactOptions.errorBoundaries = true

/**
 * Preact-core counterpart to `error-boundary.tsx`'s `SpaceErrorBoundary` — same contract (wraps a
 * route segment with its nearest `error.tsx` fallback), same class-component shape
 * (`getDerivedStateFromError`/`componentDidCatch`, native to Preact core). Unlike the React
 * version, this one does NOT need any `Suspense` wrapping around it: `preact-render-to-string`'s
 * synchronous render (with `options.errorBoundaries = true`, set above) recovers a thrown error
 * into an already-mounted boundary directly, with no streaming/resume mechanism to work around —
 * see `render-page-preact.ts`'s own doc for why its composition loop skips the `Suspense` wrapping
 * `render-page-react.ts`'s otherwise-identical loop needs.
 */
export class SpaceErrorBoundary extends Component<Props, State> {
  public override state: State = { hasError: false, error: undefined }

  public static override getDerivedStateFromError(error: unknown): State {
    return { hasError: true, error }
  }

  public override componentDidCatch(error: unknown): void {
    logger.error('Uncaught error in a Space page segment', error)
  }

  private reset = (): void => this.setState({ hasError: false, error: undefined })

  public override render(): VNode | ComponentChildren {
    if (!this.state.hasError) return this.props.children
    const Fallback = this.props.fallback
    return createElement(Fallback, {
      error: this.state.error,
      reset: this.reset,
    })
  }
}
