/**
 * Space's own, renderer-agnostic `<title>`/`<meta>`/`<link>` resolution — the first iteration of
 * this package's own head-management decision spike (`title`/`meta`/`link` only; `style`/`script`
 * deliberately deferred until a real use case exists). A page (`SpacePageController.head`) or any
 * layout in its composition chain (`layout.tsx`'s own named `head` export) declares a
 * {@linkcode HeadDescriptor}; {@linkcode resolveHead} merges every declared descriptor in the
 * chain into one final, deterministic result — computed synchronously, BEFORE either renderer
 * renders anything (same timing `loader` already resolves data at), same reasoning the legacy
 * Zanix stack's own `tagProcessor()` used: a real head-management problem doesn't need to interact
 * with streaming/Suspense at all if it's resolved as plain data ahead of render.
 *
 * **Precedence**: page wins over its nearest layout, which wins over the next one out, ... down to
 * the root layout — checked field by field (`title`), or per identity key (`meta`/`link`), never
 * whole-descriptor-replaces-whole-descriptor. `resolveHead`'s own `descriptorsMostSpecificFirst`
 * parameter takes the already-ordered list (page first) — see either `composeSegments`'s own call
 * site (`render-page-react.tsx`/`render-page-preact.ts`) for how that order is built from the
 * existing root-to-leaf `segments` array this package's router already walks.
 *
 * **Deduplication**: `meta` by identity key (`name`, `property`, or `httpEquiv` — whichever the tag
 * declares; a tag with none of the three is never deduplicated against another). `link` by
 * `rel`+`href`+`hreflang` (the last one only matters for `rel="alternate"` hreflang links, e.g.
 * `buildHreflangLinks` — an `x-default` entry legitimately shares its `href` with another
 * language's own entry whenever that language IS the site's default, and the two must both
 * survive; every other `<link>` kind never sets `hreflang`, so it dedupes by `rel`+`href` alone
 * exactly as before) — EXCEPT a singleton rel ({@linkcode SINGLETON_LINK_RELS}, currently
 * `canonical` alone), which dedupes by `rel` ALONE so that at most one ever survives, whatever the
 * `href`s were. The most specific declaration for a given key wins; different keys all survive.
 *
 * **Ordering**: deterministic by construction — `meta`/`link` entries appear in the order their
 * winning declaration was first encountered, walking from most specific (page) to least (root).
 * Never dependent on registration order at runtime.
 *
 * **Coexistence with a manually-authored JSX `<title>`/`<meta>`/`<link>`** (React's own native
 * hoisting, explicitly PRESERVED, never suppressed or disabled — see this package's own decision
 * spike for the full investigation): `resolveHead`'s own output is rendered by
 * `render-to-response.tsx` BEFORE a page's own element tree (same position `cssHrefs`/`pwaHead`
 * already render at) — confirmed empirically (real `renderToReadableStream`, not just read from
 * React's source) that React's hoisting flushes tags into the real `<head>` in ENCOUNTER order, not
 * some other order. Per the HTML Living Standard, `document.title` is defined as the document's
 * FIRST `title` element — so Space's own resolved `<title>`, always encountered first, is always
 * the one a browser's `document.title`/a `<meta>` "first match" reader actually sees, without this
 * package ever detecting, removing, or otherwise touching whatever an author separately renders.
 * Preact has no hoisting at all (confirmed absent in this package's own earlier decision spike), so
 * the same outcome holds there even more directly: Space's resolved head is placed literally inside
 * the real `<head>` element (`document-shell-preact.ts`), which always precedes `<body>` — a
 * manually-authored `<title>` inside Preact page content renders wherever it is in `<body>` and
 * never becomes `document.title` at all, since Preact never moves it into `<head>`. Both renderers
 * land on the SAME deterministic rule — "Space's resolved head is the first `<title>`/first
 * matching `<meta>` in the document" — through each renderer's own real mechanism, not a shared
 * implementation, and neither an author's own separately-rendered tag nor React's own hoisting is
 * ever disabled to make this true.
 *
 * @module
 */

/** A single `<meta>` declaration. Exactly one of `name`/`property`/`httpEquiv` is expected —
 * whichever is set is this tag's identity key for {@linkcode resolveHead}'s own deduplication. A
 * tag with none of the three set is never deduplicated against another — not even against an
 * identical one (same `content`) declared at a different level of the same composition chain: with
 * no identity to compare, {@linkcode resolveHead} always keeps every such tag, so two levels each
 * declaring `{ content: 'x' }` produce two literal `<meta content="x">` tags in the output, not one.
 * This is a deliberate consequence of having no identity to dedupe by, not a bug — a descriptor that
 * needs dedup should set `name`/`property`/`httpEquiv`. */
export type HeadMetaTag = {
  name?: string
  property?: string
  httpEquiv?: string
  content: string
}

/** A single `<link>` declaration — `rel`+`href` (plus `hreflang`, when set — see
 * {@linkcode resolveHead}'s own doc for why) together are this tag's identity key for
 * `resolveHead`'s own deduplication, EXCEPT for the singleton rels listed in
 * {@linkcode SINGLETON_LINK_RELS}, which dedupe by `rel` alone. Any other valid `<link>` attribute (`type`, `sizes`,
 * `crossOrigin`, ...) passes through as-is — **use the real HTML attribute's exact lowercase
 * spelling** (`hreflang`, not `hrefLang`): this object is spread directly onto a real
 * `<link {...tag} />` element (`render-to-response.tsx`), and React only translates a small,
 * hardcoded set of camelCase DOM property names to their real HTML attribute (`className`,
 * `htmlFor`, ...) — `hrefLang` is not among them, so it would render VERBATIM as the invalid
 * attribute `hrefLang="en"` instead of the real `hreflang="en"` a crawler expects (confirmed
 * empirically, not assumed — see `buildHreflangLinks`, `modules/seo/hreflang.ts`, the one place
 * this package itself produces `hreflang` tags). Preact's own serializer (`document-shell-preact.ts`)
 * diverges here — confirmed empirically it normalizes `hrefLang` to `hreflang` on its own — but the
 * contract stays the single, renderer-independent rule above: always write the real lowercase
 * attribute name, and both renderers produce the same correct output (see
 * `document-shell-preact.test.tsx`'s own "hreflang" case). */
export type HeadLinkTag = { rel: string; href: string } & Record<string, string | undefined>

/**
 * What a page (`SpacePageController.head`) or a layout (`layout.tsx`'s own named `head` export)
 * declares — `style`/`script` deliberately NOT included in this first iteration (see this module's
 * own doc). A plain object for a static declaration, or a function for one that depends on
 * `params`/loader data — see `SpacePageController.head`'s and the `layout.tsx` `head` export's own
 * doc for the exact function signature each accepts. See `SpacePageController.head`'s own doc for
 * the coexistence contract with a manually-authored JSX `<title>`/`<meta>`/`<link>` — this
 * declaration always wins `document.title`/first-match `<meta>`, without ever suppressing the
 * author's own tag.
 */
export type HeadDescriptor = {
  title?: string
  meta?: HeadMetaTag[]
  link?: HeadLinkTag[]
}

/** {@linkcode resolveHead}'s own return shape — always fully resolved, no more merging left to do:
 * `meta`/`link` are always arrays (never `undefined`), already deduplicated and ordered. */
export type ResolvedHead = {
  title?: string
  meta: HeadMetaTag[]
  link: HeadLinkTag[]
}

/**
 * `<link>` rels that are **singletons per document** — at most one may ever survive
 * {@linkcode resolveHead}, no matter how many segments declare one, and no matter whether their
 * `href`s agree. The most specific declaration wins outright (page over its nearest layout, over
 * the next one out, ...), exactly like {@linkcode HeadDescriptor.title} already does.
 *
 * This is a **`@zanix/space` framework invariant, not an HTML or search-engine requirement** — the
 * distinction matters and is deliberate. The HTML Living Standard does not forbid a second
 * `<link rel="canonical">`, and Google's own canonicalization documentation describes `rel=canonical`
 * only as "a strong signal", never documenting what it does when a page declares two conflicting
 * ones. What makes this a hard rule *here* is narrower and fully within this package's control: a
 * canonical URL is a per-URL fact, while a `layout.tsx` is shared across every route beneath it, so
 * two different canonical `href`s reaching the same document is an unambiguous internal
 * contradiction in output this framework itself produced — there is no reading of it that is
 * correct. Resolving it deterministically (most specific wins) is strictly better than emitting
 * both and leaving the outcome to whatever consumes the page.
 *
 * Matched case-insensitively against the tag's own `rel`, trimmed — HTML link types are
 * ASCII case-insensitive, so `rel="Canonical"` is the same singleton as `rel="canonical"`. A
 * space-separated compound `rel` (e.g. `rel="canonical alternate"` — valid HTML, but never produced
 * by this package's own helpers) is NOT recognized as a singleton: it dedupes by the full
 * `rel`+`href`+`hreflang` key like any other link, since collapsing a compound rel by its first
 * token would silently discard the other tokens' meaning.
 *
 * Deliberately does NOT include `rel="manifest"` even though that is equally a per-document
 * singleton: this package's own manifest link never travels through a `HeadDescriptor` at all — it
 * comes from `resolvePwaHead()` (`pwa/pwa-registry.ts`) and is rendered by the document serializer
 * directly, so there is nothing here for a rule about it to act on.
 */
export const SINGLETON_LINK_RELS: ReadonlySet<string> = new Set(['canonical'])

/**
 * This tag's identity for deduplication. A singleton rel ({@linkcode SINGLETON_LINK_RELS}) keys on
 * `rel` alone, so the most specific declaration wins outright and every later one is dropped
 * regardless of `href`. Every other link keys on `rel`+`href`+`hreflang` — see
 * {@linkcode resolveHead}'s own doc for why `hreflang` has to be part of that key.
 *
 * **Exported so that every document serializer keys its rendered elements by the SAME identity
 * `resolveHead` deduplicated them by.** This is not a convenience: React requires a `key` on each
 * element of a rendered array, and an earlier version of `render-to-response.tsx` computed its own
 * `` `${rel}:${href}` `` key independently of this function. That drifted the moment `hreflang`
 * entered the dedup key — a full hreflang set contains, by design, an `x-default` entry sharing its
 * `href` with the default language's own entry, so the two survived `resolveHead` as distinct tags
 * and then collided under one duplicate React key on every i18n page. Deriving both from this one
 * function makes that class of drift structurally impossible rather than merely fixed once.
 */
export function linkIdentityKey(tag: HeadLinkTag): string {
  const rel = tag.rel.trim().toLowerCase()
  if (SINGLETON_LINK_RELS.has(rel)) return `singleton:${rel}`
  return `${tag.rel}:${tag.href}:${tag.hreflang ?? ''}`
}

/**
 * This meta tag's identity for deduplication — `name`, `property`, or `httpEquiv`, whichever it
 * declares — or `undefined` for a tag declaring none of the three, which {@linkcode resolveHead}
 * never deduplicates against anything (see {@linkcode HeadMetaTag}'s own doc).
 *
 * Exported for the same reason as {@linkcode linkIdentityKey}: a serializer keys its rendered
 * `<meta>` elements by this, and must handle the `undefined` case with a positional fallback rather
 * than letting several identity-less tags share one `undefined` key.
 */
export function metaIdentityKey(tag: HeadMetaTag): string | undefined {
  if (tag.name !== undefined) return `name:${tag.name}`
  if (tag.property !== undefined) return `property:${tag.property}`
  if (tag.httpEquiv !== undefined) return `httpEquiv:${tag.httpEquiv}`
  return undefined
}

/**
 * Merges every descriptor in a page's composition chain into one final, deterministic
 * {@linkcode ResolvedHead} — pure, synchronous, no renderer/JSX/Context involved, so the SAME
 * function serves both `render-page-react.tsx` and `render-page-preact.ts`.
 *
 * @param descriptorsMostSpecificFirst - Ordered page-first, then each layout from nearest to root
 * (`undefined` entries — a segment with no `head` at all — are simply skipped). Building this order
 * from the router's own root-to-leaf `segments` array is the caller's job (both `composeSegments`
 * implementations do this identically) — this function itself has no opinion on where the order
 * comes from, only that it's already most-specific-first.
 */
export function resolveHead(
  descriptorsMostSpecificFirst: Array<HeadDescriptor | undefined>,
): ResolvedHead {
  let title: string | undefined
  const metaByKey = new Map<string, HeadMetaTag>()
  // Tags with no identity key at all (none of name/property/httpEquiv set) are never deduplicated
  // — each is its own, permanently-unique entry.
  const metaWithoutKey: HeadMetaTag[] = []
  const linkByKey = new Map<string, HeadLinkTag>()

  for (const descriptor of descriptorsMostSpecificFirst) {
    if (!descriptor) continue

    if (title === undefined && descriptor.title !== undefined) {
      title = descriptor.title
    }

    for (const tag of descriptor.meta ?? []) {
      const key = metaIdentityKey(tag)
      if (key === undefined) {
        metaWithoutKey.push(tag)
      } else if (!metaByKey.has(key)) {
        metaByKey.set(key, tag)
      }
    }

    for (const tag of descriptor.link ?? []) {
      // See `linkIdentityKey` for the full rule. Two cases it encodes, both found as real bugs
      // rather than anticipated:
      //
      // 1. `rel`+`href` ALONE is too coarse for `rel="alternate"` hreflang links specifically: an
      //    `x-default` entry legitimately shares the exact same `href` as another language's own
      //    entry whenever that language happens to be the site's default (a common case, not an
      //    edge case — most visitors land on a default-language site) — the two are semantically
      //    distinct signals (`hreflang="en"` vs `hreflang="x-default"`) that must both survive, not
      //    collapse into one. Found while wiring `buildHreflangLinks` (`modules/seo/hreflang.ts`)
      //    through a real end-to-end test.
      // 2. `rel`+`href` is, conversely, too FINE for `rel="canonical"`: two segments declaring
      //    different canonical `href`s produced two conflicting canonical links in one document,
      //    because differing hrefs meant differing keys meant no dedup at all — the page's own
      //    declaration never got to win over a layout's the way `title` already did. Singleton rels
      //    key on `rel` alone precisely so precedence applies to them. See
      //    `SINGLETON_LINK_RELS`'s own doc for why this is a framework invariant rather than a
      //    spec requirement.
      const key = linkIdentityKey(tag)
      if (!linkByKey.has(key)) linkByKey.set(key, tag)
    }
  }

  return {
    title,
    meta: [...metaByKey.values(), ...metaWithoutKey],
    link: [...linkByKey.values()],
  }
}
