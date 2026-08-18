/**
 * Serializes a {@linkcode DocumentModel}'s head into raw HTML, and places it inside a rendered
 * document's real `<head>` element.
 *
 * **Why a string-level step exists at all.** React 19 hoists a `<title>`/`<meta>`/`<link>` rendered
 * anywhere in the tree into the document's `<head>`; Preact has no equivalent, and none is planned
 * upstream. Before this module, `@zanix/space` closed that gap by handing the resolved head to the
 * app's own root `layout.tsx` as a `headExtras` prop and depending on that layout to render it —
 * which meant the document's metadata was only as reliable as an app-authored component's
 * cooperation with a prop that was not even part of the public `LayoutProps` type. A root layout
 * that ignored it (the default a generator produced, and the shape every React example used) served
 * pages with no `<title>`, no canonical, no hreflang and no stylesheet links, silently, under Preact
 * only. Doing the placement here instead makes the head a property of the document that the
 * framework guarantees, exactly as it already is under React, with no contract for an app to
 * satisfy.
 *
 * This is the same technique `render-to-response-preact.ts` already uses to place its trailing
 * scripts before `</body>`, applied to the head — not a new category of mechanism for this package.
 *
 * @module
 */
import type { DocumentModel } from './document-model.ts'
import type { HeadLinkTag, HeadMetaTag } from '../router/head-descriptor.ts'
import type { StylesheetRef } from './css-manifest.ts'

/** Escapes a value for use inside a double-quoted HTML attribute. */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Escapes a value for use as HTML text content. */
function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Whether an attribute name is safe to emit verbatim. `HeadLinkTag` accepts arbitrary extra
 * attributes (`type`, `sizes`, `crossorigin`, ...) as a `Record<string, string | undefined>`, so the
 * KEYS are author-supplied too, not just the values — a key containing a quote or a space would
 * break out of the attribute list entirely, which no amount of value-escaping would catch.
 */
function isSafeAttributeName(name: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9:-]*$/.test(name)
}

function renderAttributes(attributes: Record<string, string | undefined>): string {
  return Object.entries(attributes)
    .filter(([name, value]) => value !== undefined && isSafeAttributeName(name))
    .map(([name, value]) => ` ${name}="${escapeAttribute(value as string)}"`)
    .join('')
}

/** One `<meta>` tag. `httpEquiv` is emitted as the real `http-equiv` attribute — the camelCase form
 * is a JSX/DOM-property spelling, never a valid HTML attribute name. */
function renderMetaTag(tag: HeadMetaTag): string {
  const { name, property, httpEquiv, content } = tag
  return `<meta${renderAttributes({ name, property, 'http-equiv': httpEquiv, content })}>`
}

/** One `<link>` tag. Every attribute beyond `rel`/`href` passes through as-is — see
 * `HeadLinkTag`'s own doc on why authors must write real lowercase HTML attribute names. */
function renderLinkTag(tag: HeadLinkTag): string {
  return `<link${renderAttributes(tag as Record<string, string | undefined>)}>`
}

function renderStylesheetLink(ref: StylesheetRef): string {
  const href = typeof ref === 'string' ? ref : ref.href
  const media = typeof ref === 'string' ? undefined : ref.media
  return `<link${renderAttributes({ rel: 'stylesheet', href, media })}>`
}

/**
 * Serializes a {@linkcode DocumentModel}'s head-level content into raw HTML, in the exact order the
 * React serializer renders the same content: this framework's own resolved `<title>`/`<meta>`/
 * `<link>` first, then stylesheet links, then the theme override, then the PWA contribution.
 *
 * The service-worker registration script is deliberately NOT part of this: it belongs at the end of
 * `<body>`, not in `<head>`, and `render-to-response-preact.ts` already has a placement step for
 * exactly that position.
 *
 * @returns The markup, or an empty string when the model contributes nothing at all to the head —
 * so a caller can skip the placement step entirely rather than doing a no-op string scan.
 */
export function serializeHeadMarkup(model: DocumentModel): string {
  const { head, cssHrefs, themeStyle, pwa, nonce } = model
  const parts: string[] = []

  if (head.title !== undefined) parts.push(`<title>${escapeText(head.title)}</title>`)
  for (const tag of head.meta) parts.push(renderMetaTag(tag))
  for (const tag of head.link) parts.push(renderLinkTag(tag))
  for (const ref of cssHrefs) parts.push(renderStylesheetLink(ref))

  // After `cssHrefs`, deliberately — CSS cascade order for equal-specificity `:root` rules is
  // determined by document order, so this is what lets a resolved theme override the static
  // stylesheet's own token declarations.
  if (themeStyle) {
    parts.push(`<style${renderAttributes({ nonce })}>${themeStyle}</style>`)
  }

  if (pwa) {
    parts.push(renderLinkTag({ rel: 'manifest', href: pwa.manifestHref }))
    if (pwa.themeColor) {
      parts.push(renderMetaTag({ name: 'theme-color', content: pwa.themeColor }))
    }
  }

  return parts.join('')
}

/** Matches an opening `<head>` tag, with or without attributes. */
const OPENING_HEAD_TAG = /<head(\s[^>]*)?>/i

/** Matches an opening `<body>` tag, with or without attributes. */
const OPENING_BODY_TAG = /<body(\s[^>]*)?>/i

/**
 * Places `headMarkup` inside `html`'s own `<head>` element, immediately after its opening tag.
 *
 * **Immediately after the opening tag, not before `</head>` — this position is load-bearing.** The
 * HTML Living Standard defines `document.title` as the document's FIRST `title` element, and this
 * package documents a deliberate coexistence contract: an author may render their own `<title>`
 * inside a layout or page, it is never suppressed, and this framework's own resolved title still
 * wins `document.title`. Under React that holds because the resolved head is rendered before page
 * content and React hoists in encounter order. Placing at the front of `<head>` is what makes the
 * same statement true under Preact, for a root layout that renders a `<title>` of its own inside its
 * own `<head>`. Appending before `</head>` would quietly invert it for that case, and the two
 * renderers would stop agreeing on the one thing this contract is about.
 *
 * A consequence worth stating plainly: in the default document shell, this places the resolved head
 * ahead of that shell's own `<meta charset>`. That is safe and intentional. The HTML Standard's
 * requirement for a `meta charset` is that it appear within the first 1024 bytes of the document,
 * not that it be the first child of `<head>`, and this framework additionally declares the encoding
 * at the protocol level on every response (`content-type: text/html; charset=utf-8`), which is
 * independently sufficient under that same rule.
 *
 * @param html - A fully rendered document. Expected to contain a `<head>`; the fallbacks below exist
 * so a malformed one still produces something coherent rather than silently dropping the head.
 * @param headMarkup - From {@linkcode serializeHeadMarkup}. An empty string returns `html` untouched.
 * @returns `html` with the head placed. When there is no `<head>` element at all, a real one is
 * created before `<body>`; when there is no `<body>` either, the markup is prepended. Neither
 * fallback is an expected path — a root layout that renders no `<head>` is a defect that the
 * document-level build validation reports separately — but silently discarding a document's entire
 * metadata is never the right response to it.
 */
export function placeHeadMarkup(html: string, headMarkup: string): string {
  if (!headMarkup) return html

  const headMatch = OPENING_HEAD_TAG.exec(html)
  if (headMatch) {
    const insertAt = headMatch.index + headMatch[0].length
    return html.slice(0, insertAt) + headMarkup + html.slice(insertAt)
  }

  const bodyMatch = OPENING_BODY_TAG.exec(html)
  if (bodyMatch) {
    return html.slice(0, bodyMatch.index) +
      `<head>${headMarkup}</head>` +
      html.slice(bodyMatch.index)
  }

  return headMarkup + html
}
