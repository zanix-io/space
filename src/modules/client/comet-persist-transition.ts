import { COMET_PERSIST_ATTR, COMET_PERSIST_VT_ATTR } from '../comets/marker.ts'
import { hashSourceKey } from '../comets/comet-manifest.ts'

/**
 * Gives a `persist`-tagged Comet boundary its own `view-transition-name` for the duration of an
 * Orbit navigation, so `document.startViewTransition` (`orbit.ts`) treats a genuinely surviving
 * instance as one continuous element instead of folding it into the outlet's default whole-region
 * crossfade.
 *
 * **Why the default crossfade happens at all**: with no element anywhere carrying a
 * `view-transition-name`, the View Transitions API captures the ENTIRE transitioning root as a
 * single before/after image pair and crossfades one into the other — there is no per-element
 * distinction to make. A `persist`-tagged boundary's own DOM node and component state genuinely
 * survive `swapOutlet`'s own swap (`comet-persistence.ts`), but without its own name the browser
 * has no way to know that — it still visibly flashes/jumps as part of the same single crossfade
 * every other, genuinely-replaced part of the outlet goes through.
 *
 * **Why the transition name is a hash of the raw `persist` key, not the key itself**: a
 * `view-transition-name` must be a valid CSS custom-ident, and unique across the whole document
 * for the duration of an active transition (two elements sharing one active name aborts the
 * transition) — an author-supplied `persist` key is an arbitrary string with neither guarantee.
 * {@linkcode hashSourceKey} (`comet-manifest.ts`) already turns an arbitrary string into a stable,
 * deterministic, CSS-safe identifier for exactly this reason; reused here rather than
 * re-implemented. Not a security hash — the same "a real project's key count is far too small for
 * an accidental collision to matter" reasoning `hashSourceKey`'s own doc already makes applies
 * here too.
 *
 * **Why the computed name is written to its own attribute ({@linkcode COMET_PERSIST_VT_ATTR}),
 * not embedded directly into a `[data-orbit-persist="<raw key>"]` selector**: the raw key can
 * contain a quote character, and a CSS parser's own handling of a backslash-escaped quote inside a
 * string of the SAME quote type is not reliably consistent across engines — confirmed directly
 * against this monorepo's own test-time CSS engine (`happy-dom`), which fails to parse a
 * backslash-escaped `"` inside a double-quoted attribute-selector string (and, symmetrically, a
 * backslash-escaped `'` inside a single-quoted one), even though both are valid CSS per spec.
 * Writing the boundary's own ALREADY-SAFE computed name (never the raw key) as a plain attribute
 * value, then selecting on THAT, sidesteps the whole question — the selector never needs to escape
 * anything, because it never carries author-controlled text at all.
 *
 * **Why this is a CSSOM rule inside a nonced `<style>` element, never an inline `style` attribute
 * or `element.style.*` call**: this framework's own zero-config default CSP
 * (`style-src 'self' 'nonce-<per-request>'`) blocks both — a nonce never covers a `style="..."`
 * ATTRIBUTE, and browsers block `element.style.setProperty(...)`/`.style.cssText = ...` under the
 * same `style-src` rule. `sheet.insertRule(...)` into a `<style>` element the CSP nonce already
 * authorizes is the one mechanism that stays CSP-safe — the same technique `@zanix/space-ui`'s
 * `Tooltip`/`Popover` already use for their own dynamic, per-instance positioning
 * ({@linkcode getOrInsertDynamicRule} equivalent, `overlay-position-css.ts` in that package).
 *
 * **Where the nonce itself comes from**: `orbit.ts` is framework-internal client code with no page
 * author ever calling it directly (unlike `Tooltip`/`Popover`, which accept an explicit `nonce`
 * prop a page author threads through from `ctx.locals[CSP_NONCE_LOCALS_KEY]`) — there is no author
 * call site to pass one through here. Every full-document Space response already renders at least
 * one nonced element unconditionally before any client module can even start running
 * (`BUILTIN_CSS`'s own `<style nonce>` in `<head>` — see `builtin-css.ts`'s own doc — or the
 * bootstrap `<script nonce>` itself), so this reads the ALREADY-ACTIVE page's own nonce back off
 * whichever one the parser rendered, the same `document.querySelector('[nonce]')?.nonce` technique
 * `dev-vite-hot-client.ts` already establishes for the identical problem: a real browser
 * deliberately hides a nonce's content attribute from `getAttribute`/`outerHTML` once the element
 * is inserted, for security, but its own `.nonce` IDL property still returns the real value for an
 * element the PARSER actually inserted from real HTML. A page with no CSP configured at all (a
 * page-level `headers: { csp: false }`) simply has no nonced element to find — the `<style>`
 * element created below then carries no `nonce` attribute either, which is correct: no CSP means
 * nothing to authorize in the first place.
 *
 * @module
 */

/** Every distinct `view-transition-name` this module has already inserted a CSSOM rule for, so a
 * later navigation reusing the SAME `persist` key never inserts a duplicate rule — matches the
 * "insert once, never delete-and-reinsert" discipline `getOrInsertDynamicRule`
 * (`@zanix/space-ui`'s `overlay-position-css.ts`) already establishes for the identical class of
 * problem. Left registered for the lifetime of the page rather than evicted alongside
 * `comet-persistence.ts`'s own bounded LRU cache — a stale rule for a `persist` key no longer in
 * use has no visual effect at all outside of an active transition, so there is nothing to clean up
 * that would ever be observable; the accumulated rule count is bounded in practice by how many
 * DISTINCT `persist` keys a real app ever declares, not by how many navigations occur. */
const registeredNames = new Set<string>()

/** The shared `<style>` element every {@linkcode registerPersistTransitionNames} rule is inserted
 * into — created once, lazily, on first use. */
let styleElement: HTMLStyleElement | null = null

/** Computes this `persist` key's own stable `view-transition-name` — the SAME value for the SAME
 * raw key on every call, across every navigation, which is exactly what lets a genuinely reused
 * boundary keep morphing smoothly on a THIRD, FOURTH, ... navigation back to the same key, not just
 * the first one. */
export function persistTransitionName(persistKey: string): string {
  return `znx-persist-${hashSourceKey(persistKey)}`
}

function getOrCreateStyleElement(): HTMLStyleElement | null {
  if (styleElement?.isConnected) return styleElement
  // The previous element (if any) is gone — its own rules went with it, so `registeredNames` no
  // longer describes reality; a name recorded against the OLD element would otherwise make
  // `ensureTransitionNameRule` wrongly believe a fresh element already carries its rule and skip
  // inserting it. Not expected during a real page's lifetime (this element lives in `<head>` for
  // as long as the document does), but keeps this function correct regardless.
  registeredNames.clear()
  const el = document.createElement('style')
  // Assigned BEFORE `appendChild` below, deliberately — a nonce-based CSP evaluates a `<style>`
  // element the INSTANT it enters the document; setting `.nonce` any later is already too late.
  const nonced = document.querySelector('[nonce]') as (Element & { nonce?: string }) | null
  if (nonced?.nonce) el.nonce = nonced.nonce
  document.head.appendChild(el)
  styleElement = el
  return el
}

/** Inserts (idempotently) the CSSOM rule that gives every element carrying
 * `[${COMET_PERSIST_VT_ATTR}="name"]` its own `view-transition-name`. `getOrCreateStyleElement`
 * is called FIRST, unconditionally, specifically so its own staleness check (and the
 * `registeredNames` reset that follows from it) always runs before `registeredNames` is ever
 * consulted below — checking `registeredNames` first would let a name recorded against an
 * element that's since been replaced short-circuit this function before that reset had a chance
 * to run at all. */
function ensureTransitionNameRule(name: string): void {
  const sheet = getOrCreateStyleElement()?.sheet
  if (!sheet) return
  if (registeredNames.has(name)) return
  // `name` is always this module's own {@linkcode persistTransitionName} output — a fixed prefix
  // plus 8 lowercase hex digits, never author-controlled text — so this selector never needs any
  // escaping (see this module's own doc for why that matters).
  sheet.insertRule(
    `[${COMET_PERSIST_VT_ATTR}="${name}"]{view-transition-name:${name}}`,
    sheet.cssRules.length,
  )
  registeredNames.add(name)
}

/**
 * Scans every `persist`-tagged boundary found under each of `roots` and gives it its own
 * `view-transition-name`, ensuring the backing CSSOM rule exists first. Call this BEFORE
 * `document.startViewTransition` is invoked, while the OUTGOING boundary (if any) is still
 * attached to the live document — a detached node contributes nothing to the transition's
 * old-state snapshot, so applying this any later would silently do nothing for it.
 *
 * Both the current, live outlet AND the freshly-parsed destination `<template>` content need
 * scanning, not just one: a boundary can be `persist`-tagged on either side of a navigation without
 * necessarily being reused on both (a key retired on the destination page still gets its own exit
 * treatment instead of the whole-page crossfade; a key appearing there for the first time still
 * gets its own entrance instead of appearing as part of it) — `reuseRetainedComets`'s later splice
 * (`comet-persistence.ts`) preserves whichever attribute this already wrote onto a REUSED node
 * either way, since it moves the same element, never a copy.
 *
 * A no-op, before touching anything, when the browser has no View Transitions support at all
 * (`swapOutlet` never wraps `swap` in one in that case, so nothing would ever read this).
 */
export function registerPersistTransitionNames(...roots: ParentNode[]): void {
  if (!document.startViewTransition) return

  for (const root of roots) {
    const boundaries = root.querySelectorAll(`[${COMET_PERSIST_ATTR}]`)
    boundaries.forEach((boundary) => {
      const key = boundary.getAttribute(COMET_PERSIST_ATTR)
      if (!key) return
      const name = persistTransitionName(key)
      ensureTransitionNameRule(name)
      boundary.setAttribute(COMET_PERSIST_VT_ATTR, name)
    })
  }
}
