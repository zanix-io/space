import { assertEquals } from '@std/assert'
import { buildHreflangLinks } from 'modules/seo/hreflang.ts'

Deno.test('buildHreflangLinks: one entry per availableLang plus x-default, same path shape', () => {
  const links = buildHreflangLinks({
    url: new URL('https://example.com/en/products/widget'),
    lang: 'en',
    availableLangs: ['en', 'es'],
    defaultLang: 'en',
  })

  assertEquals(links, [
    { rel: 'alternate', hreflang: 'en', href: 'https://example.com/en/products/widget' },
    { rel: 'alternate', hreflang: 'es', href: 'https://example.com/es/products/widget' },
    { rel: 'alternate', hreflang: 'x-default', href: 'https://example.com/en/products/widget' },
  ])
})

Deno.test(
  'buildHreflangLinks: always self-references the current lang — real fix over the legacy, which ' +
    'only self-referenced for a non-templated page and never linked to its OTHER language variants',
  () => {
    const links = buildHreflangLinks({
      url: new URL('https://example.com/es/about'),
      lang: 'es',
      availableLangs: ['en', 'es', 'fr'],
      defaultLang: 'en',
    })

    const langs = links.map((l) => l.hreflang)
    assertEquals(langs, ['en', 'es', 'fr', 'x-default'])
    assertEquals(
      links.find((l) => l.hreflang === 'es')?.href,
      'https://example.com/es/about',
    )
  },
)

Deno.test(
  'buildHreflangLinks: x-default points at the DEFAULT LANGUAGE version of the CURRENT page, not ' +
    'the bare site root (real fix over the legacy, which hardcoded x-default to "/" regardless of ' +
    'the current path)',
  () => {
    const links = buildHreflangLinks({
      url: new URL('https://example.com/es/products/widget'),
      lang: 'es',
      availableLangs: ['en', 'es'],
      defaultLang: 'en',
    })

    assertEquals(
      links.find((l) => l.hreflang === 'x-default')?.href,
      'https://example.com/en/products/widget',
    )
  },
)

Deno.test(
  'buildHreflangLinks: the bare lang root (no trailing path) resolves with no double slash',
  () => {
    const links = buildHreflangLinks({
      url: new URL('https://example.com/en'),
      lang: 'en',
      availableLangs: ['en', 'es'],
      defaultLang: 'en',
    })

    assertEquals(
      links.find((l) => l.hreflang === 'es')?.href,
      'https://example.com/es',
    )
  },
)

Deno.test(
  'buildHreflangLinks: a pathname that does NOT already start with /{lang} is used as-is, with ' +
    'nothing stripped — the branch every other case above never reaches, since `url.pathname` there ' +
    'already carries its own lang segment',
  () => {
    const links = buildHreflangLinks({
      url: new URL('https://example.com/about'),
      lang: 'en',
      availableLangs: ['en', 'es'],
      defaultLang: 'en',
    })

    assertEquals(links, [
      { rel: 'alternate', hreflang: 'en', href: 'https://example.com/en/about' },
      { rel: 'alternate', hreflang: 'es', href: 'https://example.com/es/about' },
      { rel: 'alternate', hreflang: 'x-default', href: 'https://example.com/en/about' },
    ])
  },
)

Deno.test('buildHreflangLinks: a single availableLang still produces itself plus x-default', () => {
  const links = buildHreflangLinks({
    url: new URL('https://example.com/en/products'),
    lang: 'en',
    availableLangs: ['en'],
    defaultLang: 'en',
  })

  assertEquals(links.length, 2)
  assertEquals(links[0].hreflang, 'en')
  assertEquals(links[1].hreflang, 'x-default')
})
