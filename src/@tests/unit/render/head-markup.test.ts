import { assert, assertEquals, assertFalse, assertStringIncludes } from '@std/assert'
import { placeHeadMarkup, serializeHeadMarkup } from 'modules/render/head-markup.ts'
import type { DocumentModel } from 'modules/render/document-model.ts'

function model(overrides: Partial<DocumentModel> = {}): DocumentModel {
  return {
    head: { title: undefined, meta: [], link: [] },
    cssHrefs: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------------------------
// serializeHeadMarkup
// ---------------------------------------------------------------------------------------------

Deno.test('serializeHeadMarkup: an empty model contributes nothing at all', () => {
  assertEquals(serializeHeadMarkup(model()), '')
})

Deno.test('serializeHeadMarkup: renders a real <title> element', () => {
  const markup = serializeHeadMarkup(model({ head: { title: 'Widget', meta: [], link: [] } }))
  assertEquals(markup, '<title>Widget</title>')
})

Deno.test(
  'serializeHeadMarkup: title text is HTML-escaped — a loader-derived title containing markup can ' +
    'never break out of the element',
  () => {
    const markup = serializeHeadMarkup(
      model({ head: { title: '</title><script>alert(1)</script>', meta: [], link: [] } }),
    )
    assertFalse(markup.includes('<script>'), markup)
    assertStringIncludes(markup, '&lt;/title&gt;')
  },
)

Deno.test('serializeHeadMarkup: httpEquiv is emitted as the real http-equiv attribute', () => {
  const markup = serializeHeadMarkup(
    model({ head: { meta: [{ httpEquiv: 'refresh', content: '5' }], link: [] } }),
  )
  assertEquals(markup, '<meta http-equiv="refresh" content="5">')
})

Deno.test(
  'serializeHeadMarkup: attribute values are escaped — a quote in content cannot open a new ' +
    'attribute. Asserted as an exact string: the injected text may still READ as `onload=` once ' +
    'escaped, and it is inert precisely because the quotes around it are entities, so a substring ' +
    'check would be testing the wrong property',
  () => {
    const markup = serializeHeadMarkup(
      model({
        head: { meta: [{ name: 'description', content: 'a " onload="x' }], link: [] },
      }),
    )
    assertEquals(markup, '<meta name="description" content="a &quot; onload=&quot;x">')
  },
)

Deno.test(
  'serializeHeadMarkup: an unsafe attribute NAME is dropped rather than emitted — HeadLinkTag ' +
    'accepts arbitrary extra attributes, so keys are author-supplied too and value-escaping alone ' +
    'would not contain a key carrying a quote or a space',
  () => {
    const markup = serializeHeadMarkup(
      model({
        head: {
          meta: [],
          link: [{ rel: 'canonical', href: '/p', 'bad name" onload="x': 'y' }],
        },
      }),
    )
    assertFalse(markup.includes('onload'), markup)
    assertEquals(markup, '<link rel="canonical" href="/p">')
  },
)

Deno.test(
  'serializeHeadMarkup: a link keeps every valid extra attribute, hreflang included',
  () => {
    const markup = serializeHeadMarkup(
      model({
        head: {
          meta: [],
          link: [{ rel: 'alternate', href: 'https://example.com/es/p', hreflang: 'es' }],
        },
      }),
    )
    assertEquals(markup, '<link rel="alternate" href="https://example.com/es/p" hreflang="es">')
  },
)

Deno.test(
  'serializeHeadMarkup: a full hreflang set including the x-default/default-language pair renders ' +
    'EVERY entry — the same set resolveHead deliberately keeps distinct',
  () => {
    const markup = serializeHeadMarkup(
      model({
        head: {
          meta: [],
          link: [
            { rel: 'alternate', href: 'https://example.com/en/p', hreflang: 'en' },
            { rel: 'alternate', href: 'https://example.com/es/p', hreflang: 'es' },
            { rel: 'alternate', href: 'https://example.com/en/p', hreflang: 'x-default' },
          ],
        },
      }),
    )
    assertEquals((markup.match(/<link /g) ?? []).length, 3)
    assertStringIncludes(markup, 'hreflang="x-default"')
  },
)

Deno.test('serializeHeadMarkup: stylesheet refs render as links, media preserved', () => {
  const markup = serializeHeadMarkup(
    model({ cssHrefs: ['/a.css', { href: '/b.css', media: '(max-width: 599px)' }] }),
  )
  assertEquals(
    markup,
    '<link rel="stylesheet" href="/a.css">' +
      '<link rel="stylesheet" href="/b.css" media="(max-width: 599px)">',
  )
})

Deno.test(
  'serializeHeadMarkup: themeStyle renders AFTER cssHrefs — document order is what lets it ' +
    "override the static stylesheet's own :root token declarations",
  () => {
    const markup = serializeHeadMarkup(
      model({ cssHrefs: ['/a.css'], themeStyle: ':root{--c:red}', nonce: 'n1' }),
    )
    assert(markup.indexOf('/a.css') < markup.indexOf('<style'), markup)
    assertStringIncludes(markup, '<style nonce="n1">:root{--c:red}</style>')
  },
)

Deno.test('serializeHeadMarkup: the PWA contribution renders manifest link + theme-color', () => {
  const markup = serializeHeadMarkup(
    model({ pwa: { manifestHref: '/manifest.webmanifest', themeColor: '#0af' } }),
  )
  assertStringIncludes(markup, '<link rel="manifest" href="/manifest.webmanifest">')
  assertStringIncludes(markup, '<meta name="theme-color" content="#0af">')
})

Deno.test(
  'serializeHeadMarkup: the service-worker registration script is NOT part of the head markup — it ' +
    'belongs at the end of <body>, placed by the serializer that already does that',
  () => {
    const markup = serializeHeadMarkup(
      model({ pwa: { manifestHref: '/m.webmanifest', serviceWorkerHref: '/sw.js' } }),
    )
    assertFalse(markup.includes('serviceWorker'), markup)
  },
)

// ---------------------------------------------------------------------------------------------
// placeHeadMarkup
// ---------------------------------------------------------------------------------------------

Deno.test('placeHeadMarkup: empty markup returns the document untouched', () => {
  const html = '<html><head></head><body>x</body></html>'
  assertEquals(placeHeadMarkup(html, ''), html)
})

Deno.test(
  'placeHeadMarkup: places immediately AFTER the opening <head> tag, not before </head> — this is ' +
    "what makes this framework's own resolved <title> the document's FIRST title even when a root " +
    'layout renders one of its own, matching React',
  () => {
    const html = '<html><head><title>LAYOUT</title></head><body>x</body></html>'
    const out = placeHeadMarkup(html, '<title>SPACE</title>')
    assert(out.indexOf('<title>SPACE</title>') < out.indexOf('<title>LAYOUT</title>'), out)
  },
)

Deno.test("placeHeadMarkup: never suppresses the author's own tags — both survive", () => {
  const html = '<html><head><title>LAYOUT</title></head><body>x</body></html>'
  const out = placeHeadMarkup(html, '<title>SPACE</title>')
  assertStringIncludes(out, '<title>LAYOUT</title>')
  assertStringIncludes(out, '<title>SPACE</title>')
})

Deno.test('placeHeadMarkup: handles an opening <head> tag carrying attributes', () => {
  const out = placeHeadMarkup(
    '<html><head data-x="1"><meta charset="utf-8"></head><body></body></html>',
    '<title>T</title>',
  )
  assertStringIncludes(out, '<head data-x="1"><title>T</title><meta charset="utf-8">')
})

Deno.test(
  'placeHeadMarkup: only the FIRST <head> is targeted — a literal "<head>" appearing later in body ' +
    'text never receives the markup',
  () => {
    const out = placeHeadMarkup(
      '<html><head></head><body>talking about &lt;head&gt; and <head></body></html>',
      '<title>T</title>',
    )
    assertEquals((out.match(/<title>T<\/title>/g) ?? []).length, 1)
    assertStringIncludes(out, '<head><title>T</title></head>')
  },
)

Deno.test(
  'placeHeadMarkup: a document with no <head> at all gets a real one created before <body> — a ' +
    'defect the build validation reports separately, but never a reason to discard the metadata',
  () => {
    const out = placeHeadMarkup('<html><body>x</body></html>', '<title>T</title>')
    assertStringIncludes(out, '<head><title>T</title></head><body>')
  },
)

Deno.test('placeHeadMarkup: with neither <head> nor <body>, the markup is prepended', () => {
  assertEquals(placeHeadMarkup('<div>x</div>', '<title>T</title>'), '<title>T</title><div>x</div>')
})

// ---------------------------------------------------------------------------------------------
// The serializer resolves NOTHING
//
// `DocumentModel` is the source of truth. `resolveHead` (`router/head-descriptor.ts`) owns every
// merge, dedup and precedence decision; these functions only render what it produced. The tests
// below prove that by feeding models that a real `resolveHead` could never have produced — two
// canonicals, two same-identity metas — and asserting the serializer faithfully emits BOTH. If it
// ever "helpfully" deduplicated, resolution would silently live in two places and the singleton
// rule could pass its own tests while being wrong for anything that bypassed it.
// ---------------------------------------------------------------------------------------------

Deno.test(
  'serializeHeadMarkup: does NOT deduplicate canonicals — the singleton rule lives in resolveHead, ' +
    'not here. Two in, two out',
  () => {
    const markup = serializeHeadMarkup(
      model({
        head: {
          meta: [],
          link: [
            { rel: 'canonical', href: '/a' },
            { rel: 'canonical', href: '/b' },
          ],
        },
      }),
    )
    assertEquals((markup.match(/rel="canonical"/g) ?? []).length, 2)
  },
)

Deno.test(
  'serializeHeadMarkup: does NOT deduplicate same-identity meta tags either — no resolution of any ' +
    'kind happens at this layer',
  () => {
    const markup = serializeHeadMarkup(
      model({
        head: {
          meta: [
            { name: 'description', content: 'first' },
            { name: 'description', content: 'second' },
          ],
          link: [],
        },
      }),
    )
    assertEquals((markup.match(/name="description"/g) ?? []).length, 2)
    assertStringIncludes(markup, 'content="first"')
    assertStringIncludes(markup, 'content="second"')
  },
)

Deno.test(
  'serializeHeadMarkup: preserves the model order exactly — never reorders, so document order ' +
    'stays ' +
    "resolveHead's decision (which is what makes the theme override and cascade order predictable)",
  () => {
    const markup = serializeHeadMarkup(
      model({
        head: {
          title: 'T',
          meta: [{ name: 'b', content: '2' }, { name: 'a', content: '1' }],
          link: [{ rel: 'z', href: '/z' }, { rel: 'a', href: '/a' }],
        },
      }),
    )
    assert(markup.indexOf('name="b"') < markup.indexOf('name="a"'), markup)
    assert(markup.indexOf('rel="z"') < markup.indexOf('rel="a"'), markup)
    assert(markup.indexOf('<title>') < markup.indexOf('name="b"'), markup)
  },
)
