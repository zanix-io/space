import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { InternalError } from '@zanix/errors'
import { parseFfprobeOutput, probeSourceVideo } from 'modules/media/ffprobe-media.ts'

function ffprobeJson(overrides: {
  streams?: unknown[]
  format?: Record<string, unknown>
} = {}): string {
  return JSON.stringify({
    streams: overrides.streams ?? [
      { codec_type: 'video', width: 1920, height: 1080, bit_rate: '5000000' },
      { codec_type: 'audio', bit_rate: '128000' },
    ],
    format: overrides.format ?? { bit_rate: '5200000', duration: '120.5' },
  })
}

Deno.test('parseFfprobeOutput: a normal video+audio file resolves all fields correctly', () => {
  const info = parseFfprobeOutput(ffprobeJson(), 'clip.mp4')

  assertEquals(info, {
    widthPx: 1920,
    heightPx: 1080,
    videoBitrateKbps: 5000,
    audioBitrateKbps: 128,
    durationSeconds: 120.5,
    hasAudio: true,
  })
})

Deno.test('parseFfprobeOutput: a video-only source (no audio stream) has hasAudio: false', () => {
  const info = parseFfprobeOutput(
    ffprobeJson({
      streams: [{ codec_type: 'video', width: 1280, height: 720, bit_rate: '2000000' }],
    }),
    'clip.mp4',
  )

  assertEquals(info.hasAudio, false)
  assertEquals(info.audioBitrateKbps, undefined)
})

Deno.test(
  "parseFfprobeOutput: a video stream missing its own bit_rate falls back to the container's",
  () => {
    const info = parseFfprobeOutput(
      ffprobeJson({
        streams: [{ codec_type: 'video', width: 1920, height: 1080 }],
        format: { bit_rate: '3000000' },
      }),
      'clip.mp4',
    )

    assertEquals(info.videoBitrateKbps, 3000)
  },
)

Deno.test(
  'parseFfprobeOutput: an audio stream missing its own bit_rate is left undefined, never guessed',
  () => {
    const info = parseFfprobeOutput(
      ffprobeJson({
        streams: [
          { codec_type: 'video', width: 1920, height: 1080, bit_rate: '5000000' },
          { codec_type: 'audio' },
        ],
      }),
      'clip.mp4',
    )

    assertEquals(info.hasAudio, true)
    assertEquals(info.audioBitrateKbps, undefined)
  },
)

Deno.test('parseFfprobeOutput: no video stream at all throws InternalError', () => {
  const error = assertThrows(
    () =>
      parseFfprobeOutput(
        ffprobeJson({ streams: [{ codec_type: 'audio', bit_rate: '128000' }] }),
        'clip.mp4',
      ),
    InternalError,
    'no video stream',
  )
  assertEquals(error.code, 'SPACE_MEDIA_FFPROBE_NO_VIDEO_STREAM')
})

Deno.test('parseFfprobeOutput: a video stream with no width/height throws InternalError', () => {
  const error = assertThrows(
    () =>
      parseFfprobeOutput(
        ffprobeJson({ streams: [{ codec_type: 'video', bit_rate: '5000000' }] }),
        'clip.mp4',
      ),
    InternalError,
    'no video stream',
  )
  assertEquals(error.code, 'SPACE_MEDIA_FFPROBE_NO_VIDEO_STREAM')
})

Deno.test('parseFfprobeOutput: no bitrate anywhere (stream or container) throws', () => {
  const error = assertThrows(
    () =>
      parseFfprobeOutput(
        ffprobeJson({
          streams: [{ codec_type: 'video', width: 1920, height: 1080 }],
          format: { duration: '10' },
        }),
        'clip.mp4',
      ),
    InternalError,
    'Could not determine a video bitrate',
  )
  assertEquals(error.code, 'SPACE_MEDIA_FFPROBE_BITRATE_UNAVAILABLE')
})

Deno.test('parseFfprobeOutput: invalid JSON throws InternalError, never a raw SyntaxError', () => {
  const error = assertThrows(
    () => parseFfprobeOutput('not json at all', 'clip.mp4'),
    InternalError,
    'not valid JSON',
  )
  assertEquals(error.code, 'SPACE_MEDIA_FFPROBE_INVALID_OUTPUT')
})

Deno.test('parseFfprobeOutput: no duration reported leaves durationSeconds undefined', () => {
  const info = parseFfprobeOutput(ffprobeJson({ format: { bit_rate: '5200000' } }), 'clip.mp4')

  assertEquals(info.durationSeconds, undefined)
})

// --- probeSourceVideo: the real subprocess wrapper — only its two error branches, isolated via a
// real fake `ffprobe` on a scoped PATH (never the real, inherited one — a host with a real ffmpeg
// installed would otherwise resolve past these branches, same reasoning `ffmpeg-availability.
// test.ts`/`ffprobe-audio.test.ts` already document). The success path is already exercised
// end-to-end with real files in `integration/media/system-ffmpeg-transcoder*.test.ts`.

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
  'probeSourceVideo: ffprobe exiting with an error is wrapped into InternalError, ' +
    'never a raw subprocess failure',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT, prefix: 'ffprobe-video-exit-error-' })
    try {
      const fakeFfprobe = join(dir, 'ffprobe')
      await Deno.writeTextFile(fakeFfprobe, '#!/bin/sh\necho "no such file" 1>&2\nexit 1\n')
      await Deno.chmod(fakeFfprobe, 0o755)

      const error = await withScopedPath(
        dir,
        () => assertRejects(() => probeSourceVideo('missing.mp4'), InternalError),
      )
      assertEquals(error.code, 'SPACE_MEDIA_FFPROBE_EXIT_ERROR')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'probeSourceVideo: a failure to even SPAWN ffprobe (not on PATH at all) is wrapped into ' +
    'InternalError too, distinct from an exit error',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT, prefix: 'ffprobe-video-not-found-' })
    try {
      const error = await withScopedPath(
        dir,
        () => assertRejects(() => probeSourceVideo('missing.mp4'), InternalError),
      )
      assertEquals(error.code, 'SPACE_MEDIA_FFPROBE_EXEC_FAILED')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)
