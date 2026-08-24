import { assertEquals, assertStringIncludes } from '@std/assert'
import { fromFileUrl, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { buildAudioTranscodeArgs } from 'modules/media/audio/system-ffmpeg-audio-transcoder.ts'

const ROOT = fromFileUrl(import.meta.resolve('../../../../../'))

// --- buildAudioTranscodeArgs: the real argv this adapter sends to ffmpeg — pure, no subprocess ----

Deno.test('buildAudioTranscodeArgs: includes -map_metadata -1 (metadata strip)', () => {
  const args = buildAudioTranscodeArgs({
    sourcePath: 'in.wav',
    outputPath: 'out.m4a',
    codec: 'aac',
    bitrateKbps: 128,
  })
  const idx = args.indexOf('-map_metadata')
  assertEquals(idx !== -1, true)
  assertEquals(args[idx + 1], '-1')
})

Deno.test(
  'buildAudioTranscodeArgs: always includes -vn (audio-only, no video/attached-pic stream)',
  () => {
    const args = buildAudioTranscodeArgs({
      sourcePath: 'in.wav',
      outputPath: 'out.m4a',
      codec: 'aac',
      bitrateKbps: 128,
    })
    assertEquals(args.includes('-vn'), true)
  },
)

Deno.test(
  'buildAudioTranscodeArgs: never includes -ar or -ac (sample rate/channels untouched)',
  () => {
    const args = buildAudioTranscodeArgs({
      sourcePath: 'in.wav',
      outputPath: 'out.opus',
      codec: 'libopus',
      bitrateKbps: 128,
    })
    assertEquals(args.includes('-ar'), false)
    assertEquals(args.includes('-ac'), false)
  },
)

Deno.test('buildAudioTranscodeArgs: uses the requested codec via -c:a', () => {
  const aacArgs = buildAudioTranscodeArgs({
    sourcePath: 'in.wav',
    outputPath: 'out.m4a',
    codec: 'aac',
    bitrateKbps: 128,
  })
  const idx = aacArgs.indexOf('-c:a')
  assertEquals(aacArgs[idx + 1], 'aac')

  const opusArgs = buildAudioTranscodeArgs({
    sourcePath: 'in.wav',
    outputPath: 'out.opus',
    codec: 'libopus',
    bitrateKbps: 128,
  })
  const opusIdx = opusArgs.indexOf('-c:a')
  assertEquals(opusArgs[opusIdx + 1], 'libopus')
})

Deno.test('buildAudioTranscodeArgs: bitrate is passed as -b:a <kbps>k', () => {
  const args = buildAudioTranscodeArgs({
    sourcePath: 'in.wav',
    outputPath: 'out.m4a',
    codec: 'aac',
    bitrateKbps: 96,
  })
  const idx = args.indexOf('-b:a')
  assertEquals(args[idx + 1], '96k')
})

Deno.test('buildAudioTranscodeArgs: ends with outputPath', () => {
  const args = buildAudioTranscodeArgs({
    sourcePath: 'in.wav',
    outputPath: 'out.m4a',
    codec: 'aac',
    bitrateKbps: 128,
  })
  assertEquals(args.at(-1), 'out.m4a')
})

// --- createSystemFfmpegAudioTranscoder: throw-by-default vs explicit passthrough ------------------
// Isolated, real subprocesses with a PATH that excludes wherever ffmpeg/ffprobe actually live on
// THIS host — deterministic "unavailable" regardless of whether ffmpeg happens to be installed —
// same reasoning/pattern `system-ffmpeg-transcoder.test.ts`'s own isolated tests already establish.

const RESTRICTED_PATH = '/usr/bin:/bin'

async function runIsolated(
  scriptBody: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const dir = await Deno.makeTempDir({
    dir: getTemporaryFolder(import.meta.url),
    prefix: 'audio-transcoder-isolated-',
  })
  try {
    const path = join(dir, 'script.ts')
    // deno-coverage-ignore-file: runs only in a fresh, PATH-restricted subprocess — not project
    // source, would otherwise show up as a spurious coverage row.
    await Deno.writeTextFile(
      path,
      `// deno-coverage-ignore-file\n` +
        `import { createSystemFfmpegAudioTranscoder } from '${ROOT}src/modules/media/audio/system-ffmpeg-audio-transcoder.ts'\n` +
        scriptBody,
    )
    const { code, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '--allow-all',
        '--no-check',
        '--no-prompt',
        '--minimum-dependency-age=0',
        '--config',
        join(ROOT, 'deno.jsonc'),
        path,
      ],
      cwd: ROOT,
      env: { PATH: RESTRICTED_PATH },
    }).output()
    return {
      code,
      stdout: new TextDecoder().decode(stdout),
      stderr: new TextDecoder().decode(stderr),
    }
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

/** A real, executable fake `ffmpeg`/`ffprobe` pair on `PATH`, ahead of `RESTRICTED_PATH` — lets the
 * transcoder see a controllable, deterministic environment regardless of whatever this host's own
 * real ffmpeg build happens to have. `aac`/`libopus` are always reported present (this profile's
 * own baseline, already guaranteed everywhere `-encoders` is asked for). The fake `ffmpeg` also
 * handles a real "encode" invocation (any call that isn't `-version`/`-encoders`) by writing a few
 * bytes to its own LAST argument. The fake `ffprobe` answers `-show_format -show_streams` with a
 * fixed, valid JSON stub (sample_rate/channels controllable) so `probeSourceAudio` succeeds against
 * it without a real audio decoder. */
async function runIsolatedWithFakeFfmpeg(
  scriptBody: string,
  probeStub: { sampleRate: string; channels: number } = { sampleRate: '44100', channels: 1 },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const binDir = await Deno.makeTempDir({
    dir: getTemporaryFolder(import.meta.url),
    prefix: 'fake-ffmpeg-audio-bin-',
  })
  const dir = await Deno.makeTempDir({
    dir: getTemporaryFolder(import.meta.url),
    prefix: 'audio-transcoder-fake-ffmpeg-',
  })
  try {
    const encodersOutput = 'V..... libx264\nA....D aac\nV..... libvpx-vp9\nA....D libopus\n'
    const probeJson = JSON.stringify({
      streams: [{
        codec_type: 'audio',
        codec_name: 'aac',
        sample_rate: probeStub.sampleRate,
        channels: probeStub.channels,
      }],
      format: { duration: '8.000000' },
    })

    const fakeFfmpeg = join(binDir, 'ffmpeg')
    await Deno.writeTextFile(
      fakeFfmpeg,
      `#!/bin/sh
for arg in "$@"; do
  if [ "$arg" = "-encoders" ]; then
    cat <<'EOF'
${encodersOutput}
EOF
    exit 0
  fi
  if [ "$arg" = "-version" ]; then
    echo "ffmpeg version fake"
    exit 0
  fi
done
# A real "encode" call — the last argument is always the real outputPath.
for last; do :; done
printf '\\x00\\x00fake-audio-bytes' > "$last"
exit 0
`,
    )
    await Deno.chmod(fakeFfmpeg, 0o755)

    const fakeFfprobe = join(binDir, 'ffprobe')
    await Deno.writeTextFile(
      fakeFfprobe,
      `#!/bin/sh
if [ "$1" = "-version" ]; then
  echo "ffprobe version fake"
  exit 0
fi
cat <<'EOF'
${probeJson}
EOF
`,
    )
    await Deno.chmod(fakeFfprobe, 0o755)

    const path = join(dir, 'script.ts')
    await Deno.writeTextFile(
      path,
      `// deno-coverage-ignore-file\n` +
        `import { createSystemFfmpegAudioTranscoder } from '${ROOT}src/modules/media/audio/system-ffmpeg-audio-transcoder.ts'\n` +
        `const __outDir = ${JSON.stringify(dir)}\n` +
        scriptBody,
    )
    const { code, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '--allow-all',
        '--no-check',
        '--no-prompt',
        '--minimum-dependency-age=0',
        '--config',
        join(ROOT, 'deno.jsonc'),
        path,
      ],
      cwd: ROOT,
      env: { PATH: `${binDir}:${RESTRICTED_PATH}` },
    }).output()
    return {
      code,
      stdout: new TextDecoder().decode(stdout),
      stderr: new TextDecoder().decode(stderr),
    }
  } finally {
    await Deno.remove(dir, { recursive: true })
    await Deno.remove(binDir, { recursive: true })
  }
}

// --- Input-eligibility guardrail: rejected BEFORE ffmpeg is even probed — proven in an
// environment where ffmpeg/ffprobe are genuinely UNREACHABLE (RESTRICTED_PATH), so a passing
// result here can only mean validation ran first; if it ran after (or not at all), this would
// instead surface an "ffmpeg is not available" error, never the ".wav sources" one. -------------

Deno.test(
  'transcode(): voice + a non-.wav source is rejected BEFORE ffmpeg availability is even ' +
    'checked — proven with ffmpeg/ffprobe completely unreachable',
  async () => {
    const { code, stdout, stderr } = await runIsolated(`
try {
  await createSystemFfmpegAudioTranscoder().transcode(
    { sourcePath: 'upload.mp3' },
    { profile: 'voice', format: 'aac', outputPath: 'out.m4a' },
  )
  console.log('NO_THROW')
} catch (error) {
  console.log('THREW:' + error.message + '|CODE:' + error.code)
}
`)
    assertEquals(code, 0, `expected a reported result, not a crash:\n${stderr}`)
    assertStringIncludes(stdout, 'THREW:Voice audio transcoding only accepts .wav sources')
    assertStringIncludes(stdout, 'upload.mp3')
    assertStringIncludes(stdout, '|CODE:SPACE_MEDIA_VOICE_UNSUPPORTED_SOURCE')
    // The negative check that actually proves ORDER: a real, distinguishable message from the
    // "ffmpeg unavailable" branch must NEVER appear — if validation ran after (or was skipped),
    // this exact string would show up instead, since ffmpeg genuinely isn't reachable here either.
    assertEquals(stdout.includes('System ffmpeg is not available'), false)
  },
)

Deno.test(
  'transcode(): voice + .wav is NOT rejected by the guardrail — it proceeds to the (here, ' +
    'genuinely unavailable) ffmpeg check, proving the rule only blocks the wrong input, never a real one',
  async () => {
    const { code, stdout, stderr } = await runIsolated(`
const dir = await Deno.makeTempDir()
try {
  await Deno.writeFile(dir + '/source.wav', new Uint8Array([1, 2, 3]))
  try {
    await createSystemFfmpegAudioTranscoder().transcode(
      { sourcePath: dir + '/source.wav' },
      { profile: 'voice', format: 'aac', outputPath: dir + '/out.m4a' },
    )
    console.log('NO_THROW')
  } catch (error) {
    console.log('THREW:' + error.message + '|CODE:' + error.code)
  }
} finally {
  await Deno.remove(dir, { recursive: true })
}
`)
    assertEquals(code, 0, `expected a reported result, not a crash:\n${stderr}`)
    // A real .wav sails past the guardrail and reaches the NEXT real check in line.
    assertStringIncludes(stdout, 'THREW:System ffmpeg is not available for voice audio transcoding')
    assertStringIncludes(stdout, '|CODE:SPACE_MEDIA_FFMPEG_UNAVAILABLE')
  },
)

Deno.test('transcode(): throws by default when unavailable, onUnavailable omitted', async () => {
  const { code, stdout, stderr } = await runIsolated(`
try {
  await createSystemFfmpegAudioTranscoder().transcode(
    { sourcePath: 'nonexistent.wav' },
    { profile: 'voice', format: 'aac', outputPath: 'nonexistent-out.m4a' },
  )
  console.log('NO_THROW')
} catch (error) {
  console.log('THREW:' + error.message + '|CODE:' + error.code)
}
`)
  assertEquals(code, 0, `expected a reported result, not a crash:\n${stderr}`)
  assertStringIncludes(stdout, 'THREW:System ffmpeg is not available for voice audio transcoding')
  assertStringIncludes(stdout, '|CODE:SPACE_MEDIA_FFMPEG_UNAVAILABLE')
})

Deno.test(
  'transcode(): onUnavailable: "passthrough" copies the source untouched, never throws, and ' +
    'never calls ffprobe (unavailable means ffprobe may not be usable either)',
  async () => {
    const { code, stdout, stderr } = await runIsolated(`
const dir = await Deno.makeTempDir()
try {
  const sourcePath = dir + '/source.wav'
  const outputPath = dir + '/output.m4a'
  const sourceBytes = new Uint8Array([1, 2, 3, 4, 5])
  await Deno.writeFile(sourcePath, sourceBytes)

  const result = await createSystemFfmpegAudioTranscoder().transcode(
    { sourcePath },
    { profile: 'voice', format: 'aac', outputPath, onUnavailable: 'passthrough' },
  )
  const outputBytes = await Deno.readFile(outputPath)
  console.log(JSON.stringify({
    passthrough: result.passthrough,
    neverWorsened: result.neverWorsened,
    bytesWritten: result.bytesWritten,
    sampleRateHz: result.sampleRateHz,
    channels: result.channels,
    outputMatchesSource: outputBytes.length === sourceBytes.length &&
      outputBytes.every((b, i) => b === sourceBytes[i]),
  }))
} finally {
  await Deno.remove(dir, { recursive: true })
}
`)
    assertEquals(code, 0, `expected a reported result, not a crash:\n${stderr}`)
    const result = JSON.parse(stdout.trim())
    assertEquals(result, {
      passthrough: true,
      neverWorsened: false,
      bytesWritten: 5,
      // Deliberately undefined -> absent when JSON-stringified: no real ffprobe call happens in
      // this branch (see AudioTranscodeResult's own doc for why these are optional).
      outputMatchesSource: true,
    })
  },
)

Deno.test(
  'transcode(): real success when available — AAC output, correct mimeType/format, real sample ' +
    'rate/channels read back via the fake ffprobe',
  async () => {
    const { code, stdout, stderr } = await runIsolatedWithFakeFfmpeg(
      `
const dir = await Deno.makeTempDir()
try {
  const sourcePath = dir + '/source.wav'
  // Large enough that the fake "encode" output (a handful of bytes) is strictly smaller —
  // exercises the real, non-never-worsened success path.
  await Deno.writeFile(sourcePath, new Uint8Array(2000))
  const outputPath = __outDir + '/out.m4a'

  const result = await createSystemFfmpegAudioTranscoder().transcode(
    { sourcePath },
    { profile: 'voice', format: 'aac', outputPath },
  )
  console.log(JSON.stringify(result))
} finally {
  await Deno.remove(dir, { recursive: true })
}
`,
    )
    assertEquals(code, 0, `expected a successful call, not a crash:\n${stderr}`)
    const result = JSON.parse(stdout.trim())
    assertEquals(result.mimeType, 'audio/mp4')
    assertEquals(result.format, 'm4a')
    assertEquals(result.sampleRateHz, 44100)
    assertEquals(result.channels, 1)
    assertEquals(result.passthrough, false)
    assertEquals(result.neverWorsened, false)
    assertEquals(result.bytesWritten > 0, true)
  },
)

Deno.test(
  'transcode(): never-worsened when the fake encode output is NOT smaller than the source — ' +
    "reports the SOURCE's own real mimeType/format, never the fictitious target one",
  async () => {
    const { code, stdout, stderr } = await runIsolatedWithFakeFfmpeg(
      `
const dir = await Deno.makeTempDir()
try {
  const sourcePath = dir + '/source.wav'
  // Deliberately smaller than the fake "encode" output ('\\x00\\x00fake-audio-bytes', 18 bytes) —
  // forces the strict "<" comparison to discard the encode.
  await Deno.writeFile(sourcePath, new Uint8Array(3))
  const outputPath = __outDir + '/out.m4a'

  const result = await createSystemFfmpegAudioTranscoder().transcode(
    { sourcePath },
    { profile: 'voice', format: 'aac', outputPath },
  )
  const outputBytes = await Deno.readFile(outputPath)
  console.log(JSON.stringify({ ...result, outputByteLength: outputBytes.length }))
} finally {
  await Deno.remove(dir, { recursive: true })
}
`,
    )
    assertEquals(code, 0, `expected a successful call, not a crash:\n${stderr}`)
    const result = JSON.parse(stdout.trim())
    assertEquals(result.neverWorsened, true)
    assertEquals(result.passthrough, false)
    assertEquals(result.mimeType, 'audio/wav', "must report the SOURCE's real type, not m4a")
    assertEquals(result.format, 'wav')
    assertEquals(result.outputByteLength, 3, 'outputPath must hold the untouched source bytes')
  },
)
