import { assertEquals, assertStringIncludes } from '@std/assert'
import { fromFileUrl, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import {
  buildThumbnailArgs,
  buildTranscodeArgs,
  codecsForFormat,
  defaultFormatFor,
  extensionOf,
  speedFlagsFor,
} from 'modules/media/system-ffmpeg-transcoder.ts'

const ROOT = fromFileUrl(import.meta.resolve('../../../../'))

// --- codecsForFormat / speedFlagsFor: the legacy codec-by-container mapping, pure ---------------

Deno.test("codecsForFormat: mp4 maps to libx264/aac, the legacy pipeline's own mapping", () => {
  assertEquals(codecsForFormat('mp4'), { videoCodec: 'libx264', audioCodec: 'aac' })
})

Deno.test('codecsForFormat: webm maps to libvpx-vp9/libopus', () => {
  assertEquals(codecsForFormat('webm'), { videoCodec: 'libvpx-vp9', audioCodec: 'libopus' })
})

Deno.test('speedFlagsFor: mp4 (libx264) uses -preset, webm (libvpx-vp9) never does', () => {
  assertEquals(speedFlagsFor('mp4'), ['-preset', 'slow'])
  const webmFlags = speedFlagsFor('webm')
  assertEquals(webmFlags.includes('-preset'), false)
  assertEquals(webmFlags, ['-deadline', 'good', '-cpu-used', '2'])
})

// --- extensionOf / defaultFormatFor: pure ------------------------------------------------------

Deno.test('extensionOf: extracts a lowercased extension from a real path', () => {
  assertEquals(extensionOf('/videos/Clip.MP4'), 'mp4')
  assertEquals(extensionOf('clip.webm'), 'webm')
  assertEquals(extensionOf('no-extension'), '')
})

Deno.test('defaultFormatFor: a .webm source defaults to webm, everything else to mp4', () => {
  assertEquals(defaultFormatFor('clip.webm'), 'webm')
  assertEquals(defaultFormatFor('clip.mov'), 'mp4')
  assertEquals(defaultFormatFor('clip.mp4'), 'mp4')
  assertEquals(defaultFormatFor('clip.mkv'), 'mp4')
})

// --- buildTranscodeArgs: the real argv this adapter sends to ffmpeg — pure, no subprocess -------

Deno.test('buildTranscodeArgs: includes -map_metadata -1 (metadata strip)', () => {
  const args = buildTranscodeArgs({
    sourcePath: 'in.mp4',
    outputPath: 'out.mp4',
    format: 'mp4',
    width: 720,
    videoBitrateKbps: 1000,
    audioBitrateKbps: 128,
  })

  const idx = args.indexOf('-map_metadata')
  assertEquals(idx !== -1, true)
  assertEquals(args[idx + 1], '-1')
})

Deno.test('buildTranscodeArgs: uses scale=width:-2, never a hand-computed height', () => {
  const args = buildTranscodeArgs({
    sourcePath: 'in.mp4',
    outputPath: 'out.mp4',
    format: 'mp4',
    width: 1280,
    videoBitrateKbps: 2000,
  })

  const idx = args.indexOf('-vf')
  assertEquals(args[idx + 1], 'scale=1280:-2')
})

Deno.test('buildTranscodeArgs: mp4 selects libx264/aac and -preset slow', () => {
  const args = buildTranscodeArgs({
    sourcePath: 'in.mp4',
    outputPath: 'out.mp4',
    format: 'mp4',
    width: 720,
    videoBitrateKbps: 1000,
    audioBitrateKbps: 128,
  })

  assertEquals(args.includes('libx264'), true)
  assertEquals(args.includes('aac'), true)
  assertEquals(args.includes('-preset'), true)
  assertEquals(args.includes('-deadline'), false)
})

Deno.test('buildTranscodeArgs: webm selects libvpx-vp9/libopus and -deadline/-cpu-used', () => {
  const args = buildTranscodeArgs({
    sourcePath: 'in.webm',
    outputPath: 'out.webm',
    format: 'webm',
    width: 720,
    videoBitrateKbps: 1000,
    audioBitrateKbps: 128,
  })

  assertEquals(args.includes('libvpx-vp9'), true)
  assertEquals(args.includes('libopus'), true)
  assertEquals(args.includes('-deadline'), true)
  assertEquals(args.includes('-preset'), false)
})

Deno.test('buildTranscodeArgs: video bitrate is passed as -b:v <kbps>k', () => {
  const args = buildTranscodeArgs({
    sourcePath: 'in.mp4',
    outputPath: 'out.mp4',
    format: 'mp4',
    width: 720,
    videoBitrateKbps: 1234,
  })

  const idx = args.indexOf('-b:v')
  assertEquals(args[idx + 1], '1234k')
})

Deno.test('buildTranscodeArgs: an audio bitrate present adds -c:a/-b:a, never -an', () => {
  const args = buildTranscodeArgs({
    sourcePath: 'in.mp4',
    outputPath: 'out.mp4',
    format: 'mp4',
    width: 720,
    videoBitrateKbps: 1000,
    audioBitrateKbps: 96,
  })

  assertEquals(args.includes('-c:a'), true)
  const idx = args.indexOf('-b:a')
  assertEquals(args[idx + 1], '96k')
  assertEquals(args.includes('-an'), false)
})

Deno.test('buildTranscodeArgs: no audio bitrate (source has no audio) adds -an explicitly', () => {
  const args = buildTranscodeArgs({
    sourcePath: 'in.mp4',
    outputPath: 'out.mp4',
    format: 'mp4',
    width: 720,
    videoBitrateKbps: 1000,
  })

  assertEquals(args.includes('-an'), true)
  assertEquals(args.includes('-c:a'), false)
  assertEquals(args.includes('-b:a'), false)
})

Deno.test('buildTranscodeArgs: never includes -t (deliberately not ported)', () => {
  const args = buildTranscodeArgs({
    sourcePath: 'in.mp4',
    outputPath: 'out.mp4',
    format: 'mp4',
    width: 720,
    videoBitrateKbps: 1000,
    audioBitrateKbps: 128,
  })

  assertEquals(args.includes('-t'), false)
})

Deno.test('buildTranscodeArgs: without a crf, plain -b:v ABR — no -crf/-maxrate/-bufsize', () => {
  const args = buildTranscodeArgs({
    sourcePath: 'in.mp4',
    outputPath: 'out.mp4',
    format: 'mp4',
    width: 720,
    videoBitrateKbps: 1000,
    audioBitrateKbps: 128,
  })

  assertEquals(args.includes('-crf'), false)
  assertEquals(args.includes('-maxrate'), false)
  assertEquals(args.includes('-bufsize'), false)
  const idx = args.indexOf('-b:v')
  assertEquals(args[idx + 1], '1000k')
})

// --- buildTranscodeArgs: calibrated crf/CQ modes ------------------------------------------------
// x264 = capped-CRF (`-crf` + a real, passive `-maxrate`/`-bufsize` ceiling); VP9 = CQ (`-crf` +
// `-b:v`, an ACTIVE bias, never a ceiling) — see system-ffmpeg-transcoder.ts's own doc for the
// empirical verification behind why these two are genuinely different mechanisms, not the same
// one with a renamed flag.

Deno.test(
  'buildTranscodeArgs: mp4 with a crf uses capped-CRF (-crf + -maxrate + -bufsize=2x), never plain -b:v',
  () => {
    const args = buildTranscodeArgs({
      sourcePath: 'in.mp4',
      outputPath: 'out.mp4',
      format: 'mp4',
      width: 720,
      videoBitrateKbps: 1000,
      crf: 23,
    })

    const crfIdx = args.indexOf('-crf')
    assertEquals(args[crfIdx + 1], '23')
    const maxrateIdx = args.indexOf('-maxrate')
    assertEquals(args[maxrateIdx + 1], '1000k')
    const bufsizeIdx = args.indexOf('-bufsize')
    assertEquals(args[bufsizeIdx + 1], '2000k')
    assertEquals(args.includes('-b:v'), false)
  },
)

Deno.test(
  'buildTranscodeArgs: webm with a crf uses CQ (-crf + -b:v), never -maxrate/-bufsize',
  () => {
    const args = buildTranscodeArgs({
      sourcePath: 'in.webm',
      outputPath: 'out.webm',
      format: 'webm',
      width: 720,
      videoBitrateKbps: 1000,
      crf: 30,
    })

    const crfIdx = args.indexOf('-crf')
    assertEquals(args[crfIdx + 1], '30')
    const bvIdx = args.indexOf('-b:v')
    assertEquals(args[bvIdx + 1], '1000k')
    assertEquals(args.includes('-maxrate'), false)
    assertEquals(args.includes('-bufsize'), false)
  },
)

Deno.test('buildTranscodeArgs: ends with -f <format> <outputPath>', () => {
  const args = buildTranscodeArgs({
    sourcePath: 'in.mov',
    outputPath: '/tmp/real-output.webm',
    format: 'webm',
    width: 720,
    videoBitrateKbps: 1000,
  })

  assertEquals(args.slice(-3), ['-f', 'webm', '/tmp/real-output.webm'])
})

// --- buildThumbnailArgs: pure ------------------------------------------------------------------

Deno.test('buildThumbnailArgs: seeks to atSeconds and extracts exactly one frame', () => {
  const args = buildThumbnailArgs({
    sourcePath: 'in.mp4',
    outputPath: 'out.jpg',
    atSeconds: 5,
  })

  const ssIdx = args.indexOf('-ss')
  assertEquals(args[ssIdx + 1], '5')
  const framesIdx = args.indexOf('-frames:v')
  assertEquals(args[framesIdx + 1], '1')
})

Deno.test('buildThumbnailArgs: a width option adds scale=width:-2 (even dimensions)', () => {
  const args = buildThumbnailArgs({
    sourcePath: 'in.mp4',
    outputPath: 'out.jpg',
    atSeconds: 1,
    width: 400,
  })

  const idx = args.indexOf('-vf')
  assertEquals(args[idx + 1], 'scale=400:-2')
})

Deno.test('buildThumbnailArgs: without a width, no -vf scale is added at all', () => {
  const args = buildThumbnailArgs({ sourcePath: 'in.mp4', outputPath: 'out.jpg', atSeconds: 1 })

  assertEquals(args.includes('-vf'), false)
})

// `format: 'webp'` forces an explicit -c:v libwebp — confirmed empirically (not assumed) that
// ffmpeg's own automatic encoder selection for a bare .webp output picks libwebp_anim (the
// ANIMATED encoder) instead, which fails outright on a single-frame extraction. jpeg/png are
// left to ffmpeg's own default selection — no such ambiguity exists for either.

Deno.test("buildThumbnailArgs: format 'webp' adds an explicit -c:v libwebp", () => {
  const args = buildThumbnailArgs({
    sourcePath: 'in.mp4',
    outputPath: 'out.webp',
    atSeconds: 1,
    format: 'webp',
  })

  const idx = args.indexOf('-c:v')
  assertEquals(args[idx + 1], 'libwebp')
})

Deno.test(
  "buildThumbnailArgs: format 'jpeg'/'png' never add -c:v (ffmpeg's own default is fine)",
  () => {
    const jpegArgs = buildThumbnailArgs({
      sourcePath: 'in.mp4',
      outputPath: 'out.jpg',
      atSeconds: 1,
      format: 'jpeg',
    })
    assertEquals(jpegArgs.includes('-c:v'), false)

    const pngArgs = buildThumbnailArgs({
      sourcePath: 'in.mp4',
      outputPath: 'out.png',
      atSeconds: 1,
      format: 'png',
    })
    assertEquals(pngArgs.includes('-c:v'), false)
  },
)

Deno.test('buildThumbnailArgs: no format at all never adds -c:v either', () => {
  const args = buildThumbnailArgs({ sourcePath: 'in.mp4', outputPath: 'out.jpg', atSeconds: 1 })
  assertEquals(args.includes('-c:v'), false)
})

// --- createSystemFfmpegTranscoder: throw-by-default vs explicit passthrough ---------------------
// Isolated, real subprocesses with a PATH that excludes wherever ffmpeg/ffprobe actually live on
// THIS host (e.g. Homebrew's own /opt/homebrew/bin) — deterministic "unavailable" regardless of
// whether ffmpeg happens to be installed on the machine running this suite (it now IS, on this
// one, confirmed real in @tests/integration/media/ — an in-process test here would silently start
// asserting the wrong thing the moment that becomes true, exactly what happened before this fix).
// Same reasoning/pattern ffmpeg-availability.test.ts's own missing-permission/unsupported-runtime
// subprocess tests already establish.

const RESTRICTED_PATH = '/usr/bin:/bin'

async function runIsolated(
  scriptBody: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const dir = await Deno.makeTempDir({
    dir: getTemporaryFolder(import.meta.url),
    prefix: 'transcoder-isolated-',
  })
  try {
    const path = join(dir, 'script.ts')
    // deno-coverage-ignore-file: runs only in a fresh, PATH-restricted subprocess — not project
    // source, would otherwise show up as a spurious coverage row.
    await Deno.writeTextFile(
      path,
      `// deno-coverage-ignore-file\n` +
        `import { createSystemFfmpegTranscoder } from '${ROOT}src/modules/media/system-ffmpeg-transcoder.ts'\n` +
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

/** A real, executable fake `ffmpeg`/`ffprobe` pair on `PATH`, ahead of `RESTRICTED_PATH` — lets
 * `probeFfmpegAvailability()` see a controllable, deterministic `-encoders` listing (with or
 * without `libwebp`), regardless of whatever this host's own real ffmpeg build happens to have.
 * The fake `ffmpeg` also handles a real "encode" invocation (any call that isn't `-version`/
 * `-encoders`) by writing a few bytes to its own LAST argument (the real code always passes
 * `outputPath` last) — enough to prove a real, successful call end to end without needing an
 * actual video decoder. */
async function runIsolatedWithFakeFfmpeg(
  scriptBody: string,
  encodersOutput: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const binDir = await Deno.makeTempDir({
    dir: getTemporaryFolder(import.meta.url),
    prefix: 'fake-ffmpeg-bin-',
  })
  const dir = await Deno.makeTempDir({
    dir: getTemporaryFolder(import.meta.url),
    prefix: 'transcoder-fake-ffmpeg-',
  })
  try {
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
printf '\\xff\\xd8\\xfake' > "$last"
exit 0
`,
    )
    await Deno.chmod(fakeFfmpeg, 0o755)
    const fakeFfprobe = join(binDir, 'ffprobe')
    await Deno.writeTextFile(fakeFfprobe, '#!/bin/sh\nexit 0\n')
    await Deno.chmod(fakeFfprobe, 0o755)

    const path = join(dir, 'script.ts')
    await Deno.writeTextFile(
      path,
      `// deno-coverage-ignore-file\n` +
        `import { createSystemFfmpegTranscoder } from '${ROOT}src/modules/media/system-ffmpeg-transcoder.ts'\n` +
        // An absolute, isolated output dir the scriptBody can write into instead of a bare
        // relative filename — the child process's cwd is the real repo ROOT, so a bare
        // 'thumb.webp' would silently leak a fake-encoded file into the actual repo root.
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

Deno.test(
  'createSystemFfmpegTranscoder().probe() delegates to probeFfmpegAvailability',
  async () => {
    const { code, stdout, stderr } = await runIsolated(`
const result = await createSystemFfmpegTranscoder().probe()
console.log(JSON.stringify(result))
`)

    assertEquals(code, 0, `expected a reported result, not a crash:\n${stderr}`)
    const result = JSON.parse(stdout.trim())
    assertEquals(result.available, false)
    assertEquals(result.reason, 'binary-not-found')
  },
)

Deno.test('transcode(): throws by default when unavailable, onUnavailable omitted', async () => {
  const { code, stdout, stderr } = await runIsolated(`
try {
  await createSystemFfmpegTranscoder().transcode(
    { sourcePath: 'nonexistent-source.mp4' },
    { breakpoint: 'msm', outputPath: 'nonexistent-output.mp4' },
  )
  console.log('NO_THROW')
} catch (error) {
  console.log('THREW:' + error.message)
}
`)

  assertEquals(code, 0, `expected a reported result, not a crash:\n${stderr}`)
  assertStringIncludes(stdout, 'THREW:System ffmpeg is not available')
})

Deno.test('transcode(): throws by default when explicitly onUnavailable: "throw"', async () => {
  const { code, stdout, stderr } = await runIsolated(`
try {
  await createSystemFfmpegTranscoder().transcode(
    { sourcePath: 'nonexistent-source.mp4' },
    { breakpoint: 'msm', outputPath: 'nonexistent-output.mp4', onUnavailable: 'throw' },
  )
  console.log('NO_THROW')
} catch (error) {
  console.log('THREW:' + error.message)
}
`)

  assertEquals(code, 0, `expected a reported result, not a crash:\n${stderr}`)
  assertStringIncludes(stdout, 'THREW:System ffmpeg is not available')
})

Deno.test(
  'transcode(): onUnavailable: "passthrough" copies the source untouched, never throws',
  async () => {
    const { code, stdout, stderr } = await runIsolated(`
const dir = await Deno.makeTempDir()
try {
  const sourcePath = dir + '/source.mp4'
  const outputPath = dir + '/output.mp4'
  const sourceBytes = new Uint8Array([1, 2, 3, 4, 5])
  await Deno.writeFile(sourcePath, sourceBytes)

  const result = await createSystemFfmpegTranscoder().transcode(
    { sourcePath },
    { breakpoint: 'msm', outputPath, onUnavailable: 'passthrough' },
  )
  const outputBytes = await Deno.readFile(outputPath)
  console.log(JSON.stringify({
    passthrough: result.passthrough,
    neverWorsened: result.neverWorsened,
    bytesWritten: result.bytesWritten,
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
      outputMatchesSource: true,
    })
  },
)

Deno.test('extractThumbnail(): always throws when unavailable, no passthrough option', async () => {
  const { code, stdout, stderr } = await runIsolated(`
try {
  await createSystemFfmpegTranscoder().extractThumbnail(
    { sourcePath: 'nonexistent-source.mp4' },
    { outputPath: 'nonexistent-thumb.jpg' },
  )
  console.log('NO_THROW')
} catch (error) {
  console.log('THREW:' + error.message)
}
`)

  assertEquals(code, 0, `expected a reported result, not a crash:\n${stderr}`)
  assertStringIncludes(stdout, 'THREW:System ffmpeg is not available')
})

// --- extractThumbnail({ format: 'webp' }): the guaranteed-capability contract — deterministic,
// fake-binary tests, so this passes/fails on its own real logic, never on whatever this host's
// real ffmpeg build happens to have (see ffmpeg-availability.ts's own webpEncoder doc). No silent
// fallback to jpeg/png in either branch: available -> real success, unavailable -> a specific,
// actionable throw, never a passthrough.

const ENCODERS_WITHOUT_WEBP = 'V..... libx264\nA..... aac\nV..... libvpx-vp9\nA..... libopus\n'
const ENCODERS_WITH_WEBP = ENCODERS_WITHOUT_WEBP +
  'V....D libwebp              libwebp WebP image (codec webp)\n'

Deno.test(
  "extractThumbnail({format:'webp'}): throws a SPECIFIC, actionable error when libwebp is missing " +
    '— never a raw ffmpeg stderr dump, never a silent fallback to jpeg/png',
  async () => {
    const { code, stdout, stderr } = await runIsolatedWithFakeFfmpeg(
      `
try {
  await createSystemFfmpegTranscoder().extractThumbnail(
    { sourcePath: 'source.mp4' },
    { outputPath: __outDir + '/thumb.webp', format: 'webp' },
  )
  console.log('NO_THROW')
} catch (error) {
  console.log('THREW:' + error.message)
}
`,
      ENCODERS_WITHOUT_WEBP,
    )

    assertEquals(code, 0, `expected a reported result, not a crash:\n${stderr}`)
    assertStringIncludes(stdout, 'THREW:System ffmpeg is missing WebP encoder support')
    assertStringIncludes(stdout, 'libwebp')
  },
)

Deno.test(
  "extractThumbnail({format:'webp'}): succeeds for real when libwebp IS available — never blocked " +
    'by the capability check when the capability is actually present',
  async () => {
    const { code, stdout, stderr } = await runIsolatedWithFakeFfmpeg(
      `
const result = await createSystemFfmpegTranscoder().extractThumbnail(
  { sourcePath: 'source.mp4' },
  { outputPath: __outDir + '/thumb.webp', format: 'webp' },
)
console.log(JSON.stringify(result))
`,
      ENCODERS_WITH_WEBP,
    )

    assertEquals(code, 0, `expected a successful call, not a crash:\n${stderr}`)
    const result = JSON.parse(stdout.trim())
    assertEquals(result.mimeType, 'image/webp')
    assertEquals(result.bytesWritten > 0, true)
  },
)

Deno.test(
  "extractThumbnail({format:'jpeg'}): never blocked by the webp capability check — an unrelated " +
    'format is completely unaffected by a missing libwebp',
  async () => {
    const { code, stdout, stderr } = await runIsolatedWithFakeFfmpeg(
      `
const result = await createSystemFfmpegTranscoder().extractThumbnail(
  { sourcePath: 'source.mp4' },
  { outputPath: __outDir + '/thumb.jpg' },
)
console.log(JSON.stringify(result))
`,
      ENCODERS_WITHOUT_WEBP,
    )

    assertEquals(code, 0, `expected a successful call, not a crash:\n${stderr}`)
    const result = JSON.parse(stdout.trim())
    assertEquals(result.mimeType, 'image/jpeg')
    assertEquals(result.bytesWritten > 0, true)
  },
)
