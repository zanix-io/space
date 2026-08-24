import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { InternalError } from '@zanix/errors'
import { parseFfprobeAudioOutput, probeSourceAudio } from 'modules/media/audio/ffprobe-audio.ts'

console.error = () => {}

function ffprobeJson(overrides: {
  sampleRate?: string
  channels?: number
  streamBitRate?: string
  formatBitRate?: string
  duration?: string
  codecName?: string
  noAudioStream?: boolean
}): string {
  const stream = overrides.noAudioStream ? [] : [{
    codec_type: 'audio',
    codec_name: overrides.codecName ?? 'aac',
    sample_rate: overrides.sampleRate ?? '44100',
    channels: overrides.channels ?? 1,
    bit_rate: overrides.streamBitRate,
  }]
  return JSON.stringify({
    streams: stream,
    format: { bit_rate: overrides.formatBitRate, duration: overrides.duration },
  })
}

Deno.test(
  'parseFfprobeAudioOutput: reads sampleRateHz/channels/codecName off a real stream',
  () => {
    const info = parseFfprobeAudioOutput(
      ffprobeJson({ sampleRate: '44100', channels: 2, codecName: 'aac' }),
      'x.m4a',
    )
    assertEquals(info.sampleRateHz, 44100)
    assertEquals(info.channels, 2)
    assertEquals(info.codecName, 'aac')
  },
)

Deno.test('parseFfprobeAudioOutput: stream bit_rate is preferred over the container total', () => {
  const info = parseFfprobeAudioOutput(
    ffprobeJson({ streamBitRate: '128000', formatBitRate: '130000' }),
    'x.m4a',
  )
  assertEquals(info.bitRateKbps, 128)
})

Deno.test(
  'parseFfprobeAudioOutput: falls back to the container bit_rate when the stream has none',
  () => {
    const info = parseFfprobeAudioOutput(ffprobeJson({ formatBitRate: '130000' }), 'x.m4a')
    assertEquals(info.bitRateKbps, 130)
  },
)

Deno.test('parseFfprobeAudioOutput: bitRateKbps is undefined when neither reports one', () => {
  const info = parseFfprobeAudioOutput(ffprobeJson({}), 'x.m4a')
  assertEquals(info.bitRateKbps, undefined)
})

Deno.test('parseFfprobeAudioOutput: durationSeconds reads the container duration', () => {
  const info = parseFfprobeAudioOutput(ffprobeJson({ duration: '8.000000' }), 'x.m4a')
  assertEquals(info.durationSeconds, 8)
})

Deno.test('parseFfprobeAudioOutput: durationSeconds is undefined when absent', () => {
  const info = parseFfprobeAudioOutput(ffprobeJson({}), 'x.m4a')
  assertEquals(info.durationSeconds, undefined)
})

Deno.test('parseFfprobeAudioOutput: throws InternalError on invalid JSON', () => {
  const error = assertThrows(
    () => parseFfprobeAudioOutput('not json', 'x.wav'),
    InternalError,
    'not valid JSON',
  )
  assertEquals(error.code, 'SPACE_MEDIA_FFPROBE_INVALID_OUTPUT')
})

Deno.test(
  'parseFfprobeAudioOutput: throws InternalError when no audio stream is reported',
  () => {
    const error = assertThrows(
      () => parseFfprobeAudioOutput(ffprobeJson({ noAudioStream: true }), 'x.wav'),
      InternalError,
      'no audio stream',
    )
    assertEquals(error.code, 'SPACE_MEDIA_FFPROBE_NO_AUDIO_STREAM')
  },
)

// --- probeSourceAudio: the real subprocess wrapper — only its two error branches, isolated via a
// real fake `ffprobe` on a scoped PATH (never the real, inherited one — see `ffmpeg-availability.
// test.ts`'s own doc for why appending it would be host-dependent). The success path is already
// exercised end-to-end with a real audio file in `system-ffmpeg-audio-transcoder.test.ts`.

const TMP_ROOT = getTemporaryFolder(import.meta.url)

async function withScopedPath<T>(dir: string, run: () => Promise<T>): Promise<T> {
  const original = Deno.env.get('PATH')
  try {
    Deno.env.set('PATH', dir)
    return await run()
  } finally {
    if (original === undefined) Deno.env.delete('PATH')
    else Deno.env.set('PATH', original)
  }
}

Deno.test(
  'probeSourceAudio: ffprobe exiting with an error is wrapped into InternalError, ' +
    'never a raw subprocess failure',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT, prefix: 'ffprobe-exit-error-' })
    try {
      const fakeFfprobe = join(dir, 'ffprobe')
      await Deno.writeTextFile(fakeFfprobe, '#!/bin/sh\necho "no such file" 1>&2\nexit 1\n')
      await Deno.chmod(fakeFfprobe, 0o755)

      const error = await withScopedPath(
        dir,
        () => assertRejects(() => probeSourceAudio('missing.wav'), InternalError),
      )
      assertEquals(error.code, 'SPACE_MEDIA_FFPROBE_EXIT_ERROR')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'probeSourceAudio: a failure to even SPAWN ffprobe (not on PATH at all) is wrapped into ' +
    'InternalError too, distinct from an exit error',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT, prefix: 'ffprobe-not-found-' })
    try {
      const error = await withScopedPath(
        dir,
        () => assertRejects(() => probeSourceAudio('missing.wav'), InternalError),
      )
      assertEquals(error.code, 'SPACE_MEDIA_FFPROBE_EXEC_FAILED')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)
