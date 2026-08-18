import { assert, assertEquals } from '@std/assert'
import { buildSitemapXml } from 'modules/seo/sitemap.ts'

Deno.test('buildSitemapXml: a minimal entry renders loc only', () => {
  const xml = buildSitemapXml([{ loc: '/products' }], 'https://example.com')

  assert(xml.includes('<loc>https://example.com/products</loc>'), xml)
  assert(xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'), xml)
  assert(xml.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"'), xml)
})

Deno.test('buildSitemapXml: a relative loc resolves against the given origin', () => {
  const xml = buildSitemapXml([{ loc: '/products/widget' }], 'https://example.com')
  assert(xml.includes('<loc>https://example.com/products/widget</loc>'), xml)
})

Deno.test('buildSitemapXml: an already-absolute loc is used as-is', () => {
  const xml = buildSitemapXml([{ loc: 'https://cdn.example.com/products' }], 'https://example.com')
  assert(xml.includes('<loc>https://cdn.example.com/products</loc>'), xml)
})

Deno.test(
  'buildSitemapXml: lastmod/changefreq/priority are all optional and rendered when present',
  () => {
    const xml = buildSitemapXml([
      { loc: '/products', lastmod: '2026-08-15', changefreq: 'weekly', priority: 0.8 },
    ], 'https://example.com')

    assert(xml.includes('<lastmod>2026-08-15</lastmod>'), xml)
    assert(xml.includes('<changefreq>weekly</changefreq>'), xml)
    assert(xml.includes('<priority>0.8</priority>'), xml)
  },
)

Deno.test('buildSitemapXml: omitted lastmod/changefreq/priority render no tag at all', () => {
  const xml = buildSitemapXml([{ loc: '/products' }], 'https://example.com')

  assert(!xml.includes('<lastmod>'), xml)
  assert(!xml.includes('<changefreq>'), xml)
  assert(!xml.includes('<priority>'), xml)
})

Deno.test(
  'buildSitemapXml: alternates cross-reference every language, not just a self-reference — real ' +
    'fix over the legacy, whose own multi-language sitemap only ever self-referenced',
  () => {
    const xml = buildSitemapXml([{
      loc: '/en/about',
      alternates: [
        { lang: 'en', href: '/en/about' },
        { lang: 'es', href: '/es/about' },
      ],
    }], 'https://example.com')

    assert(
      xml.includes(
        '<xhtml:link rel="alternate" hreflang="en" href="https://example.com/en/about"/>',
      ),
      xml,
    )
    assert(
      xml.includes(
        '<xhtml:link rel="alternate" hreflang="es" href="https://example.com/es/about"/>',
      ),
      xml,
    )
  },
)

Deno.test(
  'buildSitemapXml: values are XML-escaped — a real fix over the legacy, which used raw ' +
    'unescaped template-string interpolation',
  () => {
    const xml = buildSitemapXml(
      [{ loc: '/search?q=cats&dogs' }],
      'https://example.com',
    )

    assert(xml.includes('&amp;'), xml)
    assert(!xml.includes('cats&dogs'), xml)
  },
)

Deno.test(
  'buildSitemapXml: no redirect/target tags — only real, indexable urlset entries, unlike ' +
    'the legacy which mixed non-standard <redirect>/<target> tags into the same urlset',
  () => {
    const xml = buildSitemapXml([{ loc: '/products' }], 'https://example.com')

    assert(!xml.includes('<redirect>'), xml)
    assert(!xml.includes('<target>'), xml)
  },
)

Deno.test('buildSitemapXml: multiple entries each get their own <url> block', () => {
  const xml = buildSitemapXml(
    [{ loc: '/a' }, { loc: '/b' }, { loc: '/c' }],
    'https://example.com',
  )

  assertEquals((xml.match(/<url>/g) ?? []).length, 3)
  assertEquals((xml.match(/<\/url>/g) ?? []).length, 3)
})

Deno.test('buildSitemapXml: an empty entries array still produces a valid, empty urlset', () => {
  const xml = buildSitemapXml([], 'https://example.com')

  assert(xml.includes('<urlset'), xml)
  assert(xml.includes('</urlset>'), xml)
  assertEquals((xml.match(/<url>/g) ?? []).length, 0)
})
