import { assertEquals } from '@std/assert'
import { contentTypeFor } from 'modules/assets/content-type.ts'

Deno.test('contentTypeFor: an image extension resolves its real MIME type', () => {
  assertEquals(contentTypeFor('logo.png'), 'image/png')
})

Deno.test('contentTypeFor: a font extension resolves its real MIME type', () => {
  assertEquals(contentTypeFor('brand.woff2'), 'font/woff2')
})

Deno.test('contentTypeFor: a document extension resolves its real MIME type', () => {
  assertEquals(contentTypeFor('manual.pdf'), 'application/pdf')
})

Deno.test('contentTypeFor: a media extension resolves its real MIME type', () => {
  assertEquals(contentTypeFor('clip.mp4'), 'video/mp4')
})

Deno.test('contentTypeFor: an unknown extension falls back to application/octet-stream', () => {
  assertEquals(contentTypeFor('archive.zip'), 'application/octet-stream')
})

Deno.test(
  'contentTypeFor: a path with no extension at all falls back to application/octet-stream',
  () => {
    assertEquals(contentTypeFor('README'), 'application/octet-stream')
  },
)

Deno.test('contentTypeFor: the lookup is case-insensitive', () => {
  assertEquals(contentTypeFor('photo.JPG'), 'image/jpeg')
})

Deno.test('contentTypeFor: a full path (not just a bare filename) still resolves correctly', () => {
  assertEquals(contentTypeFor('/assets/icons/favicon.ICO'), 'image/x-icon')
})
