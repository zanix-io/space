import { assertEquals } from '@std/assert'
import { resolveDevCssHrefs } from 'modules/dev/mod.ts'

Deno.test('resolveDevCssHrefs: strips a leading "./" and appends ?direct', () => {
  assertEquals(resolveDevCssHrefs(['./styles/app.css']), [
    '/styles/app.css?direct',
  ])
})

Deno.test('resolveDevCssHrefs: a path with no leading "./" still gets a leading "/"', () => {
  assertEquals(resolveDevCssHrefs(['styles/app.css']), [
    '/styles/app.css?direct',
  ])
})

Deno.test('resolveDevCssHrefs: an already root-relative path is left as-is, plus ?direct', () => {
  assertEquals(resolveDevCssHrefs(['/styles/app.css']), [
    '/styles/app.css?direct',
  ])
})

Deno.test('resolveDevCssHrefs: preserves declaration order for multiple paths', () => {
  assertEquals(
    resolveDevCssHrefs(['./styles/reset.css', './styles/app.css']),
    ['/styles/reset.css?direct', '/styles/app.css?direct'],
  )
})

Deno.test('resolveDevCssHrefs: an empty list resolves to an empty list', () => {
  assertEquals(resolveDevCssHrefs([]), [])
})

Deno.test(
  'resolveDevCssHrefs: a {href, media} entry resolves to {href: "...?direct", media} — media ' +
    'passed through unchanged, never appended to the ?direct href itself',
  () => {
    assertEquals(
      resolveDevCssHrefs([{ href: './styles/mobile.css', media: '(max-width: 599px)' }]),
      [{ href: '/styles/mobile.css?direct', media: '(max-width: 599px)' }],
    )
  },
)

Deno.test(
  'resolveDevCssHrefs: string and {href, media} entries mix freely, order preserved',
  () => {
    assertEquals(
      resolveDevCssHrefs([
        { href: './styles/mobile.css', media: '(max-width: 599px)' },
        './styles/base.css',
      ]),
      [
        { href: '/styles/mobile.css?direct', media: '(max-width: 599px)' },
        '/styles/base.css?direct',
      ],
    )
  },
)
