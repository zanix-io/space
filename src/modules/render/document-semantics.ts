/**
 * Extracts a {@linkcode DocumentSemantics} from a rendered HTML document — the renderer-agnostic
 * half of this package's cross-renderer contract.
 *
 * **Why extraction rather than string comparison.** `react-dom/server` and `preact-render-to-string`
 * legitimately disagree about things that carry no meaning: attribute order within a tag, whether a
 * void element closes as `<meta>` or `<meta/>`, how a boolean attribute is spelled, where
 * incidental whitespace lands. Asserting on the HTML string would make every one of those a test
 * failure and none of them a real one. What this package actually promises is narrower and
 * checkable: given the same page, layout chain and resolved data, both renderers produce a document
 * that *means* the same thing. This function is what turns that promise into something a test can
 * compare with `assertEquals`.
 *
 * **Deliberately regex-based, with a stated limit.** There is no HTML parser in this package's
 * dependency graph, and adding one to support a contract test would be a poor trade. The input here
 * is never arbitrary web HTML — it is always a document this framework itself just rendered, from
 * markup this framework itself emitted. Within that scope the patterns below are exact. They are
 * NOT a general-purpose parser and must not be reused as one: they do not handle comments
 * containing tag-like text, CDATA, or attribute values containing a raw `>`. `extractBodyText` in
 * particular is a crude tag-strip whose only job is answering "did SSR emit any text at all", never
 * reproducing rendered text faithfully.
 *
 * @module
 */
import type { DocumentSemantics } from './document-model.ts'

/** Matches one attribute: `name="value"`, `name='value'`, or a bare `name`. */
const ATTRIBUTE = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

/** Decodes the small set of entities this framework's own serializers ever emit. */
function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** Parses a tag's attribute list into a plain lowercase-keyed record. */
function parseAttributes(tagBody: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  ATTRIBUTE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ATTRIBUTE.exec(tagBody)) !== null) {
    const name = match[1].toLowerCase()
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    attributes[name] = decodeEntities(value)
  }
  return attributes
}

/** Every occurrence of `<tagName ...>` in the document, as parsed attribute records. */
function collectTags(html: string, tagName: string): Array<Record<string, string>> {
  const pattern = new RegExp(`<${tagName}(\\s[^>]*)?/?>`, 'gi')
  const found: Array<Record<string, string>> = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    found.push(parseAttributes(match[1] ?? ''))
  }
  return found
}

/** The document's body text, tags stripped and whitespace collapsed. See this module's own doc for
 * why this is deliberately crude. */
function extractBodyText(html: string): string {
  const bodyMatch = /<body(?:\s[^>]*)?>([\s\S]*)<\/body>/i.exec(html)
  const body = bodyMatch ? bodyMatch[1] : html
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extracts the comparable semantics of a rendered document.
 *
 * **Purely observational — it resolves nothing.** This function never merges, deduplicates,
 * reorders or defaults anything; it reports exactly what the HTML contains. That separation is the
 * point: `resolveHead` (`router/head-descriptor.ts`) owns every resolution decision, the serializers
 * only render what it produced, and this function only reads back what they rendered. If a document
 * ends up with two `<link rel="canonical">`, this reports two — it is not the layer that would
 * quietly fix it, and a test asserting exactly one is therefore really asserting that the
 * RESOLUTION was right, not that the extractor was forgiving.
 *
 * @param html - A document this framework rendered. See this module's own doc for the scope limit.
 * @returns See {@linkcode DocumentSemantics}.
 */
export function extractDocumentSemantics(html: string): DocumentSemantics {
  const titles = [...html.matchAll(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/gi)]
    .map((match) => decodeEntities(match[1].trim()))

  const meta: Record<string, string> = {}
  let hasMetaCharset = false
  let viewport: string | undefined
  for (const tag of collectTags(html, 'meta')) {
    if ('charset' in tag) {
      hasMetaCharset = true
      continue
    }
    const identity = tag.name !== undefined
      ? `name:${tag.name}`
      : tag.property !== undefined
      ? `property:${tag.property}`
      : tag['http-equiv'] !== undefined
      ? `httpEquiv:${tag['http-equiv']}`
      : undefined
    // A `Content-Type` http-equiv is also a real encoding declaration under the HTML Standard, so
    // it counts for `hasMetaCharset` in addition to being reported as an ordinary meta tag.
    if (
      tag['http-equiv']?.toLowerCase() === 'content-type' && /charset=/i.test(tag.content ?? '')
    ) {
      hasMetaCharset = true
    }
    if (identity === 'name:viewport') viewport = tag.content
    if (identity !== undefined && tag.content !== undefined) meta[identity] = tag.content
  }

  const links = collectTags(html, 'link')
    .filter((tag) => tag.rel !== undefined && tag.href !== undefined)
    .map((tag) => ({
      rel: tag.rel,
      href: tag.href,
      ...(tag.hreflang !== undefined ? { hreflang: tag.hreflang } : {}),
    }))

  const htmlTag = /<html(\s[^>]*)?>/i.exec(html)
  const lang = htmlTag ? parseAttributes(htmlTag[1] ?? '').lang : undefined

  const bodyText = extractBodyText(html)

  return {
    titles,
    meta,
    links,
    lang,
    isDocument: /<!doctype html>/i.test(html) && htmlTag !== null && /<body(\s|>)/i.test(html),
    hasMetaCharset,
    viewport,
    h1Count: (html.match(/<h1(\s[^>]*)?>/gi) ?? []).length,
    hasTextContent: bodyText.length > 0,
  }
}
