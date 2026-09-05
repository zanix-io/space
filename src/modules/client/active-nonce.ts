/**
 * Reads the CSP nonce the ACTIVE document is really enforcing right now — as opposed to
 * `csp-signature.ts`'s own `normalizeCspSignature`, which deliberately strips the nonce OUT of its
 * comparison (two pages sharing the same CSP *shape* shouldn't hard-navigate just because their
 * per-request nonces differ) and so has no value to hand back. Orbit (`orbit.ts`) only ever swaps
 * the page's own OUTLET, never the whole document, so the active document's own enforced nonce
 * never changes across a soft navigation even though a newly-fetched fragment's own resolved
 * `PageContext.cspNonce` reflects a DIFFERENT, separately-minted value for that fragment. A Comet
 * that bakes its own `cspNonce` prop into freshly-generated inline content (a `<style nonce>`
 * built client-side, say) gets a value that structurally cannot match what the browser is actually
 * enforcing after a soft swap — this function is what such a Comet should read instead.
 *
 * @module
 */

/**
 * Returns the nonce a real, parsed HTML element currently carries, or `undefined` on a page with
 * no nonce-based CSP configured at all (nothing to find). Every full-document Space response
 * renders at least one nonced element unconditionally before any client module can even start
 * running (`BUILTIN_CSS`'s own `<style nonce>` in `<head>`, or the bootstrap `<script nonce>`
 * itself), so a page with a nonce-based CSP always has something for this to find.
 *
 * Reads the `.nonce` IDL property, never `getAttribute('nonce')` — a real browser deliberately
 * hides a nonce's own content attribute from `getAttribute`/`outerHTML` once the element is
 * inserted, for security, but the IDL property still returns the real value for an element the
 * PARSER itself inserted from real HTML. Same technique already established, for the identical
 * problem, by `comet-persist-transition.ts` (giving a dynamically-created `<style>` element the
 * currently-enforced nonce) — this module exists so both it and any Comet author's own code share
 * one implementation instead of a second hand-rolled copy.
 */
export function getActiveCspNonce(): string | undefined {
  const nonced = document.querySelector('[nonce]') as (Element & { nonce?: string }) | null
  return nonced?.nonce || undefined
}
