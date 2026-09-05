import {
  DEFAULT_DRAFT_DEBOUNCE_MS,
  type DraftStorageKind,
  namespacedStorageKey,
  readFromStorage,
  resolveStorageBackend,
  writeToStorage,
} from './draft-storage.ts'

export { DEFAULT_DRAFT_DEBOUNCE_MS }
export type { DraftStorageKind }

/**
 * Session/local-scoped scroll-position restoration — for the window, or a single scrollable
 * container — across a refresh or a navigate-away-and-back. Orbit (`@zanix/space/client`'s
 * `initOrbit()`) never manages scroll position itself: a client-side swap changes the URL via
 * `history.pushState`/`replaceState` (see `orbit.ts`'s own `navigate()`) with no scroll handling
 * either side of it, so without this a page reached via Orbit keeps whatever scroll position the
 * PREVIOUS page left the viewport at. Hook-free and renderer-agnostic (zero React/Preact import),
 * same shape as `form-draft-persistence.ts`'s own core primitive.
 *
 * Unlike {@linkcode FormDraftPersistenceOptions.storageKey} (deliberately required, never
 * derived), a scroll position's own stable identity genuinely IS the page being viewed — the
 * `[lang]`-segment reasoning that rules out a pathname-derived key for a FORM (the same logical
 * form rendering at two different pathnames) doesn't apply here: `/en/products` and `/es/products`
 * are two distinct viewed pages, each with its own real scroll position, so `storageKey` defaults
 * to `location.pathname + location.search` and is only ever overridden for a genuinely shared-
 * scroll-state case.
 *
 * @module
 */

/** Options for {@linkcode attachScrollRestoration}. */
export type ScrollRestorationOptions = {
  /** Key this position is saved under. Defaults to `location.pathname + location.search` — see
   * this module's own doc for why that default is correct here, unlike a form draft's key. */
  storageKey?: string
  /** The real `id` of the scrollable element to track. Omit to track the window/document scroll
   * (the common case — a whole-page position, not one scrollable panel inside it). */
  targetId?: string
  /** `'session'` (default) or `'local'`. See {@linkcode DraftStorageKind}. */
  storage?: DraftStorageKind
  /** Debounce, in ms, applied after the last `scroll` event before persisting. Defaults to
   * {@linkcode DEFAULT_DRAFT_DEBOUNCE_MS}. */
  debounceMs?: number
}

function isRecordedPosition(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === 'number')
}

/**
 * Attaches scroll-position restoration to the window or one scrollable element — the primitive a
 * `useEffect` (React/Preact, see `@zanix/space/comet/react` and `@zanix/space/comet/preact`)
 * calls into. Restores a saved position on attach (skipped when the current URL already carries a
 * `#fragment` — an explicit anchor link wins over a remembered position from an earlier visit),
 * saves on every `scroll` (debounced).
 *
 * @returns A cleanup function — detaches the listener this call attached. Matches a `useEffect`
 * callback's own return contract directly: `useEffect(() => attachScrollRestoration(options), deps)`.
 */
export function attachScrollRestoration(options: ScrollRestorationOptions = {}): () => void {
  const { targetId, storage, debounceMs = DEFAULT_DRAFT_DEBOUNCE_MS } = options
  const doc = globalThis.document
  if (!doc) return () => {}

  const target = targetId ? doc.getElementById(targetId) : undefined
  if (targetId && !target) return () => {}

  const backend = resolveStorageBackend(storage)
  if (!backend) return () => {}

  const key = namespacedStorageKey(
    `scroll:${options.storageKey ?? `${location.pathname}${location.search}`}`,
  )

  const getPosition = (): [number, number] =>
    target ? [target.scrollLeft, target.scrollTop] : [globalThis.scrollX, globalThis.scrollY]
  const setPosition = (x: number, y: number) => {
    if (target) target.scrollTo(x, y)
    else globalThis.scrollTo(x, y)
  }

  if (!location.hash) {
    const saved = readFromStorage(backend, key)
    if (isRecordedPosition(saved)) setPosition(saved[0], saved[1])
  }

  const scrollEventTarget: EventTarget = target ?? globalThis
  let timer: ReturnType<typeof setTimeout> | undefined
  const handleScroll = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => writeToStorage(backend, key, getPosition()), debounceMs)
  }

  scrollEventTarget.addEventListener('scroll', handleScroll, { passive: true })

  return () => {
    if (timer !== undefined) clearTimeout(timer)
    scrollEventTarget.removeEventListener('scroll', handleScroll)
  }
}
