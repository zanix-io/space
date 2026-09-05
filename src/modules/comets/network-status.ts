/**
 * Live online/offline status — `navigator.onLine` plus the real `online`/`offline` window events,
 * wrapped as a callback-based primitive instead of a value the caller has to poll. Hook-free and
 * renderer-agnostic (zero React/Preact import).
 *
 * @module
 */

/** Options for the ready-made `NetworkStatus` Comet (`@zanix/space/comet/react`,
 * `@zanix/space/comet/preact`). A Comet's own props must be plain JSON, so it writes the live
 * status to the DOM instead of calling back into application code — see
 * {@linkcode attachNetworkStatus} directly for the callback-based primitive a consumer's own
 * composite comet can wire into real `useState` instead. */
export type NetworkStatusOptions = {
  /** The real `id` of the element to write the status attribute onto. Omit to write it on
   * `document.documentElement` (the `<html>` element) — the common case, since
   * `:root[data-network-status="offline"] { ... }` can then be styled from any stylesheet. */
  targetId?: string
  /** The attribute name written with `'online'`/`'offline'` as its value.
   * @default 'data-network-status'
   */
  attribute?: string
}

/** {@linkcode NetworkStatusOptions.attribute}'s own default value. */
export const DEFAULT_NETWORK_STATUS_ATTRIBUTE = 'data-network-status'

/**
 * Attaches online/offline tracking — the primitive a `useEffect` (React/Preact, see
 * `@zanix/space/comet/react` and `@zanix/space/comet/preact`) calls into, or a consumer's own
 * composite comet composes directly to drive real `useState`. Calls `onChange` once, immediately,
 * with the CURRENT status (`navigator.onLine`), then again on every real transition.
 *
 * @returns A cleanup function — detaches both listeners this call attached.
 * `useEffect(() => attachNetworkStatus(onChange), [])`.
 */
export function attachNetworkStatus(onChange: (online: boolean) => void): () => void {
  const nav = globalThis.navigator
  if (!nav) return () => {}

  onChange(nav.onLine)
  const handleOnline = () => onChange(true)
  const handleOffline = () => onChange(false)

  globalThis.addEventListener('online', handleOnline)
  globalThis.addEventListener('offline', handleOffline)

  return () => {
    globalThis.removeEventListener('online', handleOnline)
    globalThis.removeEventListener('offline', handleOffline)
  }
}
