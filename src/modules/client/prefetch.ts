import { ORBIT_FRAGMENT_HEADER } from '../router/orbit-protocol.ts'
import { findAnchor, resolveLinkInfo } from './link-info.ts'

/**
 * Enables Orbit's prefetch triggers — passed as `initOrbit({ prefetch })`. `false` disables
 * prefetch entirely (Orbit still works, just never warms anything ahead of a click). Each
 * strategy is independent — enable one, the other, or both.
 *
 * - `onHover` (`mouseenter`/`focusin`, debounced) — **on by default**: a stronger intent signal
 *   than viewport visibility, since it requires the user to actually be pointing at or focusing
 *   the link, not just scrolling past it.
 * - `onViewport` (`IntersectionObserver`) — **opt-in**: a page with many links would otherwise
 *   prefetch aggressively during an ordinary scroll, for links the user may never actually visit —
 *   real, unnecessary network/server work for a lower-intent signal than hover.
 */
export type PrefetchOptions = {
  onHover?: boolean
  onViewport?: boolean
}

// -- Connection guard --------------------------------------------------------------------------
//
// A silent guard on PREFETCH only — never on real navigation, which always proceeds regardless of
// connection quality (the user already decided to navigate; degrading THAT would be a real
// regression, not an optimization).

/** The subset of the non-standard `navigator.connection` (`NetworkInformation`) this package
 * actually reads — not in TypeScript's own DOM lib, and not implemented by every browser, so this
 * is read defensively (see {@linkcode getConnection}), never assumed to exist. */
export type ConnectionInfo = {
  saveData?: boolean
  effectiveType?: string
}

/**
 * Pure decision over a `ConnectionInfo` snapshot — DOM-free so it's unit-testable without a real
 * `navigator.connection` (unavailable in most browsers anyway, and never in Deno's own test
 * environment). `undefined` (the connection API doesn't exist at all) is never treated as slow —
 * prefetch behaves normally rather than degrading over the absence of a signal, same "never assume
 * the worst from missing information" default the rest of this package follows.
 */
export function isConnectionSlow(connection: ConnectionInfo | undefined): boolean {
  if (!connection) return false
  if (connection.saveData) return true
  return connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g'
}

function getConnection(): ConnectionInfo | undefined {
  return (navigator as Navigator & { connection?: ConnectionInfo }).connection
}

// -- Eligibility ------------------------------------------------------------------------------

/**
 * Decides whether a link should be prefetched at all — a pure, DOM-free function, the prefetch
 * counterpart to `orbit.ts`'s own `shouldInterceptNavigation`. Deliberately narrower: no
 * `hasModifierKey` (hover/focus/viewport are never a click), but adds `connectionIsSlow` (a click
 * still proceeds on a slow connection; a background prefetch shouldn't start one).
 */
export function shouldPrefetch(input: {
  href: string | null
  target: string | null
  hasOptOut: boolean
  isSameOrigin: boolean
  isSameDocumentHashLink: boolean
  connectionIsSlow: boolean
}): boolean {
  if (!input.href) return false
  if (input.hasOptOut) return false
  if (!input.isSameOrigin) return false
  if (input.target && input.target !== '_self') return false
  if (input.isSameDocumentHashLink) return false
  if (input.connectionIsSlow) return false
  return true
}

// -- Cache ------------------------------------------------------------------------------------
//
// A prefetch is a pure optimization: it can fail, expire, or never happen, and none of that may
// ever change what a real navigation does — `swapOutlet` (orbit.ts) only ever CONSULTS this cache
// before falling back to its own existing, uncached fetch path, unchanged.

/** A prefetched fragment's own resolved HTML, plus the SAME `Content-Security-Policy` header its
 * response carried — never discarded the way it used to be (a plain `response.text()`), since
 * `swapOutlet` (`orbit.ts`) needs it for the exact same CSP-mismatch check a live, uncached fetch
 * already runs. See `csp-signature.ts`'s own module doc for the full "why". */
type PrefetchedFragment = { html: string; cspHeader: string | null }

type PrefetchEntry = {
  promise: Promise<PrefetchedFragment>
  controller: AbortController
  expiresAt: number
}

/** How long a prefetched fragment stays eligible for reuse. Short and best-effort: pages without
 * `cacheControl` have no ETag to revalidate against, so this is the only thing bounding staleness
 * for them. Pages WITH `cacheControl` don't strictly need this — the browser's own HTTP cache
 * already revalidates correctly via ETag for the very same request (same URL, same
 * `ORBIT_FRAGMENT_HEADER`) — but this cache still uses the same short window for everyone, rather
 * than trying to tell the two cases apart client-side. */
let prefetchTtlMs = 20_000

/** Soft cap on in-flight prefetches — never queued, a trigger past this limit is simply dropped
 * (the next hover/viewport-entry will try again). Real navigation never competes for this budget;
 * it always fetches immediately, uncapped. */
const MAX_CONCURRENT_PREFETCHES = 4

/** Debounce before a hover/focus actually starts a prefetch — a cursor passing over several links
 * quickly shouldn't fire one request per link, only the one the user actually lingers on. */
const HOVER_DEBOUNCE_MS = 120

const cache = new Map<string, PrefetchEntry>()
let inFlightCount = 0

function isFresh(entry: PrefetchEntry): boolean {
  return Date.now() < entry.expiresAt
}

/**
 * Consumed by `orbit.ts`'s own `swapOutlet` — a fresh prefetched fragment's own `{ html, cspHeader }`
 * promise for `href`, or `undefined` when there's nothing usable (never prefetched, expired,
 * already replaced, or already failed — see {@linkcode schedulePrefetch}'s own doc on immediate
 * eviction). Never throws itself; the returned promise MAY still reject if it's STILL in flight and
 * fails after being handed back (a real click arriving while the SAME prefetch is still pending,
 * which then turns out to fail) — `swapOutlet` already has a real-navigation fallback for exactly
 * that case, the same one an uncached fetch failure degrades to today. An ALREADY-failed prefetch,
 * by contrast, is never returned at all — `swapOutlet` gets `undefined` and performs its own normal,
 * live fetch instead, never a guaranteed replay of a failure that may have been transient.
 */
export function getPrefetchedFragment(href: string): Promise<PrefetchedFragment> | undefined {
  const entry = cache.get(href)
  return entry && isFresh(entry) ? entry.promise : undefined
}

/**
 * Starts (or reuses, or replaces) a prefetch for `href` — the real cache mechanism `considerPrefetch`
 * drives from a hover/focus/viewport trigger. Exported directly (not test-only) since it's genuine
 * internal logic with no DOM dependency of its own — real fetch/AbortController/Headers, all
 * natively available in Deno's own test environment, unlike the DOM-dependent triggers around it.
 */
export function schedulePrefetch(href: string): void {
  const existing = cache.get(href)
  if (existing) {
    if (isFresh(existing)) return // already in flight or freshly resolved — dedup, do nothing
    existing.controller.abort() // stale for the SAME href — replace it; the only case abort is for
  } else if (inFlightCount >= MAX_CONCURRENT_PREFETCHES) {
    return // a genuinely new href, but at capacity — dropped silently, no queue, no retry
  }

  const controller = new AbortController()
  inFlightCount++
  const promise = fetch(href, {
    headers: { [ORBIT_FRAGMENT_HEADER]: '1' },
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Prefetch failed with ${response.status}`)
      // Captured here, off the real response, rather than re-derived later — a fragment's own
      // `Content-Security-Policy` header is exactly what `swapOutlet` (`orbit.ts`) compares against
      // the currently active document's own signature before ever using this prefetch, the same
      // check a live, uncached fetch already runs. See `csp-signature.ts`'s own module doc.
      const cspHeader = response.headers.get('content-security-policy')
      return { html: await response.text(), cspHeader }
    })
    .catch((error) => {
      // A failed prefetch must never be replayed to a real click later — evict it immediately
      // (rather than leaving it "fresh," and reused, for the rest of its own TTL) so
      // `getPrefetchedFragment` genuinely returns `undefined` for it right away, and `swapOutlet`
      // falls through to its own normal, live fetch — a fresh attempt, not a guaranteed repeat of
      // a failure that may have been transient. Only evicts THIS entry: if a newer
      // `schedulePrefetch` call already replaced it (aborting this one and caching a fresh one),
      // that newer entry is a different `controller` and must survive untouched.
      if (cache.get(href)?.controller === controller) cache.delete(href)
      throw error
    })
    .finally(() => {
      inFlightCount--
    })
  // A prefetch nobody ever consumes (TTL expires before a click, or the user never returns to this
  // link) must never surface as an unhandled promise rejection — this catch is purely defensive
  // bookkeeping on a SEPARATE derived promise; it doesn't affect what `getPrefetchedFragment`
  // returns or how its own rejection reaches a real `await` on it later.
  promise.catch(() => {})

  cache.set(href, { promise, controller, expiresAt: Date.now() + prefetchTtlMs })
}

/** Test-only — clears the cache and in-flight counter between tests. Not exported from this
 * package's public entry points. */
export function resetPrefetchState(): void {
  cache.clear()
  inFlightCount = 0
  prefetchTtlMs = 20_000
}

/** Test-only — overrides the TTL new cache entries get, so freshness/staleness can be exercised
 * without a real multi-second wait. Not exported from this package's public entry points. */
export function setPrefetchTtlForTesting(ms: number): void {
  prefetchTtlMs = ms
}

function considerPrefetch(anchor: Element): void {
  if (!(anchor instanceof HTMLAnchorElement)) return
  const href = anchor.getAttribute('href')
  const { resolved, isSameOrigin, isSameDocumentHashLink } = resolveLinkInfo(href)
  const eligible = shouldPrefetch({
    href,
    target: anchor.getAttribute('target'),
    hasOptOut: anchor.hasAttribute('data-orbit-hard'),
    isSameOrigin,
    isSameDocumentHashLink,
    connectionIsSlow: isConnectionSlow(getConnection()),
  })
  if (!eligible || !resolved) return
  schedulePrefetch(resolved.href)
}

// -- Hover/focus trigger (default on) ----------------------------------------------------------
//
// `mouseenter`/`mouseleave` don't bubble, so a single delegated `document` listener only ever
// receives them during the CAPTURE phase (every event, bubbling or not, still passes through
// capture on its way down to the real target) — hence `{ capture: true }` below, not the `false`/
// omitted default used for `click` in orbit.ts. `focusin`/`focusout` bubble normally already.

const hoverTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>()

function startHover(anchor: Element): void {
  if (hoverTimers.has(anchor)) return
  const timer = setTimeout(() => {
    hoverTimers.delete(anchor)
    considerPrefetch(anchor)
  }, HOVER_DEBOUNCE_MS)
  hoverTimers.set(anchor, timer)
}

function cancelHover(anchor: Element): void {
  const timer = hoverTimers.get(anchor)
  if (timer === undefined) return
  clearTimeout(timer)
  hoverTimers.delete(anchor)
}

function onHoverStart(event: Event): void {
  const anchor = findAnchor(event.target)
  if (anchor) startHover(anchor)
}

function onHoverEnd(event: Event): void {
  const anchor = findAnchor(event.target)
  if (anchor) cancelHover(anchor)
}

// -- Viewport trigger (opt-in) ------------------------------------------------------------------

let viewportObserver: IntersectionObserver | undefined

function onIntersect(entries: IntersectionObserverEntry[]): void {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue
    viewportObserver?.unobserve(entry.target) // one-shot per link, same as comets' 'visible' strategy
    considerPrefetch(entry.target)
  }
}

function scanViewportTargets(root: ParentNode): void {
  if (!viewportObserver) return
  root.querySelectorAll('a[href]').forEach((anchor) => viewportObserver?.observe(anchor))
}

// -- Wiring ---------------------------------------------------------------------------------

/**
 * Enables prefetch triggers per `options` — called once by `initOrbit`, never directly. `root`
 * scopes the initial viewport scan (the whole document, on this first call).
 */
export function initPrefetch(root: ParentNode, options: PrefetchOptions | false): void {
  if (options === false) return
  const { onHover = true, onViewport = false } = options

  if (onHover) {
    document.addEventListener('mouseenter', onHoverStart, true)
    document.addEventListener('mouseleave', onHoverEnd, true)
    document.addEventListener('focusin', onHoverStart)
    document.addEventListener('focusout', onHoverEnd)
  }

  if (onViewport) {
    viewportObserver = new IntersectionObserver(onIntersect)
    scanViewportTargets(root)
  }
}

/**
 * Re-scans `root` for new prefetch-eligible anchors — called by `orbit.ts`'s own `swapOutlet`
 * after every navigation swap, for the newly-inserted subtree. A no-op unless viewport prefetch is
 * enabled: hover/focus are delegated on `document` once in {@linkcode initPrefetch} and need no
 * re-registration for anchors that didn't exist yet at that point; `IntersectionObserver.observe`
 * has no delegated equivalent, so newly-inserted anchors need this explicit call to be covered.
 */
export function rescanPrefetchTargets(root: ParentNode): void {
  scanViewportTargets(root)
}
