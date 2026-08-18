import { assertEquals } from '@std/assert'
import { buildRobotsTxt } from 'modules/seo/robots.ts'

Deno.test(
  'buildRobotsTxt: a raw string is returned completely unchanged, no processing at all',
  () => {
    const raw = 'User-agent: *\nDisallow: /admin\n'
    const body = buildRobotsTxt(raw, { origin: 'https://example.com', hasSitemap: true })

    assertEquals(body, raw)
  },
)

Deno.test('buildRobotsTxt: a structured config renders one User-agent block per rule', () => {
  const body = buildRobotsTxt(
    { rules: [{ userAgent: '*', allow: ['/'] }] },
    { origin: 'https://example.com', hasSitemap: false },
  )

  assertEquals(body, 'User-agent: *\nAllow: /\n')
})

Deno.test('buildRobotsTxt: allow/disallow entries render in declared order', () => {
  const body = buildRobotsTxt(
    { rules: [{ userAgent: 'Googlebot', allow: ['/public'], disallow: ['/admin', '/private'] }] },
    { origin: 'https://example.com', hasSitemap: false },
  )

  assertEquals(
    body,
    'User-agent: Googlebot\nAllow: /public\nDisallow: /admin\nDisallow: /private\n',
  )
})

Deno.test('buildRobotsTxt: multiple rules are separated by a blank line', () => {
  const body = buildRobotsTxt(
    {
      rules: [
        { userAgent: 'Googlebot', allow: ['/'] },
        { userAgent: '*', disallow: ['/'] },
      ],
    },
    { origin: 'https://example.com', hasSitemap: false },
  )

  assertEquals(
    body,
    'User-agent: Googlebot\nAllow: /\n\nUser-agent: *\nDisallow: /\n',
  )
})

Deno.test(
  'buildRobotsTxt: auto-appends Sitemap: only when hasSitemap is true and includeSitemap was not ' +
    'set to false',
  () => {
    const withSitemap = buildRobotsTxt(
      { rules: [{ allow: ['/'] }] },
      { origin: 'https://example.com', hasSitemap: true },
    )
    assertEquals(
      withSitemap,
      'User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap.xml\n',
    )

    const noSitemapConfigured = buildRobotsTxt(
      { rules: [{ allow: ['/'] }] },
      { origin: 'https://example.com', hasSitemap: false },
    )
    assertEquals(noSitemapConfigured, 'User-agent: *\nAllow: /\n')

    const explicitlyOptedOut = buildRobotsTxt(
      { rules: [{ allow: ['/'] }], includeSitemap: false },
      { origin: 'https://example.com', hasSitemap: true },
    )
    assertEquals(explicitlyOptedOut, 'User-agent: *\nAllow: /\n')
  },
)

Deno.test('buildRobotsTxt: a raw string never gets an auto-appended Sitemap line either', () => {
  const body = buildRobotsTxt('User-agent: *\nAllow: /', {
    origin: 'https://example.com',
    hasSitemap: true,
  })

  assertEquals(body, 'User-agent: *\nAllow: /')
})
