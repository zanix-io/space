import { ORBIT_FRAGMENT_HEADER, ORBIT_OUTLET_ATTR } from '../router/orbit-protocol.ts'
import { CSP_SIGNATURE_META_NAME, normalizeCspSignature } from '../router/csp-signature.ts'
import { getCometHydrator, getErrorBoundaryHydrator } from './hydrator-registry.ts'
import { findAnchor, resolveLinkInfo } from './link-info.ts'
import { getPrefetchedFragment, initPrefetch, rescanPrefetchTargets } from './prefetch.ts'
import type { PrefetchOptions } from './prefetch.ts'
import { detachPersistedComets, reuseRetainedComets } from './comet-persistence.ts'

const TITLE_TAG = /<title>([^<]*)<\/title>/i
// Matches a whole `<link ...>` tag as long as `rel="stylesheet"` appears somewhere in its
// attributes — order-independent (`href`/`media`/`rel` can serialize in any order depending on
// which renderer/JSX call produced it) and tolerant of a trailing `/` before `>` (React and Preact
// don't necessarily agree on self-closing void elements). `[^>]*` never crosses a real `>` — safe
// here because none of `href`/`media`/`rel`'s own values (a URL, a CSS media query, the literal
// string `stylesheet`) can legally contain one.
const STYLESHEET_LINK_TAG = /<link\b[^>]*\brel="stylesheet"[^>]*\/?>/g

/**
 * Decides whether a click on `<a href={href}>` should be intercepted by Orbit at all — a pure,
 * DOM-free function so this decision is unit-testable without a real browser. `onClick` (the real
 * listener) is what actually reads a real `MouseEvent`/`HTMLAnchorElement` into this shape.
 *
 * Mirrors the same escape hatches a plain `<a>` already has by default (a modified click opening a
 * new tab, `target="_blank"`, an external origin) — Orbit only ever takes over the one case a
 * normal link click already means "replace this document," never anything else.
 *
 * `isSameDocumentHashLink` is its own escape hatch: an in-page anchor link (`<a href="#section">`,
 * or `<a href="/current/path#section">` while already on that exact path) must NOT be intercepted
 * like an ordinary same-origin link — it needs the browser's own native "scroll to this element"
 * behavior, not a `fetch` of a whole new fragment and a replace of the outlet's `innerHTML` just to
 * reach an anchor already present in the current DOM. `onClick` computes this by comparing the
 * resolved URL's `pathname`+`search` against the current page's own — true only for a genuine
 * "same document, different hash" link, never a link to a different page that merely happens to
 * also carry a hash.
 */
export function shouldInterceptNavigation(input: {
  href: string | null
  target: string | null
  hasOptOut: boolean
  hasModifierKey: boolean
  isSameOrigin: boolean
  isSameDocumentHashLink: boolean
}): boolean {
  if (!input.href) return false
  if (input.hasOptOut) return false
  if (input.hasModifierKey) return false
  if (!input.isSameOrigin) return false
  if (input.target && input.target !== '_self') return false
  if (input.isSameDocumentHashLink) return false
  return true
}

/**
 * Pulls a fragment response's `<title>` (if any) out of the raw HTML, and returns the remainder
 * with it removed — a plain regex, not a DOM parser, since `<title>` can only ever contain text
 * (no nested elements are legal inside it per the HTML spec), and this needs to stay usable from a
 * plain string in a unit test, not just a real browser's `DOMParser`.
 */
export function extractFragmentTitle(
  html: string,
): { title: string | undefined; body: string } {
  const match = TITLE_TAG.exec(html)
  return { title: match?.[1], body: html.replace(TITLE_TAG, '') }
}

/** A single stylesheet reference, exactly as found in a fragment's own HTML — never a distinct
 * "page CSS" vs. "comet CSS" shape: SSR already resolved the real, final list for each; this is
 * just discovery. */
export type FragmentStylesheetRef = { href: string; media?: string }

/**
 * Pulls every `<link rel="stylesheet">` out of a fragment response's raw HTML — a page's
 * own `styles` (rendered as real `<link>`s only in a fragment response, see
 * `render-page-react.tsx`'s own `composeSegments` doc) AND any Comet's own already-inline `<link>`
 * (unconditionally rendered by `CometBoundary` regardless of full-document/fragment, completely
 * unaffected by this function) — treated UNIFORMLY, the same plain-regex approach
 * {@linkcode extractFragmentTitle} already establishes (not a DOM parser), so this stays usable
 * from a plain string in a unit test.
 *
 * Deduplicated by `href` WITHIN this one fragment (first occurrence wins) — cross-checking against
 * what's already live in the DOM is `ensureStylesheetsLoaded`'s own job below, not this pure
 * function's; this only ever answers "what does THIS fragment, on its own, ask for." Returns
 * `refs` in the SAME order they appeared in `html` (declaration order, for a deterministic cascade
 * once inserted), plus `body` — `html` with every matched tag removed and nothing else touched, so
 * the destination's own outlet content never ends up carrying a stylesheet link of its own after
 * the swap.
 */
export function extractStylesheetLinks(
  html: string,
): { refs: FragmentStylesheetRef[]; body: string } {
  const refs: FragmentStylesheetRef[] = []
  const seen = new Set<string>()
  for (const [tag] of html.matchAll(STYLESHEET_LINK_TAG)) {
    const href = /\bhref="([^"]*)"/.exec(tag)?.[1]
    if (!href || seen.has(href)) continue
    seen.add(href)
    const media = /\bmedia="([^"]*)"/.exec(tag)?.[1]
    refs.push(media === undefined ? { href } : { href, media })
  }
  return { refs, body: html.replace(STYLESHEET_LINK_TAG, '') }
}

/** How long Orbit waits for a newly-inserted stylesheet to finish loading before giving up on it
 * and proceeding with the swap anyway — a hard ceiling, not a target. `load`/`error` are the
 * normal, fast path; this exists specifically for whatever neither ever fires for: a hung
 * connection, or any genuine cross-browser uncertainty around whether a `media`-mismatched
 * `<link>`'s own `load` event fires the same way a matching one's does (never assumed here either
 * way — this bound makes the answer irrelevant: either it fires, or this does, but navigation is
 * never blocked longer than this regardless). A stylesheet that times out is treated exactly like
 * one that fired `error` — Orbit proceeds with the swap either way, never blocked indefinitely. */
const STYLESHEET_LOAD_TIMEOUT_MS = 4000

/** Hrefs currently being inserted+awaited by `ensureStylesheetsLoaded`, not yet settled — lets two
 * navigations that overlap and both need the SAME missing stylesheet share one real `<link>`/
 * load-wait instead of each inserting its own duplicate. Cleared as soon as that stylesheet
 * settles (load, error, or timeout). An in-flight tracker only, never a cache of "what CSS
 * exists" — that stays the server's own manifest (`resolveCssHrefs`/`getCometCssHrefs`/
 * `resolvePageCssHrefs`, `css-manifest.ts`), never duplicated here. */
const pendingStylesheetLoads = new Map<string, Promise<void>>()

/** Resolves once `link` fires `load` or `error`, or {@linkcode STYLESHEET_LOAD_TIMEOUT_MS} elapses
 * — whichever comes first. Never rejects: a failed or timed-out stylesheet is `swapOutlet`'s cue to
 * proceed anyway, not to abort the navigation. */
function awaitStylesheetLoad(link: HTMLLinkElement): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = () => resolve()
    link.addEventListener('load', done, { once: true })
    link.addEventListener('error', done, { once: true })
    setTimeout(done, STYLESHEET_LOAD_TIMEOUT_MS)
  })
}

/**
 * Extracts every stylesheet {@linkcode extractStylesheetLinks} finds in `html`, moves whichever
 * aren't already present ANYWHERE in the live document (`document.querySelectorAll` — not just
 * `<head>`, since a Preact full-document load can leave a Comet's own CSS `<link>` inline in
 * `<body>`, never hoisted — see `define-comet.ts`'s own doc) into `document.head`, preserving
 * each one's own `media` attribute unchanged, in the SAME order `extractStylesheetLinks` returned
 * them (inserted synchronously, in a plain loop — cascade order is never left to Promise
 * resolution timing). Awaits every newly-inserted one (never rejects — see
 * {@linkcode awaitStylesheetLoad}), then returns `html` with every stylesheet `<link>` stripped
 * out, so the outlet's own swapped content never ends up carrying one.
 *
 * The only client-side piece of this mechanism — everything else (which stylesheets a destination
 * needs, in what order, with what `media`) was already decided server-side, by the exact same
 * `CssManifest`/`StylesheetRef` resolution a full SSR render uses. No client-side registry
 * duplicates that; this only ever reacts to what THIS response's own HTML already says.
 *
 * Exported (only `swapOutlet` above calls it in real client code) so `ensure-stylesheets-loaded.
 * test.ts` can exercise it directly against a real `happy-dom` document — see that file's own doc
 * for why this is the one function in this module that needed a real DOM instead of a plain
 * string/object fixture.
 */
export async function ensureStylesheetsLoaded(html: string): Promise<string> {
  const { refs, body } = extractStylesheetLinks(html)
  if (refs.length === 0) return html

  const existingHrefs = new Set(
    [...document.querySelectorAll('link[rel="stylesheet"]')]
      .map((link) => link.getAttribute('href')),
  )

  const toAwait: Promise<void>[] = []
  for (const ref of refs) {
    if (existingHrefs.has(ref.href)) continue

    const pending = pendingStylesheetLoads.get(ref.href)
    if (pending) {
      toAwait.push(pending)
      continue
    }

    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = ref.href
    if (ref.media !== undefined) link.media = ref.media
    document.head.appendChild(link) // synchronous — preserves this loop's own, deterministic order

    const promise = awaitStylesheetLoad(link).finally(() => {
      pendingStylesheetLoads.delete(ref.href)
    })
    pendingStylesheetLoads.set(ref.href, promise)
    toAwait.push(promise)
  }

  if (toAwait.length > 0) await Promise.all(toAwait)
  return body
}

/**
 * The CURRENTLY ACTIVE document's own resolved CSP signature — embedded once, at full-document
 * render time, as a `<meta>` tag (see `csp-signature.ts`'s own module doc for the full "why").
 * Read fresh off the DOM on every call rather than cached: this never actually changes for the
 * lifetime of a document (any real CSP difference always goes through a real navigation, which
 * re-evaluates this whole module from scratch), so a plain, uncached read costs nothing extra while
 * staying trivially correct — no cache-invalidation story is needed at all.
 *
 * Exported so `swapOutlet`'s own CSP-mismatch fallback (`orbit-navigation.test.ts`) can be exercised
 * against a real `<meta>` tag inserted into the test's own `happy-dom` document, the same way every
 * other DOM-touching piece of this module is tested.
 */
export function getActiveCspSignature(): string {
  return normalizeCspSignature(
    document.querySelector(`meta[name="${CSP_SIGNATURE_META_NAME}"]`)?.getAttribute('content') ??
      null,
  )
}

async function swapOutlet(href: string, replace: boolean): Promise<void> {
  let html: string
  let cspHeader: string | null
  try {
    // A fresh prefetched fragment (if any) is consumed first. A prefetch that's already KNOWN to
    // have failed is never handed back at all (see `getPrefetchedFragment`'s own doc) — this click
    // gets a normal `fetch()` below, same as if no prefetch had ever been attempted. The only way
    // `prefetched` itself can still reject is if it's STILL in flight and fails after being handed
    // back here — same fallback below either way, this `catch` handles it identically regardless
    // of which path produced it. Prefetching is purely additive: it can be absent, expired,
    // already-evicted-as-failed, or fail while in flight, without changing anything below.
    const prefetched = getPrefetchedFragment(href)
    if (prefetched) {
      ;({ html, cspHeader } = await prefetched)
    } else {
      const response = await fetch(href, {
        headers: { [ORBIT_FRAGMENT_HEADER]: '1' },
      })
      // Anything other than a normal, successful fragment response (a 404, a 500, a redirect
      // chain that ended somewhere unexpected) degrades to a real navigation instead of risking a
      // whole document's markup getting shoved inside the existing page's own outlet.
      if (!response.ok) {
        throw new Error(`Orbit fragment request failed with ${response.status}`)
      }
      cspHeader = response.headers.get('content-security-policy')
      html = await response.text()
    }
  } catch {
    location.href = href
    return
  }

  // A document's active CSP is fixed at the navigation that created it — no later `fetch()`
  // response, regardless of its own headers, is ever consulted by the browser to update it (see
  // `csp-signature.ts`'s own module doc for the full "why"). This fragment's own resolved CSP
  // (`cspHeader`, straight off the same response `mainInterceptor` applied it to server-side) is
  // compared against the CURRENTLY active document's own signature — normalized so a per-request
  // nonce alone never counts as a real difference — and, whenever they genuinely differ, this
  // degrades to a real navigation exactly like a non-ok/failed fetch already does above: the
  // destination is fetched again, for real, by the browser itself this time, which is the one thing
  // that can actually apply its own CSP correctly.
  if (normalizeCspSignature(cspHeader) !== getActiveCspSignature()) {
    location.href = href
    return
  }

  const outlet = document.querySelector(`[${ORBIT_OUTLET_ATTR}]`)
  if (!outlet) {
    location.href = href
    return
  }

  const { title, body } = extractFragmentTitle(html)
  // Awaited BEFORE `swap` is even defined — every stylesheet this destination needs (page CSS,
  // Comet CSS, whichever it turns out to have) is already loaded (or gave up trying) by
  // the time `swap()` runs, so the destination markup is never visible without its own CSS.
  const readyBody = await ensureStylesheetsLoaded(body)

  // Detached BEFORE `outlet`'s own contents are ever touched below — every `persist`-tagged
  // boundary still live in the CURRENT outlet is pulled out here, synchronously, while its own
  // React/Preact instance is still mounted and attached (see comet-persistence.ts's own doc for
  // why this ordering, not a post-hoc rescue of an already-orphaned node, is what makes a
  // persisted instance's state survive at all).
  detachPersistedComets(outlet)

  // Parsed into a detached `<template>`, not injected via a plain string assignment — a real DOM
  // tree is what `reuseRetainedComets` needs to splice a RETAINED LIVE NODE into, in place of its
  // own fresh placeholder, before any of this ever touches the real document.
  const template = document.createElement('template')
  template.innerHTML = readyBody
  reuseRetainedComets(template.content)

  const swap = () => {
    outlet.replaceChildren(template.content)
    if (title) document.title = title
    // The ACTIVE renderer's hydrator, resolved through the registry — never a hardcoded import.
    // This module is re-exported by both client barrels, so importing either implementation
    // directly (as it once did, React's) silently re-hydrates a Preact app with React on every
    // navigation. See `hydrator-registry.ts`'s own doc.
    getCometHydrator()?.(outlet)
    // Same reasoning, same registry — and not merely for symmetry: a `retryOutlet()` swap (this
    // module's own `reset` for a freshly client-mounted `error.tsx` Fallback) lands right back
    // here. Without this call, a segment that fails AGAIN on retry would swap in its own new,
    // un-recovered failure marker and never get a second chance to hydrate it — this page's error
    // UI would just go blank/inert on the second failure, having already used its one and only
    // `hydrateErrorBoundaries()` call at initial page load. See `hydrator-registry.ts`'s own doc.
    getErrorBoundaryHydrator()?.(outlet)
    rescanPrefetchTargets(outlet)
  }

  if (document.startViewTransition) document.startViewTransition(swap)
  else swap()

  if (replace) history.replaceState(null, '', href)
  else history.pushState(null, '', href)
}

/**
 * Re-fetches the CURRENT page's own content from the server and swaps it into the outlet in
 * place — reusing the exact same fetch+swap {@linkcode swapOutlet} already runs for a normal
 * click-driven navigation, just aimed at `location.href` instead of a link's `href`.
 *
 * This is the real "reset" `hydrate-error-boundaries.ts`/`hydrate-error-boundaries-preact.ts` wire
 * up for a freshly client-mounted `error.tsx` Fallback: that mount never received the ORIGINAL
 * component that failed (see those modules' own doc for why — React's own postponed-recovery
 * marker never ships it, and a Preact boundary's real server-rendered Fallback has no live
 * reference to its own erstwhile `children` either), so there is nothing of its own to retry
 * in-place. A genuine round-trip to the server is the only thing that can actually recover from a
 * transient failure — `location.reload()` would do that too, but also throw away scroll position
 * and every other Comet already hydrated on the page, for no reason a full Orbit fragment swap
 * doesn't already avoid.
 *
 * `replace: true`, not `false` — a retry of the SAME url a person is already on is never a new
 * history entry, the same reasoning `onPopState` below already applies to a back/forward
 * navigation landing on an already-known url.
 */
export function retryOutlet(): Promise<void> {
  return swapOutlet(location.href, true)
}

/** Options for {@linkcode navigate}. */
export type NavigateOptions = {
  /** `true` replaces the current history entry (`history.replaceState`) instead of pushing a new
   * one (`history.pushState`, the default) — the same distinction `onClick` (a new entry) and
   * `onPopState` (replace) already make for their own two triggers. */
  replace?: boolean
}

/**
 * Programmatically triggers the same client-side navigation a real, same-origin `<a>` click already
 * does — the one case a click can't cover: a destination only known once some client-side async
 * work resolves, with no anchor involved at all (e.g. a Comet's own event handler navigating after
 * a `fetch()` it made completes).
 *
 * `href` is resolved against the current page exactly like a real link's own `href`
 * ({@linkcode resolveLinkInfo}, the same resolution `onClick` and prefetch's own eligibility check
 * already share). A cross-origin destination, or a same-document hash-only link, gets the same real
 * navigation (`location.href = href`) a plain `<a>` pointing there would already produce on its
 * own — Orbit's fragment swap only ever applies to a same-origin, different-document destination.
 * Every other call runs through the exact same {@linkcode swapOutlet} a real click uses: prefetch
 * reuse, the CSP-signature comparison, stylesheet loading, `persist`-tagged Comet retention, and the
 * same graceful degradation to a full navigation on any failure (a non-2xx fragment response, a
 * network error, a CSP mismatch, or a missing outlet).
 */
export function navigate(href: string, options: NavigateOptions = {}): Promise<void> {
  const { resolved, isSameOrigin, isSameDocumentHashLink } = resolveLinkInfo(href)
  if (!resolved || !isSameOrigin || isSameDocumentHashLink) {
    location.href = resolved?.href ?? href
    return Promise.resolve()
  }
  return swapOutlet(resolved.href, options.replace ?? false)
}

function onClick(event: MouseEvent): void {
  const anchor = findAnchor(event.target)
  if (!anchor) return

  const href = anchor.getAttribute('href')
  const { resolved, isSameOrigin, isSameDocumentHashLink } = resolveLinkInfo(href)
  const intercept = shouldInterceptNavigation({
    href,
    target: anchor.getAttribute('target'),
    hasOptOut: anchor.hasAttribute('data-orbit-hard'),
    hasModifierKey: event.metaKey || event.ctrlKey || event.shiftKey ||
      event.altKey ||
      event.button !== 0,
    isSameOrigin,
    isSameDocumentHashLink,
  })
  if (!intercept || href === null || !resolved) return

  event.preventDefault()
  swapOutlet(resolved.href, false)
}

function onPopState(): void {
  swapOutlet(location.href, true)
}

/**
 * Enables Orbit — instant client-side navigation between pages already served by this same app,
 * with no full document reload after the first one. Call once, from this app's client entry,
 * alongside `hydrateComets()`.
 *
 * Progressive enhancement, not a requirement: every internal `<a>` already works as a normal link
 * before this runs (and still works if a click falls through any of `shouldInterceptNavigation`'s
 * escape hatches, or if the fetch itself fails) — this only ever upgrades that same click, it's
 * never the only way a link works. Opt a specific link out entirely with `data-orbit-hard`. For a
 * navigation with no click to intercept at all, call {@linkcode navigate} directly.
 *
 * `options.prefetch` enables/configures Orbit's own prefetch triggers — see
 * {@linkcode PrefetchOptions}'s own doc for the exact defaults (hover/focus on, viewport opt-in)
 * and what each one does. `false` disables prefetch entirely; omitted uses the defaults. Prefetch
 * is a pure optimization layered on top of everything above — it never changes what a click or
 * `popstate` actually does, only what `swapOutlet` finds already warmed up when one happens.
 */
export function initOrbit(options: { prefetch?: PrefetchOptions | false } = {}): void {
  document.addEventListener('click', onClick)
  addEventListener('popstate', onPopState)
  initPrefetch(document, options.prefetch ?? {})
}
