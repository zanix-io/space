/// <reference lib="dom" />
import { ORBIT_FRAGMENT_HEADER, ORBIT_OUTLET_ATTR } from '../router/orbit-protocol.ts'
import { hydrateComets } from './hydrate-comets.ts'

const TITLE_TAG = /<title>([^<]*)<\/title>/i

/**
 * Decides whether a click on `<a href={href}>` should be intercepted by Orbit at all — a pure,
 * DOM-free function so this decision is unit-testable without a real browser. `onClick` (the real
 * listener) is what actually reads a real `MouseEvent`/`HTMLAnchorElement` into this shape.
 *
 * Mirrors the same escape hatches a plain `<a>` already has by default (a modified click opening a
 * new tab, `target="_blank"`, an external origin) — Orbit only ever takes over the one case a
 * normal link click already means "replace this document," never anything else.
 */
export function shouldInterceptNavigation(input: {
  href: string | null
  target: string | null
  hasOptOut: boolean
  hasModifierKey: boolean
  isSameOrigin: boolean
}): boolean {
  if (!input.href) return false
  if (input.hasOptOut) return false
  if (input.hasModifierKey) return false
  if (!input.isSameOrigin) return false
  if (input.target && input.target !== '_self') return false
  return true
}

/**
 * Pulls a fragment response's `<title>` (if any) out of the raw HTML, and returns the remainder
 * with it removed — a plain regex, not a DOM parser, since `<title>` can only ever contain text
 * (no nested elements are legal inside it per the HTML spec), and this needs to stay usable from a
 * plain string in a unit test, not just a real browser's `DOMParser`.
 */
export function extractFragmentTitle(html: string): { title: string | undefined; body: string } {
  const match = TITLE_TAG.exec(html)
  return { title: match?.[1], body: html.replace(TITLE_TAG, '') }
}

async function swapOutlet(href: string, replace: boolean): Promise<void> {
  let html: string
  try {
    const response = await fetch(href, { headers: { [ORBIT_FRAGMENT_HEADER]: '1' } })
    // Anything other than a normal, successful fragment response (a 404, a 500, a redirect chain
    // that ended somewhere unexpected) degrades to a real navigation instead of risking a whole
    // document's markup getting shoved inside the existing page's own outlet.
    if (!response.ok) throw new Error(`Orbit fragment request failed with ${response.status}`)
    html = await response.text()
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
  const swap = () => {
    outlet.innerHTML = body
    if (title) document.title = title
    hydrateComets(outlet)
  }

  if (document.startViewTransition) document.startViewTransition(swap)
  else swap()

  if (replace) history.replaceState(null, '', href)
  else history.pushState(null, '', href)
}

function findAnchor(target: EventTarget | null): HTMLAnchorElement | undefined {
  if (!(target instanceof Element)) return undefined
  return target.closest('a') ?? undefined
}

function onClick(event: MouseEvent): void {
  const anchor = findAnchor(event.target)
  if (!anchor) return

  const href = anchor.getAttribute('href')
  const intercept = shouldInterceptNavigation({
    href,
    target: anchor.getAttribute('target'),
    hasOptOut: anchor.hasAttribute('data-orbit-hard'),
    hasModifierKey: event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
      event.button !== 0,
    isSameOrigin: href !== null && new URL(href, location.href).origin === location.origin,
  })
  if (!intercept || href === null) return

  event.preventDefault()
  swapOutlet(new URL(href, location.href).href, false)
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
 */
export function initOrbit(): void {
  document.addEventListener('click', onClick)
  addEventListener('popstate', onPopState)
}
