import { assertEquals, assertNotEquals } from '@std/assert'
import { linkIdentityKey, metaIdentityKey, resolveHead } from 'modules/router/head-descriptor.ts'

Deno.test('resolveHead: only a page head — no layouts declared anything', () => {
  const resolved = resolveHead([{
    title: 'Product',
    meta: [{ name: 'description', content: 'x' }],
  }])
  assertEquals(resolved.title, 'Product')
  assertEquals(resolved.meta, [{ name: 'description', content: 'x' }])
  assertEquals(resolved.link, [])
})

Deno.test(
  'resolveHead: root + nested layout + page — most specific wins per field, all merged',
  () => {
    const root = { title: 'My Site', meta: [{ name: 'author', content: 'Acme' }] }
    const nested = { title: 'Products', meta: [{ property: 'og:type', content: 'website' }] }
    const page = { title: 'Widget', meta: [{ name: 'description', content: 'A great widget' }] }

    // Most-specific-first: page, then nested layout, then root.
    const resolved = resolveHead([page, nested, root])

    assertEquals(resolved.title, 'Widget', 'the page own title must win over both layouts')
    assertEquals(resolved.meta, [
      { name: 'description', content: 'A great widget' },
      { property: 'og:type', content: 'website' },
      { name: 'author', content: 'Acme' },
    ])
  },
)

Deno.test('resolveHead: precedence — page title wins over a layout title, same field', () => {
  const resolved = resolveHead([{ title: 'Page Title' }, { title: 'Layout Title' }])
  assertEquals(resolved.title, 'Page Title')
})

Deno.test(
  'resolveHead: precedence — a layout that declares no title falls through to the next, less ' +
    'specific one that does',
  () => {
    const resolved = resolveHead([
      {}, // page declares no head title at all
      { title: 'Nested Layout Title' },
      { title: 'Root Layout Title' },
    ])
    assertEquals(resolved.title, 'Nested Layout Title')
  },
)

Deno.test(
  'resolveHead: meta dedup — same name key declared at two levels, most specific wins, no duplicate',
  () => {
    const resolved = resolveHead([
      { meta: [{ name: 'description', content: 'page description' }] },
      { meta: [{ name: 'description', content: 'layout description' }] },
    ])
    assertEquals(resolved.meta, [{ name: 'description', content: 'page description' }])
  },
)

Deno.test(
  'resolveHead: meta dedup keys by name/property/httpEquiv independently — different keys never collide',
  () => {
    const resolved = resolveHead([{
      meta: [
        { name: 'description', content: 'a' },
        { property: 'og:title', content: 'b' },
        { httpEquiv: 'content-language', content: 'en' },
      ],
    }])
    assertEquals(resolved.meta.length, 3)
  },
)

Deno.test(
  'resolveHead: a meta tag with no name/property/httpEquiv is never deduplicated against another',
  () => {
    const resolved = resolveHead([
      { meta: [{ content: 'first' }] },
      { meta: [{ content: 'second' }] },
    ])
    assertEquals(resolved.meta.length, 2)
  },
)

Deno.test(
  'resolveHead: a no-identity meta tag with the SAME content at two levels still produces two ' +
    'literal tags — no identity key means no dedup, even against an identical duplicate',
  () => {
    const resolved = resolveHead([
      { meta: [{ content: 'x' }] },
      { meta: [{ content: 'x' }] },
    ])
    assertEquals(resolved.meta, [{ content: 'x' }, { content: 'x' }])
  },
)

Deno.test('resolveHead: link dedup by rel+href — most specific wins, no literal duplicate', () => {
  const resolved = resolveHead([
    { link: [{ rel: 'canonical', href: '/products/widget' }] },
    { link: [{ rel: 'canonical', href: '/products/widget' }] },
  ])
  assertEquals(resolved.link, [{ rel: 'canonical', href: '/products/widget' }])
})

Deno.test('resolveHead: link entries with different rel/href both survive, never deduped', () => {
  const resolved = resolveHead([{
    link: [
      { rel: 'stylesheet', href: '/a.css' },
      { rel: 'stylesheet', href: '/b.css' },
      { rel: 'alternate', href: '/a', hreflang: 'es' },
    ],
  }])
  assertEquals(resolved.link.length, 3)
})

Deno.test(
  'resolveHead: canonical is a singleton — two different hrefs in the SAME descriptor collapse to ' +
    'the first, never both. Framework invariant (see SINGLETON_LINK_RELS), not an HTML/Google rule',
  () => {
    const resolved = resolveHead([{
      link: [
        { rel: 'canonical', href: '/a' },
        { rel: 'canonical', href: '/b' },
      ],
    }])
    assertEquals(resolved.link, [{ rel: 'canonical', href: '/a' }])
  },
)

Deno.test(
  "resolveHead: a page's own canonical beats a layout's, even with a DIFFERENT href — the exact " +
    'case that previously emitted two conflicting canonical links, because differing hrefs meant ' +
    'differing dedup keys meant no precedence applied at all',
  () => {
    const resolved = resolveHead([
      { link: [{ rel: 'canonical', href: 'https://example.com/products/widget' }] },
      { link: [{ rel: 'canonical', href: 'https://example.com/products' }] },
    ])
    assertEquals(resolved.link, [
      { rel: 'canonical', href: 'https://example.com/products/widget' },
    ])
  },
)

Deno.test(
  'resolveHead: canonical singleton matching is case-insensitive on rel — HTML link types are ' +
    'ASCII case-insensitive, so rel="Canonical" is the same singleton as rel="canonical"',
  () => {
    const resolved = resolveHead([
      { link: [{ rel: 'Canonical', href: '/page' }] },
      { link: [{ rel: 'canonical', href: '/other' }] },
    ])
    assertEquals(resolved.link, [{ rel: 'Canonical', href: '/page' }])
  },
)

Deno.test(
  'resolveHead: a compound rel is NOT treated as a singleton — collapsing it by its first token ' +
    "would silently discard the other tokens' meaning",
  () => {
    const resolved = resolveHead([{
      link: [
        { rel: 'canonical alternate', href: '/a' },
        { rel: 'canonical alternate', href: '/b' },
      ],
    }])
    assertEquals(resolved.link.length, 2)
  },
)

Deno.test(
  'resolveHead: making canonical a singleton did not change alternate/hreflang dedup — a canonical ' +
    'and a full hreflang set coexist in one document, each following its own rule',
  () => {
    const resolved = resolveHead([{
      link: [
        { rel: 'canonical', href: 'https://example.com/en/products' },
        { rel: 'alternate', href: 'https://example.com/en/products', hreflang: 'en' },
        { rel: 'alternate', href: 'https://example.com/es/products', hreflang: 'es' },
        { rel: 'alternate', href: 'https://example.com/en/products', hreflang: 'x-default' },
      ],
    }])
    assertEquals(resolved.link.length, 4)
    assertEquals(
      resolved.link.filter((tag) => tag.rel === 'canonical').length,
      1,
    )
  },
)

Deno.test(
  'resolveHead: two alternate links sharing the SAME href but different hreflang both survive — ' +
    'real bug fixed: rel+href alone collapsed an x-default entry into its same-URL language ' +
    'entry whenever that language happened to be the site default (a common case, not an edge ' +
    "case), since plain rel+href dedup can't tell the two semantically-distinct signals apart",
  () => {
    const resolved = resolveHead([{
      link: [
        { rel: 'alternate', href: '/en/products', hreflang: 'en' },
        { rel: 'alternate', href: '/en/products', hreflang: 'x-default' },
      ],
    }])
    assertEquals(resolved.link, [
      { rel: 'alternate', href: '/en/products', hreflang: 'en' },
      { rel: 'alternate', href: '/en/products', hreflang: 'x-default' },
    ])
  },
)

// ---------------------------------------------------------------------------------------------
// Identity keys — the seam every document serializer keys its rendered elements by. These exist so
// a serializer can never again compute its own, drifting shape (see `linkIdentityKey`'s own doc for
// the real duplicate-React-key bug that drift caused on every i18n page).
// ---------------------------------------------------------------------------------------------

Deno.test(
  'linkIdentityKey: the x-default/default-language hreflang pair gets DISTINCT keys even though ' +
    'both share the same href — the exact collision that produced duplicate React keys when a ' +
    'serializer computed `rel:href` on its own',
  () => {
    const en = { rel: 'alternate', href: 'https://example.com/en/p', hreflang: 'en' }
    const xDefault = { rel: 'alternate', href: 'https://example.com/en/p', hreflang: 'x-default' }
    assertNotEquals(linkIdentityKey(en), linkIdentityKey(xDefault))
  },
)

Deno.test(
  'linkIdentityKey: every tag in a real buildHreflangLinks-shaped set gets a unique key — the ' +
    'property a serializer actually depends on, asserted over the whole set rather than one pair',
  () => {
    const links = [
      { rel: 'canonical', href: 'https://example.com/en/p' },
      { rel: 'alternate', href: 'https://example.com/en/p', hreflang: 'en' },
      { rel: 'alternate', href: 'https://example.com/es/p', hreflang: 'es' },
      { rel: 'alternate', href: 'https://example.com/en/p', hreflang: 'x-default' },
    ]
    const keys = links.map(linkIdentityKey)
    assertEquals(new Set(keys).size, links.length)
  },
)

Deno.test('linkIdentityKey: two canonicals with different hrefs share ONE key (singleton)', () => {
  assertEquals(
    linkIdentityKey({ rel: 'canonical', href: '/a' }),
    linkIdentityKey({ rel: 'canonical', href: '/b' }),
  )
})

Deno.test(
  'metaIdentityKey: keys by name/property/httpEquiv, and returns undefined for a tag declaring ' +
    'none of the three — the documented case a serializer must give a positional fallback to',
  () => {
    assertEquals(metaIdentityKey({ name: 'description', content: 'x' }), 'name:description')
    assertEquals(metaIdentityKey({ property: 'og:title', content: 'x' }), 'property:og:title')
    assertEquals(metaIdentityKey({ httpEquiv: 'refresh', content: 'x' }), 'httpEquiv:refresh')
    assertEquals(metaIdentityKey({ content: 'x' }), undefined)
  },
)

Deno.test('resolveHead: undefined segments (no head declared at all) are simply skipped', () => {
  const resolved = resolveHead([undefined, { title: 'Root' }, undefined])
  assertEquals(resolved.title, 'Root')
})

Deno.test('resolveHead: nothing declared anywhere resolves to an empty-but-defined result', () => {
  const resolved = resolveHead([undefined, undefined])
  assertEquals(resolved, { title: undefined, meta: [], link: [] })
})

Deno.test(
  'resolveHead: ordering is deterministic — meta/link appear in most-specific-first encounter order',
  () => {
    const resolved = resolveHead([
      { meta: [{ name: 'a', content: '1' }], link: [{ rel: 'x', href: '/1' }] },
      { meta: [{ name: 'b', content: '2' }], link: [{ rel: 'y', href: '/2' }] },
      { meta: [{ name: 'c', content: '3' }], link: [{ rel: 'z', href: '/3' }] },
    ])
    assertEquals(resolved.meta.map((m) => m.name), ['a', 'b', 'c'])
    assertEquals(resolved.link.map((l) => l.rel), ['x', 'y', 'z'])
  },
)
