import { Component, createElement, options } from 'preact'
import type { ComponentChildren, ComponentType, VNode } from 'preact'
import type { ErrorBoundaryProps } from 'typings/page.ts'
import type { Messages } from 'modules/i18n/load-messages.ts'
import logger from '@zanix/logger'
import { serializeError } from '@zanix/errors'
import {
  buildMessagesMarkerAttrs,
  ERROR_BOUNDARY_FORMATTED_ATTR,
  ERROR_BOUNDARY_MODULE_ATTR,
  ERROR_BOUNDARY_MSG_ATTR,
  ERROR_BOUNDARY_PARAMS_ATTR,
  ERROR_BOUNDARY_STACK_ATTR,
} from './error-boundary-marker.ts'
import { stringifyForWire } from '../render/serialization-codec.ts'

type Props = {
  children: ComponentChildren
  fallback: ComponentType<ErrorBoundaryProps>
  params: Record<string, string>
  /** See `ErrorBoundaryProps.messages`'s own doc — resolved once by `composeSegments`
   * (`render-page-preact.ts`), before render even starts, and only ever forwarded here as-is. */
  messages?: Messages
  /** This segment's own `error.tsx` client module URL (`resolveCometModuleUrl`, resolved by
   * `render-page-preact.ts`'s own `composeSegments` from `ResolvedSegment.errorFilePath`) —
   * `undefined` for a `ResolvedSegment` built by hand with no real file path (see that field's own
   * doc). Unlike React's counterpart, this class DOES know, at render time, whether it actually
   * caught anything — so unlike `error-boundary.tsx`, the marker wrapper below is added
   * CONDITIONALLY, only in the `hasError` branch of `render()`, never on every render. */
  moduleUrl?: string
}

type State = {
  hasError: boolean
  error: unknown
  /** Computed once, right where the real `error` is caught (`getDerivedStateFromError`) — never
   * recomputed per render. See `ErrorBoundaryProps.formattedError`'s own doc. */
  formattedError: ReturnType<typeof serializeError>
}

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
  public override state: State = { hasError: false, error: undefined, formattedError: {} }

  public static override getDerivedStateFromError(error: unknown): State {
    return { hasError: true, error, formattedError: serializeError(error) }
  }

  public override componentDidCatch(error: unknown): void {
    logger.error('Uncaught error in a Space page segment', error)
  }

  private reset = (): void =>
    this.setState({ hasError: false, error: undefined, formattedError: {} })

  public override render(): VNode | ComponentChildren {
    if (!this.state.hasError) return this.props.children
    const Fallback = this.props.fallback
    const fallbackElement = createElement(Fallback, {
      error: this.state.error,
      formattedError: this.state.formattedError,
      reset: this.reset,
      params: this.props.params,
      messages: this.props.messages,
    })

    // Unlike React's own `SpaceErrorBoundary`, this branch DOES run during the real SSR response
    // (see this class's own module doc) — the Fallback's real markup is already correct and
    // visible with zero client JS. What's still missing is interactivity (a `reset` button's own
    // click handler, never wired by any SSR pass, either renderer's): `hydrateErrorBoundaries`
    // (`modules/client/hydrate-error-boundaries-preact.ts`) needs a stable node to `hydrate()`
    // against, and the real caught `error`'s own `message`/`stack` — never serializable through
    // `ErrorBoundaryProps.error` itself (an app can throw anything, not just an `Error`) — so they
    // travel as their own plain-string attributes instead. Skipped entirely when `moduleUrl` is
    // `undefined` (a `ResolvedSegment` built without a real file path — see `Props.moduleUrl`'s own
    // doc), preserving this component's exact previous output for that case.
    if (!this.props.moduleUrl) return fallbackElement
    const { error, formattedError } = this.state
    return createElement('div', {
      [ERROR_BOUNDARY_MODULE_ATTR]: this.props.moduleUrl,
      [ERROR_BOUNDARY_PARAMS_ATTR]: stringifyForWire(this.props.params),
      [ERROR_BOUNDARY_MSG_ATTR]: error instanceof Error ? error.message : String(error),
      [ERROR_BOUNDARY_STACK_ATTR]: error instanceof Error ? error.stack : undefined,
      // Already redacted (`serializeError`'s own default) — safe to serialize into markup the
      // same way `ERROR_BOUNDARY_PARAMS_ATTR` already does.
      [ERROR_BOUNDARY_FORMATTED_ATTR]: stringifyForWire(formattedError),
      ...buildMessagesMarkerAttrs(this.props.messages),
    }, fallbackElement)
  }
}
