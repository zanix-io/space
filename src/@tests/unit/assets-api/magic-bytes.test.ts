import { assert, assertFalse } from '@std/assert'
import { matchesImageSignature } from 'modules/assets-api/magic-bytes.ts'

// --- real signatures match --------------------------------------------------------------------

Deno.test('matchesImageSignature: a real jpeg signature (FF D8 FF ...) matches image/jpeg', () => {
  assert(matchesImageSignature(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), 'image/jpeg'))
})

Deno.test(
  'matchesImageSignature: the real 8-byte png signature matches image/png',
  () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])
    assert(matchesImageSignature(bytes, 'image/png'))
  },
)

Deno.test(
  'matchesImageSignature: a real RIFF/WEBP container (RIFF + size + WEBP) matches image/webp',
  () => {
    const bytes = new Uint8Array([
      0x52,
      0x49,
      0x46,
      0x46, // 'RIFF'
      0x00,
      0x00,
      0x00,
      0x00, // chunk size — deliberately not checked, any value
      0x57,
      0x45,
      0x42,
      0x50, // 'WEBP'
    ])
    assert(matchesImageSignature(bytes, 'image/webp'))
  },
)

// --- mismatches are rejected --------------------------------------------------------------------

Deno.test(
  'matchesImageSignature: bytes claiming image/jpeg but starting with the png signature do NOT match',
  () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    assertFalse(matchesImageSignature(pngBytes, 'image/jpeg'))
  },
)

Deno.test(
  'matchesImageSignature: arbitrary/garbage bytes never match any of the three real signatures',
  () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    assertFalse(matchesImageSignature(garbage, 'image/jpeg'))
    assertFalse(matchesImageSignature(garbage, 'image/png'))
    assertFalse(matchesImageSignature(garbage, 'image/webp'))
  },
)

Deno.test(
  'matchesImageSignature: a buffer shorter than the signature itself never matches, never throws',
  () => {
    assertFalse(matchesImageSignature(new Uint8Array([0xff, 0xd8]), 'image/jpeg'))
    assertFalse(matchesImageSignature(new Uint8Array(0), 'image/png'))
  },
)

Deno.test(
  'matchesImageSignature: RIFF at offset 0 but NOT WEBP at offset 8 (a different RIFF-based ' +
    'format, e.g. WAV) does not match image/webp',
  () => {
    const riffWav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])
    assertFalse(matchesImageSignature(riffWav, 'image/webp'))
  },
)

Deno.test(
  'matchesImageSignature: an unknown content-type (outside the jpeg/png/webp table) always ' +
    'returns false, never throws',
  () => {
    assertFalse(matchesImageSignature(new Uint8Array([0xff, 0xd8, 0xff]), 'image/gif'))
  },
)
