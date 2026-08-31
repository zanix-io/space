import { createElement, hydrate } from 'preact'
import { serializeError } from '@zanix/errors'
import logger from './client-logger.ts'
import type { Messages } from '../i18n/load-messages.ts'
import {
  ERROR_BOUNDARY_FORMATTED_ATTR,
  ERROR_BOUNDARY_MESSAGES_ATTR,
  ERROR_BOUNDARY_MODULE_ATTR,
  ERROR_BOUNDARY_MSG_ATTR,
  ERROR_BOUNDARY_PARAMS_ATTR,
  ERROR_BOUNDARY_STACK_ATTR,
} from '../router/error-boundary-marker.ts'
import { parseCometProps } from '../render/serialization-codec.ts'
import { reconstructError } from './reconstruct-error.ts'
import { retryOutlet } from './orbit.ts'
import { setErrorBoundaryHydrator } from './hydrator-registry.ts'

async function hydrateBoundary(boundary: HTMLElement): Promise<void> {
  const moduleUrl = boundary.getAttribute(ERROR_BOUNDARY_MODULE_ATTR)
  if (!moduleUrl) return

  const params = parseCometProps(boundary.getAttribute(ERROR_BOUNDARY_PARAMS_ATTR)) as Record<
    string,
    string
  >
  // `undefined` when this app has no `messagesDir` at all — same reasoning as
  // `hydrate-error-boundaries.ts`'s own identical check.
  const rawMessages = boundary.getAttribute(ERROR_BOUNDARY_MESSAGES_ATTR)
  const messages = rawMessages ? parseCometProps(rawMessages) as Messages : undefined
  const error = reconstructError(
    boundary.getAttribute(ERROR_BOUNDARY_MSG_ATTR),
    boundary.getAttribute(ERROR_BOUNDARY_STACK_ATTR),
  )
  // `error-boundary-preact.ts` already computed and redacted this server-side, real `meta`/`code`/
  // `cause` included — read back as-is, never recomputed from the degraded `error` reconstruction
  // above. Falls back to a client-computed one only defensively (this attribute is always set
  // alongside `ERROR_BOUNDARY_MSG_ATTR`/`STACK_ATTR` by that same render path).
  const rawFormatted = boundary.getAttribute(ERROR_BOUNDARY_FORMATTED_ATTR)
  const formattedError = rawFormatted
    ? parseCometProps(rawFormatted) as ReturnType<typeof serializeError>
    : serializeError(error)

  const module = await import(/* @vite-ignore */ moduleUrl) as Record<
    string,
    // deno-lint-ignore no-explicit-any
    any
  >
  // Same dual-shape reasoning as `hydrate-error-boundaries.ts`'s own identical fallback: a real
  // app's own `error.tsx` is a default export, but `moduleUrl` can also be this package's own
  // built-in `DefaultErrorView` (Preact), which `render-page-preact.ts` imports as a NAMED export
  // instead — `module.default` alone silently resolved to `undefined` for that case, leaving the
  // real, already-server-rendered Fallback markup un-hydrated (no `reset` handler ever attached).
  const Fallback = module.default ?? module.DefaultErrorView
  if (!Fallback) return

  // A REAL `hydrate()`, unlike React's own counterpart's fresh `createRoot` — `error-boundary-preact.ts`'s
  // own `render()` already emitted this Fallback's real, correct markup during SSR (Preact core has
  // no Suspense/streaming-recovery mechanism to work around — see that module's own doc), so
  // `boundary`'s own children already ARE this element's real rendered output; there is nothing
  // to replace, only interactivity (a `reset` button's own click handler) to attach. `reset` is
  // `retryOutlet` (`orbit.ts`), not the ORIGINAL `SpaceErrorBoundary.reset` (a local `setState`) —
  // this hydrated element is the Fallback IN ISOLATION, with no live reference to the segment's own
  // original `children` to retry against, same reasoning `hydrate-error-boundaries.ts`'s own doc
  // gives for React. A real round-trip to the server is what actually can recover.
  hydrate(
    createElement(Fallback, { error, formattedError, reset: retryOutlet, params, messages }),
    boundary,
  )
}

/**
 * Attaches real interactivity to every `error.tsx` Fallback this page's SSR pass already rendered
 * correctly — the Preact counterpart to `hydrate-error-boundaries.ts`'s own React implementation,
 * much simpler for the reason its own module doc gives: `preact-render-to-string` never gives up on
 * a boundary the way React's streaming renderer does, so there is no leftover marker to go looking
 * for — every {@linkcode ERROR_BOUNDARY_MODULE_ATTR} node this function finds is, by construction
 * (`error-boundary-preact.ts`'s own conditional emission), a segment that genuinely failed.
 *
 * Meant to be called once, from this app's own client entry, right alongside `hydrateComets()` —
 * `client-entry-plugin.ts`'s own auto-generated default entry already does this for BOTH renderers
 * (this symbol exists in `@zanix/space/client/preact` for exactly that reason — see the client
 * barrel parity test).
 *
 * `hydrate-error-boundaries-preact.test.ts` covers both this function's own control flow (cheap
 * fakes) and a real `hydrate()` mount (real `happy-dom`, a real fixture module), the same two-tier
 * split `hydrate-comets-preact.test.ts` already established for its own renderer.
 *
 * @param root - Scopes the search — defaults to the whole document, same convention every other
 * hydration entry point in this package already establishes; also what `orbit.ts`'s own
 * `swapOutlet` passes (via `hydrator-registry.ts`'s `getErrorBoundaryHydrator`) after a fresh
 * `retryOutlet` swap — see that registry's own doc for why a persistently-failing segment needs
 * this called again, not just once at initial load.
 */
export function hydrateErrorBoundaries(root: ParentNode = document): void {
  const boundaries = root.querySelectorAll<HTMLElement>(`[${ERROR_BOUNDARY_MODULE_ATTR}]`)
  boundaries.forEach((boundary) => {
    hydrateBoundary(boundary).catch((error) => {
      logger.error('Failed to hydrate a failed error boundary', error)
    })
  })
}

// Registers this (Preact) implementation as the hydrator `orbit.ts` calls after a swap — same
// reasoning/timing as `hydrate-comets-preact.ts`'s own `setCometHydrator` call.
setErrorBoundaryHydrator(hydrateErrorBoundaries)
