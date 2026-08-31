import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { serializeError } from '@zanix/errors'
import logger from './client-logger.ts'
import type { Messages } from '../i18n/load-messages.ts'
import {
  ERROR_BOUNDARY_MESSAGES_ATTR,
  ERROR_BOUNDARY_MODULE_ATTR,
  ERROR_BOUNDARY_PARAMS_ATTR,
} from '../router/error-boundary-marker.ts'
import { parseCometProps } from '../render/serialization-codec.ts'
import { reconstructError } from './reconstruct-error.ts'
import { retryOutlet } from './orbit.ts'
import { setErrorBoundaryHydrator } from './hydrator-registry.ts'

/** The `data-*` attributes React's OWN postponed-recovery `<template>` carries — a React-internal
 * protocol this module reads, never writes (see `error-boundary-marker.ts`'s own module doc). Not
 * exported: nothing outside this file has any business depending on React's own wire format. */
const REACT_POSTPONED_MSG_ATTR = 'data-msg'
const REACT_POSTPONED_STACK_ATTR = 'data-stck'

/** The standard DOM `Node.ELEMENT_NODE`/`Node.COMMENT_NODE` values, `1`/`8` — the literal integers,
 * not a reference to the global `Node` constructor: `Node` is a real browser global (this module
 * only ever runs there), but referencing it here would make {@linkcode findPostponedTemplate}
 * untestable with the same cheap, duck-typed fake objects `hydrate-comets.test.ts` already uses for
 * `hydrateComets` (`Node` is `undefined` in this package's own Deno-native test environment, which
 * has no DOM shim — confirmed empirically, not assumed). These two values are part of the DOM
 * standard itself and have never changed since `Node` gained them (DOM Level 2) — using them
 * directly is not a shortcut, it removes a real, avoidable runtime dependency. */
const ELEMENT_NODE = 1
const COMMENT_NODE = 8

/**
 * React prefixes both attributes above with a fixed, human-facing sentence — `"Switched to client
 * rendering because the server rendering errored:\n\n"` — before the actual `message`/`stack` a
 * component threw. Splitting on the first blank line, rather than matching that exact sentence, is
 * deliberately loose: it survives React rewording its own message (a real string this package does
 * not own or control) as long as it keeps summary-then-blank-line-then-real-content shape, which is
 * documented streaming-SSR behavior, not an implementation accident. Returns the input unchanged if
 * no blank line is found at all — degrading to the verbose original rather than silently returning
 * an empty string.
 */
function stripReactPrefix(value: string): string {
  const separatorIndex = value.indexOf('\n\n')
  return separatorIndex === -1 ? value : value.slice(separatorIndex + 2)
}

/**
 * Finds this boundary's own leftover React postponed-recovery `<template>`, if (and only if) this
 * exact segment actually failed during SSR — detected via React's own `<!--$!-->` comment marker
 * as a DIRECT child of `boundary`, deliberately never a deep `querySelector`: a NESTED segment's
 * own `error.tsx` boundary (further down this same tree) would have its OWN marker wrapper as a
 * real intervening element, so a deep query could wrongly match THAT segment's template instead of
 * this one's. See `render-page-react.tsx`'s own `composeSegments` doc for why a direct child is
 * exactly what's guaranteed here.
 *
 * Deliberately does NOT key on {@linkcode REACT_POSTPONED_MSG_ATTR}'s own PRESENCE — confirmed
 * empirically (a real forced-error render under BOTH React build modes, not assumed from React's
 * own docs alone) that production `react-dom-server` emits a completely bare `<template></template>`
 * here, with none of the three debug attributes at all, by design: React never ships an internal
 * error's real message/stack to the browser outside a development build, the same security posture
 * this package's own `onError`-vs-response-body split (`render-to-response.tsx`) already follows
 * for every OTHER error. Keying on the STRUCTURAL `$!` comment instead (never `$?`, which marks an
 * ordinary, still-streaming `loading.tsx` boundary that resolves fine on its own before this
 * function ever runs — see this module's own doc) means production still recovers a working
 * `Fallback` mount, just with `reconstructError`'s own generic placeholder message instead of the
 * real one `stripReactPrefix` below extracts in development.
 */
function findPostponedTemplate(boundary: Element): HTMLTemplateElement | undefined {
  for (const child of boundary.childNodes) {
    if (child.nodeType === COMMENT_NODE && (child as Comment).data === '$!') {
      const next = child.nextSibling
      if (next?.nodeType === ELEMENT_NODE && (next as Element).tagName === 'TEMPLATE') {
        return next as HTMLTemplateElement
      }
    }
  }
  return undefined
}

async function hydrateBoundary(boundary: HTMLElement): Promise<void> {
  const template = findPostponedTemplate(boundary)
  // The normal, overwhelming majority case: this segment rendered fine, so `boundary` holds its
  // real, already-correct content — never touched, never re-rendered.
  if (!template) return

  const moduleUrl = boundary.getAttribute(ERROR_BOUNDARY_MODULE_ATTR)
  if (!moduleUrl) return

  const params = parseCometProps(boundary.getAttribute(ERROR_BOUNDARY_PARAMS_ATTR)) as Record<
    string,
    string
  >
  // `undefined` when this app has no `messagesDir` at all — `composeSegments` never emits the
  // attribute in that case (see `ERROR_BOUNDARY_MESSAGES_ATTR`'s own doc), so
  // `getAttribute` returning `null` here is the normal case, not a parse failure.
  const rawMessages = boundary.getAttribute(ERROR_BOUNDARY_MESSAGES_ATTR)
  const messages = rawMessages ? parseCometProps(rawMessages) as Messages : undefined
  const rawMessage = template.getAttribute(REACT_POSTPONED_MSG_ATTR)
  const rawStack = template.getAttribute(REACT_POSTPONED_STACK_ATTR)
  const error = reconstructError(
    rawMessage && stripReactPrefix(rawMessage),
    rawStack && stripReactPrefix(rawStack),
  )

  const module = await import(/* @vite-ignore */ moduleUrl) as Record<
    string,
    // deno-lint-ignore no-explicit-any
    any
  >
  // A real app's own `error.tsx` is always a default export (`load-routes.ts`'s own
  // `importModule(...).default`, the same Next.js-style convention every other page-level file in
  // this package follows) — but `moduleUrl` can ALSO be this package's own built-in
  // `DefaultErrorView`/`DefaultErrorView` (Preact), which `render-page-react.tsx`/
  // `render-page-preact.ts` both import as a NAMED export instead (`.DefaultErrorView`, matching
  // `DefaultNotFoundView`'s own established convention for a framework built-in). `module.default`
  // alone silently resolved to `undefined` for that second case — no throw, no logged error, just
  // an inert, invisible leftover `<template>` forever (confirmed as a real, reproduced regression,
  // not a hypothetical). Falling back to the named export covers both shapes with the one function.
  const Fallback = module.default ?? module.DefaultErrorView
  if (!Fallback) return

  // Computed from the RECONSTRUCTED `error` above, never a real server-computed value — React's
  // own postponed-recovery protocol never ships one (see `ErrorBoundaryProps.formattedError`'s own
  // doc for exactly what this means for completeness: `name`/`message`/`stack` only, never a real
  // `cause`/`meta` this segment's own server render never actually captured for this failure mode).
  const formattedError = serializeError(error)

  // A fresh mount (`createRoot`, never `hydrateRoot`) — there is no existing markup to reconcile
  // against here, only React's own leftover recovery `<template>`, which this replaces outright.
  // `reset` is `retryOutlet` (`orbit.ts`), not a local `setState`-style callback: this mount never
  // received the ORIGINAL component that failed (React's own postponed-recovery protocol never
  // ships it — only a message/stack pair), so there is nothing of its own to retry in-place; a real
  // round-trip to the server is the only thing that can actually recover. See that function's own
  // doc for why this is a genuine retry, not a placebo.
  createRoot(boundary).render(
    createElement(Fallback, { error, formattedError, reset: retryOutlet, params, messages }),
  )
}

/**
 * Recovers every segment whose `error.tsx` boundary React gave up on during streaming SSR — the
 * client half of the "switched to client rendering" story `error-boundary.tsx`'s own doc used to
 * describe as not implemented yet. Scans for every {@linkcode ERROR_BOUNDARY_MODULE_ATTR} boundary
 * `composeSegments` (`render-page-react.tsx`) adds around a segment declaring `error.tsx`, but only
 * ever ACTS on one that also carries React's own leftover postponed-recovery `<template>` as a
 * direct child — see {@linkcode findPostponedTemplate}'s own doc. A boundary with no such template
 * (the normal case, on every page load where nothing actually failed) is left completely untouched.
 *
 * Meant to be called once, from this app's own client entry, right alongside `hydrateComets()` —
 * `client-entry-plugin.ts`'s own auto-generated default entry already does this.
 *
 * `hydrate-error-boundaries.test.ts` covers this function's own control flow (which boundary gets
 * acted on, in what order, what happens when the dynamic `import()` fails) via the same cheap,
 * duck-typed fake objects `hydrate-comets.test.ts` already established for `hydrateComets` — the
 * mount itself (`createRoot(...).render(...)`) is not exercised there, same established boundary:
 * verified by code review against the real React API instead. `render-page-react.tsx`'s own tests
 * cover the SSR half (the marker attributes/DOM shape this function depends on).
 *
 * @param root - Scopes the search — defaults to the whole document, same convention
 * {@linkcode hydrateComets} establishes, for the same real reason: `orbit.ts`'s own `swapOutlet`
 * calls this again, scoped to just the freshly swapped-in outlet, via `hydrator-registry.ts`'s
 * `getErrorBoundaryHydrator` — see that module's own doc for why a persistently-failing segment's
 * own `retryOutlet` (this file's `reset`) would otherwise recover once and never again.
 */
export function hydrateErrorBoundaries(root: ParentNode = document): void {
  const boundaries = root.querySelectorAll<HTMLElement>(`[${ERROR_BOUNDARY_MODULE_ATTR}]`)
  boundaries.forEach((boundary) => {
    hydrateBoundary(boundary).catch((error) => {
      logger.error('Failed to recover an error boundary switched to client rendering', error)
    })
  })
}

// Registers this (React) implementation as the hydrator `orbit.ts` calls after a swap — set once,
// at module load, so importing a client barrel is all an app ever has to do. See
// `hydrator-registry.ts`'s own doc for the defect this closes (same reasoning as `hydrate-comets.ts`'s
// own `setCometHydrator` call).
setErrorBoundaryHydrator(hydrateErrorBoundaries)
