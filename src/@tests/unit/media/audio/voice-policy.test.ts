import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import { InternalError } from '@zanix/errors'
import {
  buildVoiceTransformId,
  codecForVoiceFormat,
  extensionForVoiceFormat,
  isVoiceSource,
  validateVoiceSource,
  VOICE_DEFAULT_BITRATE_KBPS,
  VOICE_TRANSFORM_POLICY_VERSION,
} from 'modules/media/audio/policies/voice.ts'

Deno.test('VOICE_DEFAULT_BITRATE_KBPS: the approved initial voice policy value', () => {
  assertEquals(VOICE_DEFAULT_BITRATE_KBPS, 128)
})

Deno.test('VOICE_TRANSFORM_POLICY_VERSION: starts at v1', () => {
  assertEquals(VOICE_TRANSFORM_POLICY_VERSION, 'v1')
})

Deno.test('codecForVoiceFormat: aac -> aac (native encoder), opus -> libopus', () => {
  assertEquals(codecForVoiceFormat('aac'), 'aac')
  assertEquals(codecForVoiceFormat('opus'), 'libopus')
})

Deno.test('extensionForVoiceFormat: aac -> m4a, opus -> opus', () => {
  assertEquals(extensionForVoiceFormat('aac'), 'm4a')
  assertEquals(extensionForVoiceFormat('opus'), 'opus')
})

Deno.test(
  'buildVoiceTransformId: encodes format + resolved bitrate, defaulting when omitted',
  () => {
    assertEquals(
      buildVoiceTransformId({ profile: 'voice', format: 'aac', outputPath: 'x' }),
      'voice:aac:b128',
    )
    assertEquals(
      buildVoiceTransformId({ profile: 'voice', format: 'opus', outputPath: 'x' }),
      'voice:opus:b128',
    )
    assertEquals(
      buildVoiceTransformId({
        profile: 'voice',
        format: 'aac',
        bitrateKbps: 96,
        outputPath: 'x',
      }),
      'voice:aac:b96',
    )
  },
)

Deno.test(
  'buildVoiceTransformId: aac and opus never collide, even at the same bitrate',
  () => {
    const aacId = buildVoiceTransformId({ profile: 'voice', format: 'aac', outputPath: 'x' })
    const opusId = buildVoiceTransformId({ profile: 'voice', format: 'opus', outputPath: 'x' })
    assertEquals(aacId === opusId, false)
  },
)

Deno.test(
  'buildVoiceTransformId: the "voice:" prefix is what would keep a future "music:aac:b128" from ' +
    'ever colliding with this profile\'s own "voice:aac:b128" — same format, same bitrate, still a ' +
    'different transform identity because of the profile prefix itself',
  () => {
    const voiceAac128 = buildVoiceTransformId({ profile: 'voice', format: 'aac', outputPath: 'x' })
    assertEquals(voiceAac128, 'voice:aac:b128')
    assertEquals(voiceAac128.startsWith('voice:'), true)
    assertEquals(voiceAac128.startsWith('music:'), false)
  },
)

Deno.test('isVoiceSource: true only for .wav, case-insensitive', () => {
  assertEquals(isVoiceSource('memo.wav'), true)
  assertEquals(isVoiceSource('memo.WAV'), true)
  assertEquals(isVoiceSource('/assets/voice/memo.wav'), true)
})

Deno.test(
  'isVoiceSource: false for already-compressed lossy formats — conservative by design',
  () => {
    assertEquals(isVoiceSource('memo.mp3'), false)
    assertEquals(isVoiceSource('memo.m4a'), false)
    assertEquals(isVoiceSource('memo.opus'), false)
    assertEquals(isVoiceSource('memo.aac'), false)
    assertEquals(isVoiceSource('memo.ogg'), false)
    assertEquals(isVoiceSource('memo.flac'), false)
  },
)

Deno.test(
  'isVoiceSource: false for headerless raw PCM — deliberately excluded, see this ' +
    "policy's own doc for why",
  () => {
    assertEquals(isVoiceSource('memo.pcm'), false)
  },
)

Deno.test('isVoiceSource: false for a non-audio extension', () => {
  assertEquals(isVoiceSource('clip.mp4'), false)
  assertEquals(isVoiceSource('logo.svg'), false)
})

// --- validateVoiceSource: the REAL guardrail (throws), not just the boolean check — this is the
// function `system-ffmpeg-audio-transcoder.ts` calls before ever touching ffmpeg. -----------------

Deno.test('validateVoiceSource: voice + .wav -> allowed, never throws', () => {
  validateVoiceSource('memo.wav')
  validateVoiceSource('/assets/voice/memo.WAV') // case-insensitive, same as isVoiceSource
})

Deno.test(
  'validateVoiceSource: voice + MP3/AAC/Opus/M4A/OGG/FLAC -> rejected with a specific, ' +
    'actionable error, never a silent pass-through',
  () => {
    for (
      const path of [
        'upload.mp3',
        'upload.aac',
        'upload.opus',
        'upload.m4a',
        'upload.ogg',
        'upload.flac',
      ]
    ) {
      const error = assertThrows(
        () => validateVoiceSource(path),
        InternalError,
        'only accepts .wav sources',
      )
      assertStringIncludes(error.message, path)
      assertEquals(error.code, 'SPACE_MEDIA_VOICE_UNSUPPORTED_SOURCE')
    }
  },
)

Deno.test('validateVoiceSource: reuses isVoiceSource as its own single source of truth', () => {
  // Every extension isVoiceSource rejects, validateVoiceSource must ALSO reject — and vice versa —
  // proving there is no second, independently-maintained list that could silently drift apart.
  const candidates = ['memo.wav', 'memo.mp3', 'memo.m4a', 'memo.opus', 'memo.pcm', 'clip.mp4']
  for (const path of candidates) {
    if (isVoiceSource(path)) {
      validateVoiceSource(path) // must not throw
    } else {
      assertThrows(() => validateVoiceSource(path))
    }
  }
})
