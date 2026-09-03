/**
 * Shared, dependency-free vocabulary for comparing two `Content-Security-Policy` header values
 * across a client-side navigation — its own module for the same reason `orbit-protocol.ts` is: both
 * the server-only render path (`page-security.ts`, `render-page-react.tsx`/`render-page-preact.ts`)
 * and the client-only Orbit runtime (`orbit.ts`) need this, and neither may pull the other's module
 * graph along.
 *
 * ## Why this exists at all
 *
 * A document's active `Content-Security-Policy` is fixed at the navigation that created it — no
 * later `fetch()` response, regardless of its own headers, is ever consulted by the browser to
 * update it. Orbit's client-side navigation swaps a fragment's markup into the current document
 * without a real navigation, so a destination page whose own resolved CSP differs from the one still
 * enforced on the current document (a stricter or looser `Page({ headers: { csp } })`, or a
 * guard-registered `cspGuard()` that varies the policy per request, not just per route) would
 * otherwise apply silently — enforced against the WRONG, still-active policy, never the one the
 * fetched response actually carried. Comparing the currently active document's own signature
 * (embedded once, at full-document render time, as a `<meta>` tag — see
 * {@linkcode CSP_SIGNATURE_META_NAME}) against a fragment response's own `Content-Security-Policy`
 * header before ever swapping it in is what lets `swapOutlet` fall back to a real navigation exactly
 * when it must, and only then.
 *
 * @module
 */
import type { HeadMetaTag, ResolvedHead } from './head-descriptor.ts'

/**
 * The `<meta>` name a full-document render embeds its own resolved, normalized CSP signature under
 * (`render-page-react.tsx`/`render-page-preact.ts`) — read back by `orbit.ts` before every fragment
 * swap. Never rendered for an Orbit fragment response itself: a fragment isn't a document and
 * carries no `<head>` — Orbit instead reads a fragment's own real signature directly off its
 * `Content-Security-Policy` response header (see {@linkcode normalizeCspSignature}). This is a
 * document `<meta>` name, not a header/cookie this package invents, so it follows this package's own
 * `x-space-*` convention rather than the ecosystem's `X-Znx-` header prefix.
 */
export const CSP_SIGNATURE_META_NAME = 'x-space-csp-signature'

/**
 * Marks "no `Content-Security-Policy` header at all" — {@linkcode normalizeCspSignature}'s output
 * for a `null` input. A real, if unusual, `csp: {}` still serializes to an EMPTY string
 * (`serializeCsp`'s own documented behavior, `csp-guard.ts`), so `''` alone could never distinguish
 * "no header" from "an explicit, empty one" — this sentinel can never collide with a real serialized
 * policy either way, since a real policy is always `directive value[; directive value...]`, never a
 * single Unicode empty-set character.
 */
export const CSP_SIGNATURE_NONE = '∅'

/**
 * Normalizes a `Content-Security-Policy` header value so two otherwise-identical policies compare
 * equal regardless of their own per-request nonce.
 *
 * `cspGuard`'s nonce-generating form — `Page()`'s own zero-config default among others — mints a
 * fresh, cryptographically random nonce on EVERY request, by design (see that function's own doc):
 * without this normalization, a raw string comparison would treat every navigation to the very SAME
 * page as "a different policy," permanently defeating Orbit's own fast path for the overwhelming
 * common case (no real CSP difference at all).
 *
 * `null` (no header) normalizes to {@linkcode CSP_SIGNATURE_NONE} — see that constant's own doc for
 * why it, not `''`, is what a missing header maps to.
 */
export function normalizeCspSignature(header: string | null): string {
  if (header === null) return CSP_SIGNATURE_NONE
  return header.replace(/'nonce-[^']*'/g, "'nonce-*'")
}

/**
 * Returns `head` with ONE extra meta tag appended — this response's own normalized CSP signature,
 * under {@linkcode CSP_SIGNATURE_META_NAME} — the exact addition both `render-page-react.tsx` and
 * `render-page-preact.ts` need for a full-document render, kept in this ONE shared place (an
 * `import type`-only dependency, still erased at runtime — see this module's own doc on why neither
 * renderer's module graph may be pulled into the other) so the two renderers can never drift on it,
 * the same "same page, same document semantics, either renderer" contract `document-model.ts` itself
 * documents.
 *
 * Never call this for a fragment response's own `head` — a fragment isn't a document and Orbit never
 * reads this meta tag from one; it reads a fragment's real signature straight off that same
 * response's `Content-Security-Policy` header instead (see `normalizeCspSignature`'s own doc).
 *
 * Added here, once resolution is already finished, rather than earlier inside `resolveHead()` itself
 * — so a page's or layout's own `head` declaration can never collide with or suppress it. See
 * `metaIdentityKey`'s own doc (`head-descriptor.ts`): a `name`-keyed tag dedupes by that name, and no
 * author code could ever legitimately declare `name: CSP_SIGNATURE_META_NAME` by accident.
 */
export function withCspSignatureMeta(head: ResolvedHead, cspSignature: string): ResolvedHead {
  const metaTag: HeadMetaTag = { name: CSP_SIGNATURE_META_NAME, content: cspSignature }
  return { ...head, meta: [...head.meta, metaTag] }
}
