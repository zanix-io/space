import { assertEquals } from '@std/assert'
import { resolveDevCssHrefs } from 'modules/dev/mod.ts'

Deno.test('resolveDevCssHrefs: strips a leading "./" and appends ?direct', () => {
  assertEquals(resolveDevCssHrefs(['./styles/app.css']), ['/styles/app.css?direct'])
})

Deno.test('resolveDevCssHrefs: a path with no leading "./" still gets a leading "/"', () => {
  assertEquals(resolveDevCssHrefs(['styles/app.css']), ['/styles/app.css?direct'])
})

Deno.test('resolveDevCssHrefs: an already root-relative path is left as-is, plus ?direct', () => {
  assertEquals(resolveDevCssHrefs(['/styles/app.css']), ['/styles/app.css?direct'])
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
