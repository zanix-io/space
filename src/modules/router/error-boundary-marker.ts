/**
 * The `data-*` attributes an `error.tsx` boundary carries in its rendered HTML — the wire protocol
 * between `composeSegments` (React and Preact, writes them, server-side) and this package's own
 * `hydrateErrorBoundaries` (reads them, client-side, one implementation per renderer). Deliberately
 * NOT `modules/comets/marker.ts`'s own `COMET_*` constants, even though the shape is the same
 * (module URL + serialized props): an `error.tsx` boundary is auto-discovered by the framework
 * itself, never author-declared via `defineComet`/`'use comet'`, and — critically — `hydrateComets()`
 * mounts unconditionally the moment it finds a `COMET_ID_ATTR` node, which would be wrong here: an
 * error boundary must only ever mount when a failure actually happened, never on every successful
 * page load. Sharing the same attribute names would make `hydrateComets()` itself pick these nodes
 * up by accident the moment `client-entry-plugin.ts`'s generated entry calls it, before
 * `hydrateErrorBoundaries()` ever gets a chance to check whether this segment actually failed.
 *
 * See `resolveCometModuleUrl` (`modules/comets/comet-manifest.ts`) for how the MODULE URL itself is
 * resolved — reused as-is, since it's already fully generic over any source file, not tied to
 * `defineComet`. See `comet-plugin.ts`'s own `CometPluginOptions.knownEntryPaths` doc for how an
 * `error.tsx` file's build-time chunk lands in the SAME `comets-manifest.json` that function reads.
 *
 * @module
 */
import type { Messages } from '../i18n/load-messages.ts'
import { stringifyForWire } from '../render/serialization-codec.ts'

/** The client-importable module URL for this segment's own `error.tsx` — resolved the same way a
 * Comet's own `COMET_MODULE_ATTR` is (`resolveCometModuleUrl`), from `ResolvedSegment.errorFilePath`.
 * Always the file's default export — an `error.tsx` has no author-facing named-export convention to
 * pick between, unlike a Comet. */
export const ERROR_BOUNDARY_MODULE_ATTR = 'data-error-module'
/** This segment's own resolved route params (`ErrorBoundaryProps.params`), JSON-serialized via the
 * same `stringifyForWire`/`parseCometProps` codec a Comet's own `COMET_PROPS_ATTR` uses. */
export const ERROR_BOUNDARY_PARAMS_ATTR = 'data-error-params'
/**
 * The caught error's own `message`, present ONLY on Preact's own marker (React never renders this
 * attribute itself — its postponed-recovery `<template>` carries the equivalent information under
 * ITS OWN `data-msg`/`data-cstck` attributes, a React-internal protocol this package reads but does
 * not write). Preact has no such built-in mechanism (its SSR never gives up on a boundary — see
 * `error-boundary-preact.ts`'s own doc), so `SpaceErrorBoundary` (Preact) writes this itself, from
 * the real caught `error`, the one place server-side that ever sees it.
 */
export const ERROR_BOUNDARY_MSG_ATTR = 'data-error-msg'
/** The caught error's own `stack`, if it has one — same Preact-only reasoning as
 * {@linkcode ERROR_BOUNDARY_MSG_ATTR}. */
export const ERROR_BOUNDARY_STACK_ATTR = 'data-error-stack'
/**
 * `serializeError(error)` (`@zanix/errors`) — already redacted, so safe to serialize into an HTML
 * attribute the same way `ERROR_BOUNDARY_PARAMS_ATTR` already does. Present ONLY on Preact's own
 * marker, same reasoning as {@linkcode ERROR_BOUNDARY_MSG_ATTR}: React's client-side hydrator has no
 * real error object to serialize server-side (see `hydrate-error-boundaries.ts`'s own doc) — it
 * computes `ErrorBoundaryProps.formattedError` itself, client-side, from the reconstructed message/
 * stack only, never from this attribute.
 */
export const ERROR_BOUNDARY_FORMATTED_ATTR = 'data-error-formatted'
/**
 * `ErrorBoundaryProps.messages` (`loadMessages`'s own resolved catalog), serialized via
 * `stringifyForWire` the same way {@linkcode ERROR_BOUNDARY_PARAMS_ATTR} already is — present on
 * BOTH renderers' own marker, unlike {@linkcode ERROR_BOUNDARY_FORMATTED_ATTR}: this value is
 * resolved EAGERLY by `composeSegments`, before either renderer knows whether the segment will
 * actually fail (see `ErrorBoundaryProps.messages`'s own doc for why), so there's no "React never
 * had it server-side" asymmetry the formatted-error attribute has. Omitted from the DOM entirely
 * when this app never declared `messagesDir` — never emitted as a literal `"undefined"` string.
 */
export const ERROR_BOUNDARY_MESSAGES_ATTR = 'data-error-messages'

/**
 * Builds the ONE spreadable attribute entry {@linkcode ERROR_BOUNDARY_MESSAGES_ATTR} needs — an
 * empty object when `messages` is `undefined` (this app has no `messagesDir`), never a literal
 * `"undefined"` string in the DOM. Three call sites (`render-page-react.tsx`'s two marker `<div>`s,
 * `error-boundary-preact.ts`'s one) need the exact same conditional; shared here instead of each
 * repeating its own `messages ? {...} : {}` check.
 */
export function buildMessagesMarkerAttrs(
  messages: Messages | undefined,
): Record<string, never> | { [ERROR_BOUNDARY_MESSAGES_ATTR]: string } {
  return messages ? { [ERROR_BOUNDARY_MESSAGES_ATTR]: stringifyForWire(messages) } : {}
}
