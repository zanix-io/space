import { assertEquals } from '@std/assert'
import { buildCanonicalLink } from 'modules/seo/canonical.ts'

Deno.test('buildCanonicalLink: strips the query string by default', () => {
  const link = buildCanonicalLink({
    url: new URL('https://example.com/products/widget?utm_source=x&sort=price'),
  })

  assertEquals(link, { rel: 'canonical', href: 'https://example.com/products/widget' })
})

Deno.test(
  'buildCanonicalLink: keepParams preserves only the named params, in canonical form',
  () => {
    const link = buildCanonicalLink({
      url: new URL('https://example.com/products?utm_source=x&page=2'),
      keepParams: ['page'],
    })

    assertEquals(link.href, 'https://example.com/products?page=2')
  },
)

Deno.test('buildCanonicalLink: a keepParams entry absent from the URL is simply not added', () => {
  const link = buildCanonicalLink({
    url: new URL('https://example.com/products'),
    keepParams: ['page'],
  })

  assertEquals(link.href, 'https://example.com/products')
})

Deno.test(
  'buildCanonicalLink: always uses url.origin, never a separately-configured domain',
  () => {
    const link = buildCanonicalLink({ url: new URL('https://staging.example.com/about') })

    assertEquals(link.href, 'https://staging.example.com/about')
  },
)
