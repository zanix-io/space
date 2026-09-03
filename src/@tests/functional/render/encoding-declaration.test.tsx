import { assert, assertEquals } from '@std/assert'
import { createElement as reactCreateElement } from 'react'
import { createElement as preactCreateElement } from 'preact'
import { SpacePageController } from 'modules/router/mod.ts'
import { setPageTree } from 'modules/router/page-tree-registry.ts'
import { mockPageContext } from 'modules/testing/mod.ts'
import { extractDocumentSemantics } from 'modules/render/document-semantics.ts'
import { renderPageResponse as renderReact } from 'modules/router/render-page-react.tsx'
import { renderPageResponse as renderPreact } from 'modules/router/render-page-preact.ts'
import { CSP_SIGNATURE_NONE } from 'modules/router/csp-signature.ts'

console.error = () => {}

// ================================================================================================
// The document's character-encoding declaration.
//
// Moving head placement to the front of `<head>` (see `placeHeadMarkup`) means that ON THE PREACT
// PATH the resolved head now precedes the default shell's own `<meta charset>`. React orders the two
// the other way round, because its shell emits the charset inside the tree and hoisting resolves the
// order. Neither ordering carries meaning, but that must not be left as an unstated assumption about
// "the first 1024 bytes" — hence this file.
//
// The contract, in order of authority:
//
//   1. PRIMARY — every response this framework produces carries the encoding at the protocol level,
//      in the `Content-Type` header (`text/html; charset=utf-8`). Under the HTML Standard this alone
//      satisfies the requirement to declare the document's encoding; the `<meta>` is not what the
//      framework relies on.
//   2. SECONDARY — the default document shell also emits a `<meta charset="utf-8">`, which matters
//      for the cases the header does not cover: a page saved to disk, or served through something
//      that rewrites headers.
//   3. The POSITION of that meta carries no semantics. It is asserted below to still fall well
//      inside the 1024-byte window the Standard specifies, so the secondary declaration remains
//      valid on its own terms too — but no behavior depends on it being first.
// ================================================================================================

/** The HTML Standard's own limit for a `meta charset` declaration: it must appear within the first
 * 1024 bytes of the document. */
const ENCODING_DECLARATION_BYTE_LIMIT = 1024

/**
 * Matches ONLY a real `<meta charset="...">` element — the exact form both serializers emit, with or
 * without a self-closing slash.
 *
 * Deliberately precise rather than a loose `<meta[^>]+charset[^>]*>`. That looser shape was tried
 * first and was genuinely wrong: this file's own fixture declares a `description` whose text
 * contains the word "charset", and the loose pattern matched THAT tag instead, silently deleting a
 * meta the test then reported as a framework divergence. The framework was correct; the test's regex
 * was not. Requiring `charset` to be an attribute NAME (followed by `=`) is what makes the
 * difference. Note that `extractDocumentSemantics` itself never had this problem — it parses the
 * attribute list rather than pattern-matching the tag.
 */
const CHARSET_META = /<meta\s+charset\s*=\s*["'][^"']*["']\s*\/?>/i

function ReactView() {
  return reactCreateElement('main', null, reactCreateElement('h1', null, 'Encoding'))
}
function PreactView() {
  return preactCreateElement('main', null, preactCreateElement('h1', null, 'Encoding'))
}

class ReactEncodingPage extends SpacePageController {
  public override component = ReactView
  public static override head = {
    title: 'Encoding — a deliberately long title so the resolved head is not trivially small',
    meta: [
      {
        name: 'description',
        content: 'A page whose head is large enough to push the charset back.',
      },
      { property: 'og:title', content: 'Encoding' },
      { property: 'og:description', content: 'A page whose head is large enough to matter.' },
    ],
    link: [
      { rel: 'canonical', href: 'https://example.com/encoding' },
      { rel: 'alternate', href: 'https://example.com/en/encoding', hreflang: 'en' },
      { rel: 'alternate', href: 'https://example.com/es/encoding', hreflang: 'es' },
    ],
  }
}

class PreactEncodingPage extends SpacePageController {
  public override component = PreactView
  public static override head = ReactEncodingPage.head
}

async function render(renderer: 'react' | 'preact'): Promise<Response> {
  const Page = renderer === 'react' ? ReactEncodingPage : PreactEncodingPage
  const View = renderer === 'react' ? ReactView : PreactView
  setPageTree(Page, { filePath: `/fake/encoding-${renderer}.tsx`, segments: [] })
  const renderPage = renderer === 'react' ? renderReact : renderPreact
  return await renderPage(
    Page as never,
    View,
    mockPageContext({ url: new URL('https://example.com/encoding') }),
    undefined,
    false,
    undefined,
    undefined,
    CSP_SIGNATURE_NONE,
  )
}

for (const renderer of ['react', 'preact'] as const) {
  Deno.test(
    `encoding [${renderer}]: PRIMARY — the response declares the encoding in its Content-Type ` +
      'header, which is what the framework actually relies on',
    async () => {
      const response = await render(renderer)
      const contentType = response.headers.get('content-type') ?? ''
      await response.body?.cancel()
      assert(/charset=utf-8/i.test(contentType), contentType)
      assert(/^text\/html/i.test(contentType), contentType)
    },
  )

  Deno.test(
    `encoding [${renderer}]: SECONDARY — the document still carries a <meta charset> of its own`,
    async () => {
      const doc = extractDocumentSemantics(await (await render(renderer)).text())
      assertEquals(doc.hasMetaCharset, true)
    },
  )

  Deno.test(
    `encoding [${renderer}]: the meta charset still falls inside the 1024-byte window the HTML ` +
      'Standard specifies, even though the resolved head now precedes it',
    async () => {
      const html = await (await render(renderer)).text()
      const index = html.search(CHARSET_META)
      assert(index !== -1, 'no meta charset found')
      const bytesBefore = new TextEncoder().encode(html.slice(0, index)).length
      assert(
        bytesBefore < ENCODING_DECLARATION_BYTE_LIMIT,
        `meta charset starts at byte ${bytesBefore}, past the ${ENCODING_DECLARATION_BYTE_LIMIT}-byte limit`,
      )
    },
  )

  Deno.test(
    `encoding [${renderer}]: the resolved <title> is the document's FIRST title — the property that ` +
      'actually has to hold in both renderers, independent of where the charset lands',
    async () => {
      const html = await (await render(renderer)).text()
      const doc = extractDocumentSemantics(html)
      // Where the charset sits relative to the resolved head is a renderer detail with no meaning
      // (React's shell emits it inside the tree and hoisting orders it first; Preact's placement step
      // puts the resolved head ahead of it). An earlier version of this test asserted the Preact
      // ordering for BOTH renderers, which was over-generalizing an implementation detail into a
      // contract. The real contract is the one below.
      assertEquals(doc.titles.length, 1)
      assertEquals(
        doc.titles[0],
        'Encoding — a deliberately long title so the resolved head is not trivially small',
      )
    },
  )

  Deno.test(
    `encoding [${renderer}]: the charset's POSITION carries no semantics — the extracted document ` +
      'is identical whether the declaration is read before or after the resolved head',
    async () => {
      const html = await (await render(renderer)).text()
      const asRendered = extractDocumentSemantics(html)
      // The same document with the charset moved to the very front of <head>: if position carried
      // any meaning, these two would differ somewhere.
      const moved = html
        .replace(CHARSET_META, '')
        .replace(/(<head(?:\s[^>]*)?>)/i, '$1<meta charset="utf-8">')
      assertEquals(extractDocumentSemantics(moved), asRendered)
    },
  )
}

Deno.test(
  'encoding: React and Preact agree on every encoding-related property of the document',
  async () => {
    const react = extractDocumentSemantics(await (await render('react')).text())
    const preact = extractDocumentSemantics(await (await render('preact')).text())
    assertEquals(preact.hasMetaCharset, react.hasMetaCharset)
    assertEquals(preact.lang, react.lang)
    assertEquals(preact.isDocument, react.isDocument)
  },
)
