import { assertEquals } from '@std/assert'
import { extractDocumentSemantics } from 'modules/render/document-semantics.ts'

/** A minimal, valid document shell, with `%HEAD%`/`%BODY%` placeholders a test fills in — keeps
 * every fixture below focused on the one thing it actually exercises. */
function doc(head: string, body = '<main>content</main>'): string {
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`
}

// -------------------------------------------------------------------------------------------
// parseAttributes: the 3-way `??` chain over ATTRIBUTE's alternate capture groups
// -------------------------------------------------------------------------------------------

Deno.test('extractDocumentSemantics: a double-quoted attribute value is read (match[2])', () => {
  const semantics = extractDocumentSemantics(
    doc('<meta name="description" content="double quoted">'),
  )
  assertEquals(semantics.meta['name:description'], 'double quoted')
})

Deno.test('extractDocumentSemantics: a single-quoted attribute value is read (match[3])', () => {
  const semantics = extractDocumentSemantics(
    doc(`<meta name='description' content='single quoted'>`),
  )
  assertEquals(semantics.meta['name:description'], 'single quoted')
})

Deno.test('extractDocumentSemantics: an unquoted attribute value is read (match[4])', () => {
  const semantics = extractDocumentSemantics(
    doc('<meta name=description content=unquoted>'),
  )
  assertEquals(semantics.meta['name:description'], 'unquoted')
})

Deno.test(
  'extractDocumentSemantics: an attribute with NO value at all (none of the three capture ' +
    "groups matched) falls all the way through to '' — the chain's final ?? branch",
  () => {
    // `content` here is a bare attribute name, no `=...` at all — distinct from all three quoting
    // forms above, which all supply SOME value.
    const semantics = extractDocumentSemantics(doc('<meta name="description" content>'))
    assertEquals(semantics.meta['name:description'], '')
  },
)

// -------------------------------------------------------------------------------------------
// collectTags: a tag with NO attributes at all — `match[1] ?? ''`
// -------------------------------------------------------------------------------------------

Deno.test(
  'extractDocumentSemantics: a bare tag with no attributes at all does not throw and ' +
    'contributes nothing to meta',
  () => {
    // A bare, attribute-less `<meta>` — `collectTags`'s own `match[1] ?? ''` branch.
    const semantics = extractDocumentSemantics(doc('<meta>'))
    assertEquals(semantics.meta, {})
    assertEquals(semantics.hasMetaCharset, false)
  },
)

// -------------------------------------------------------------------------------------------
// The meta-tag identity ternary: `name:` / `property:` / `httpEquiv:` / undefined
// -------------------------------------------------------------------------------------------

Deno.test(
  'extractDocumentSemantics: an Open Graph <meta property> tag is reported under property:*',
  () => {
    const semantics = extractDocumentSemantics(
      doc('<meta property="og:title" content="A great page">'),
    )
    assertEquals(semantics.meta['property:og:title'], 'A great page')
  },
)

Deno.test(
  'extractDocumentSemantics: a plain <meta charset> declares hasMetaCharset, independent of ' +
    'the http-equiv Content-Type path',
  () => {
    const semantics = extractDocumentSemantics(doc('<meta charset="utf-8">'))
    assertEquals(semantics.hasMetaCharset, true)
  },
)

Deno.test(
  'extractDocumentSemantics: an http-equiv="Content-Type" meta with a charset= in its content ' +
    'ALSO counts as hasMetaCharset — a distinct branch from the plain charset attribute',
  () => {
    const semantics = extractDocumentSemantics(
      doc('<meta http-equiv="Content-Type" content="text/html; charset=utf-8">'),
    )
    assertEquals(semantics.hasMetaCharset, true)
    // It is still reported as an ordinary meta tag too, under its own httpEquiv identity.
    assertEquals(semantics.meta['httpEquiv:Content-Type'], 'text/html; charset=utf-8')
  },
)

Deno.test(
  'extractDocumentSemantics: an http-equiv meta whose content has no charset= does not set ' +
    'hasMetaCharset',
  () => {
    const semantics = extractDocumentSemantics(
      doc('<meta http-equiv="refresh" content="5">'),
    )
    assertEquals(semantics.hasMetaCharset, false)
    assertEquals(semantics.meta['httpEquiv:refresh'], '5')
  },
)

Deno.test(
  'extractDocumentSemantics: an http-equiv="Content-Type" meta with NO content attribute at ' +
    "all does not set hasMetaCharset — tag.content ?? '' falls back rather than throwing",
  () => {
    const semantics = extractDocumentSemantics(
      doc('<meta http-equiv="Content-Type">'),
    )
    assertEquals(semantics.hasMetaCharset, false)
  },
)

Deno.test(
  'extractDocumentSemantics: a <meta> with none of name/property/http-equiv contributes ' +
    'nothing to meta (identity undefined)',
  () => {
    const semantics = extractDocumentSemantics(doc('<meta content="orphan">'))
    assertEquals(semantics.meta, {})
  },
)

Deno.test('extractDocumentSemantics: <meta name="viewport"> is captured separately', () => {
  const semantics = extractDocumentSemantics(
    doc('<meta name="viewport" content="width=device-width, initial-scale=1">'),
  )
  assertEquals(semantics.viewport, 'width=device-width, initial-scale=1')
})

// -------------------------------------------------------------------------------------------
// The <html> tag's lang: `htmlTag ? parseAttributes(htmlTag[1] ?? '').lang : undefined`
// -------------------------------------------------------------------------------------------

Deno.test(
  'extractDocumentSemantics: a bare <html> tag with no attributes at all resolves lang to ' +
    "undefined via the ?? '' branch, not a thrown error",
  () => {
    const html = '<!doctype html><html><head></head><body>x</body></html>'
    const semantics = extractDocumentSemantics(html)
    assertEquals(semantics.lang, undefined)
    assertEquals(semantics.isDocument, true)
  },
)

Deno.test('extractDocumentSemantics: <html lang> is read off the html tag', () => {
  const html = '<!doctype html><html lang="es"><head></head><body>x</body></html>'
  const semantics = extractDocumentSemantics(html)
  assertEquals(semantics.lang, 'es')
})

Deno.test('extractDocumentSemantics: no <html> tag at all resolves lang to undefined', () => {
  const semantics = extractDocumentSemantics('<p>fragment, not a document</p>')
  assertEquals(semantics.lang, undefined)
  assertEquals(semantics.isDocument, false)
})

// -------------------------------------------------------------------------------------------
// A broader sanity check on the whole shape, for good measure.
// -------------------------------------------------------------------------------------------

Deno.test('extractDocumentSemantics: titles, links and h1Count on a realistic document', () => {
  const html = doc(
    '<title>Widget</title>' +
      '<link rel="canonical" href="https://example.com/widget">' +
      '<link rel="alternate" href="https://example.com/es/widget" hreflang="es">',
    '<h1>Widget</h1><p>Some text</p>',
  )
  const semantics = extractDocumentSemantics(html)
  assertEquals(semantics.titles, ['Widget'])
  assertEquals(semantics.links, [
    { rel: 'canonical', href: 'https://example.com/widget' },
    { rel: 'alternate', href: 'https://example.com/es/widget', hreflang: 'es' },
  ])
  assertEquals(semantics.h1Count, 1)
  assertEquals(semantics.hasTextContent, true)
})
