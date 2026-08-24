import { assertEquals } from '@std/assert'
import { contentTypeFor, isAudioAsset, isVideoAsset } from 'modules/assets/content-type.ts'

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

Deno.test('contentTypeFor: the legacy media pipeline video containers all resolve', () => {
  assertEquals(contentTypeFor('clip.mov'), 'video/quicktime')
  assertEquals(contentTypeFor('clip.mkv'), 'video/x-matroska')
  assertEquals(contentTypeFor('clip.avi'), 'video/x-msvideo')
})

Deno.test('contentTypeFor: .m3u8 is deliberately NOT in the table (legacy dead code)', () => {
  assertEquals(contentTypeFor('stream.m3u8'), 'application/octet-stream')
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

Deno.test('contentTypeFor: every new audio extension resolves its real MIME type', () => {
  assertEquals(contentTypeFor('memo.wav'), 'audio/wav')
  assertEquals(contentTypeFor('memo.mp3'), 'audio/mpeg')
  assertEquals(contentTypeFor('memo.m4a'), 'audio/mp4')
  assertEquals(contentTypeFor('memo.aac'), 'audio/aac')
  assertEquals(contentTypeFor('memo.opus'), 'audio/opus')
  assertEquals(contentTypeFor('memo.ogg'), 'audio/ogg')
  assertEquals(contentTypeFor('memo.flac'), 'audio/flac')
})

Deno.test('isVideoAsset: true for every recognized video extension, false otherwise', () => {
  assertEquals(isVideoAsset('clip.mp4'), true)
  assertEquals(isVideoAsset('clip.webm'), true)
  assertEquals(isVideoAsset('clip.mov'), true)
  assertEquals(isVideoAsset('photo.jpg'), false)
  assertEquals(isVideoAsset('memo.wav'), false)
  assertEquals(isVideoAsset('unknown.xyz'), false)
})

Deno.test('isAudioAsset: true for every recognized audio extension, false otherwise', () => {
  assertEquals(isAudioAsset('memo.wav'), true)
  assertEquals(isAudioAsset('memo.mp3'), true)
  assertEquals(isAudioAsset('memo.m4a'), true)
  assertEquals(isAudioAsset('memo.opus'), true)
  assertEquals(isAudioAsset('clip.mp4'), false, 'video must never be classified as audio')
  assertEquals(isAudioAsset('logo.svg'), false)
  assertEquals(isAudioAsset('unknown.xyz'), false)
})
