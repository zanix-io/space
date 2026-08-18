/// <reference lib="dom" />
import { ORBIT_FRAGMENT_HEADER, ORBIT_OUTLET_ATTR } from '../router/orbit-protocol.ts'
import { getCometHydrator } from './hydrator-registry.ts'
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
 * `isSameDocumentHashLink` is its own escape hatch, real bug fixed here: an in-page anchor link
 * (`<a href="#section">`, or `<a href="/current/path#section">` while already on that exact path)
 * used to be intercepted like any other same-origin link — `swapOutlet` would then `fetch` a whole
 * new fragment and replace the outlet's `innerHTML` just to reach an anchor already present in the
 * current DOM, discarding the browser's own native "scroll to this element" behavior entirely (a
 * real, user-visible regression: no smooth native scroll, an unnecessary network round-trip, and
 * `<a href="#section">` clicked twice would re-fetch and re-render identical content each time).
 * `onClick` computes this by comparing the resolved URL's `pathname`+`search` against the current
 * page's own — true only for a genuine "same document, different hash" link, never a link to a
 * different page that merely happens to also carry a hash.
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
 * "page CSS" vs. "comet CSS" shape (P2-12d's own point): SSR already resolved the real, final
 * list for each; this is just discovery. */
export type FragmentStylesheetRef = { href: string; media?: string }

/**
 * Pulls every `<link rel="stylesheet">` (P2-12d) out of a fragment response's raw HTML — a page's
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
 * The one client-side piece P2-12d adds — everything else (which stylesheets a destination needs,
 * in what order, with what `media`) was already decided server-side, by the exact same
 * `CssManifest`/`StylesheetRef` resolution a full SSR render uses. No client-side registry
 * duplicates that; this only ever reacts to what THIS response's own HTML already says.
 */
async function ensureStylesheetsLoaded(html: string): Promise<string> {
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

async function swapOutlet(href: string, replace: boolean): Promise<void> {
  let html: string
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
      html = await prefetched
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
      html = await response.text()
    }
  } catch {
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
  // Comet CSS, whichever it turns out to have) is already loaded (or gave up trying, P2-12d) by
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
    rescanPrefetchTargets(outlet)
  }

  if (document.startViewTransition) document.startViewTransition(swap)
  else swap()

  if (replace) history.replaceState(null, '', href)
  else history.pushState(null, '', href)
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
 * never the only way a link works. Opt a specific link out entirely with `data-orbit-hard`.
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
