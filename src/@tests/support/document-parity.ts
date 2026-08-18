import type { DocumentSemantics } from 'modules/render/document-model.ts'

/**
 * Shared helpers for comparing documents across renderers.
 *
 * These lived as three near-identical copies — in the page parity suite, the not-found parity suite
 * and the render-probe suite — which meant the definition of "equivalent documents" could drift
 * between the very tests whose job is to enforce it. One definition, three consumers.
 *
 * @module
 */

/**
 * The comparable slice of a document's semantics, with `links` sorted.
 *
 * Sorting matters: `react-dom/server` and `preact-render-to-string` may emit head elements in
 * different orders, and order carries no meaning for a `<link>` set. `titles` is deliberately NOT
 * sorted — order there is the whole point, since only the first becomes `document.title`.
 *
 * `h1Count` is excluded by default. It is a legitimate parity signal (a fixture rendering one `<h1>`
 * must render one under either renderer) but including it here would quietly put heading count into
 * the definition of document equivalence, and `@zanix/space` has no such requirement — see
 * `A11Y006`, which is explicitly non-normative. A caller that wants it asserts it separately.
 */
export function comparableSemantics(doc: DocumentSemantics): Record<string, unknown> {
  return {
    titles: doc.titles,
    meta: doc.meta,
    links: [...doc.links].sort((a, b) =>
      `${a.rel}|${a.hreflang ?? ''}|${a.href}`.localeCompare(
        `${b.rel}|${b.hreflang ?? ''}|${b.href}`,
      )
    ),
    lang: doc.lang,
    isDocument: doc.isDocument,
    hasMetaCharset: doc.hasMetaCharset,
    viewport: doc.viewport,
    hasTextContent: doc.hasTextContent,
  }
}

/**
 * The same slice with every PWA contribution removed — the manifest link and the `theme-color`
 * meta.
 *
 * Used to assert that enabling PWA changes ONLY the PWA contribution and nothing else about the
 * document, which is what "PWA is an orthogonal capability" means in practice.
 */
export function withoutPwaContribution(doc: DocumentSemantics): Record<string, unknown> {
  const base = comparableSemantics(doc)
  return {
    ...base,
    links: (base.links as DocumentSemantics['links']).filter((link) => link.rel !== 'manifest'),
    meta: Object.fromEntries(
      Object.entries(doc.meta).filter(([key]) => key !== 'name:theme-color'),
    ),
  }
}
