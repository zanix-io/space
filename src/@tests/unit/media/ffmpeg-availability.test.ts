import { assertEquals, assertStringIncludes } from '@std/assert'
import { fromFileUrl, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import {
  hasRequiredEncoders,
  hasWebpEncoder,
  probeFfmpegAvailability,
  resetFfmpegAvailabilityCache,
} from 'modules/media/ffmpeg-availability.ts'

const ROOT = fromFileUrl(import.meta.resolve('../../../../'))

// --- hasRequiredEncoders: pure, no subprocess needed ------------------------------------------

Deno.test('hasRequiredEncoders: a build listing all four required encoders passes', () => {
  const output = 'V..... libx264\nA..... aac\nV..... libvpx-vp9\nA..... libopus\n'
  assertEquals(hasRequiredEncoders(output), { ok: true })
})

Deno.test(
  'hasRequiredEncoders: a minimal/LGPL-only build missing libx264 is reported by name',
  () => {
    const output = 'A..... aac\nV..... libvpx-vp9\nA..... libopus\n'
    const result = hasRequiredEncoders(output)

    assertEquals(result.ok, false)
    assertEquals(result.reason, 'incompatible-binary')
    assertStringIncludes(result.detail ?? '', 'libx264')
  },
)

Deno.test(
  'hasRequiredEncoders: multiple missing encoders are all named, not just the first',
  () => {
    const result = hasRequiredEncoders('V..... libx264\nA..... aac\n')

    assertStringIncludes(result.detail ?? '', 'libvpx-vp9')
    assertStringIncludes(result.detail ?? '', 'libopus')
  },
)

Deno.test('hasRequiredEncoders: an empty/garbage listing reports all four missing', () => {
  const result = hasRequiredEncoders('')

  assertEquals(result.ok, false)
  for (const encoder of ['libx264', 'aac', 'libvpx-vp9', 'libopus']) {
    assertStringIncludes(result.detail ?? '', encoder)
  }
})

// --- hasWebpEncoder: pure, no subprocess needed — NEVER folded into hasRequiredEncoders, since a
// build missing libwebp is still fully usable for everything except format: 'webp' thumbnails ---

Deno.test('hasWebpEncoder: a build listing libwebp is detected', () => {
  const output = 'V..... libx264\nV....D libwebp              libwebp WebP image (codec webp)\n'
  assertEquals(hasWebpEncoder(output), true)
})

Deno.test('hasWebpEncoder: a build without libwebp reports false', () => {
  const output = 'V..... libx264\nA..... aac\nV..... libvpx-vp9\nA..... libopus\n'
  assertEquals(hasWebpEncoder(output), false)
})

// --- probeFfmpegAvailability: real, in-process — this dev/CI environment genuinely has no ffmpeg
// installed (confirmed with `which ffmpeg` before writing this suite), so 'binary-not-found' is
// exercised for real here, not simulated. In an environment that DOES have ffmpeg, this same test
// still passes: 'available' being true is asserted as equally acceptable, since what's actually
// under test is "the function completes and returns a well-formed result," and the two dedicated
// subprocess tests below independently prove the 'missing-permission'/'unsupported-runtime'
// branches regardless of what's on THIS host's own PATH.

Deno.test(
  'probeFfmpegAvailability: returns a well-formed result either way, real environment',
  async () => {
    resetFfmpegAvailabilityCache()
    const result = await probeFfmpegAvailability()

    if (result.available) {
      assertEquals(result.reason, undefined)
      assertEquals(typeof result.capabilities?.webpEncoder, 'boolean')
    } else {
      assertEquals(
        ['unsupported-runtime', 'missing-permission', 'binary-not-found', 'incompatible-binary']
          .includes(result.reason ?? ''),
        true,
      )
      assertEquals(typeof result.detail, 'string')
    }
  },
)

Deno.test('probeFfmpegAvailability: memoized — a second call returns the same result', async () => {
  resetFfmpegAvailabilityCache()
  const first = await probeFfmpegAvailability()
  const second = await probeFfmpegAvailability()

  assertEquals(first, second)
})

// --- 'missing-permission' and 'unsupported-runtime': asserted in real, isolated subprocesses —
// mutating this process's own permissions or its real, shared `Deno.Command` global would risk
// interfering with every other test that needs either, the same reasoning
// not-found-renderer-registry.test.ts's own subprocess test already documents for its equivalent
// "process-wide state" case.

async function runInSubprocess(
  script: string,
  extraArgs: string[],
  env?: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const dir = await Deno.makeTempDir({
    dir: getTemporaryFolder(import.meta.url),
    prefix: 'ffmpeg-availability-',
  })
  try {
    const path = join(dir, 'script.ts')
    await Deno.writeTextFile(path, script)
    const { code, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        ...extraArgs,
        '--no-check',
        '--no-prompt',
        '--minimum-dependency-age=0',
        '--config',
        join(ROOT, 'deno.jsonc'),
        path,
      ],
      cwd: ROOT,
      env,
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

Deno.test(
  "probeFfmpegAvailability: reports 'binary-not-found' via the real Deno.errors.NotFound path " +
    'when ffmpeg genuinely does not exist anywhere on PATH — deterministic regardless of ' +
    'whether THIS host happens to have a real ffmpeg installed',
  async () => {
    // An empty temp dir as the ENTIRE PATH — no fake binary placed here, and no fallback to the
    // real, inherited PATH (a host with a real ffmpeg installed, confirmed to exist for some
    // hosts, would otherwise resolve past this branch entirely).
    const dir = await Deno.makeTempDir({
      dir: getTemporaryFolder(import.meta.url),
      prefix: 'no-ffmpeg-at-all-',
    })
    try {
      const script = `// deno-coverage-ignore-file
import { probeFfmpegAvailability } from '${ROOT}src/modules/media/ffmpeg-availability.ts'
const result = await probeFfmpegAvailability()
console.log(JSON.stringify(result))
`
      const { code, stdout, stderr } = await runInSubprocess(
        script,
        ['--allow-run', '--allow-read', '--allow-env'],
        { PATH: dir },
      )

      assertEquals(code, 0, `expected a reported result, not a crash:\n${stderr}`)
      const result = JSON.parse(stdout.trim())
      assertEquals(result.available, false)
      assertEquals(result.reason, 'binary-not-found')
      assertStringIncludes(result.detail, 'was not found on PATH')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  "probeFfmpegAvailability: reports 'missing-permission' in a real subprocess with no --allow-run",
  async () => {
    // Confirmed empirically first (see this test's own git history/PR): Deno reports NotFound,
    // not NotCapable, for a binary that genuinely doesn't exist on PATH — REGARDLESS of whether
    // --allow-run was granted. Permission denial can only be observed for a binary that DOES
    // resolve, which "ffmpeg" never does on this dev machine (confirmed: no ffmpeg installed).
    // A minimal, real, executable fake "ffmpeg" is placed on PATH so existence resolves — the
    // subprocess still lacks --allow-run, isolating the permission branch specifically.
    const dir = await Deno.makeTempDir({
      dir: getTemporaryFolder(import.meta.url),
      prefix: 'fake-ffmpeg-',
    })
    try {
      const fakeFfmpeg = join(dir, 'ffmpeg')
      await Deno.writeTextFile(fakeFfmpeg, '#!/bin/sh\nexit 0\n')
      await Deno.chmod(fakeFfmpeg, 0o755)

      // deno-coverage-ignore-file: this script exists only to run in a fresh, permission-
      // restricted subprocess — not project source, would otherwise show up as a spurious
      // coverage row.
      const script = `// deno-coverage-ignore-file
import { probeFfmpegAvailability } from '${ROOT}src/modules/media/ffmpeg-availability.ts'
const result = await probeFfmpegAvailability()
console.log(JSON.stringify(result))
`
      // No --allow-run granted — permissions deny by default, no explicit --deny-run flag needed
      // (confirmed: that flag doesn't exist on this Deno version's `run` subcommand either).
      const { code, stdout, stderr } = await runInSubprocess(
        script,
        ['--allow-read', '--allow-env'],
        { PATH: `${dir}:${Deno.env.get('PATH') ?? ''}` },
      )

      assertEquals(code, 0, `expected a reported result, not a crash:\n${stderr}`)
      const result = JSON.parse(stdout.trim())
      assertEquals(result.available, false)
      assertEquals(result.reason, 'missing-permission')
      assertStringIncludes(result.detail, '--allow-run')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  "probeFfmpegAvailability: reports 'unsupported-runtime' when Deno.Command itself is absent",
  async () => {
    // deno-coverage-ignore-file: same reasoning as the subprocess above.
    // `import` is hoisted regardless of its textual position — ffmpeg-availability.ts's own
    // top-level evaluation never touches Deno.Command itself (only the async function does, once
    // called below), so reassigning it first here is safe and intentional, not a race.
    const script = `// deno-coverage-ignore-file
import { probeFfmpegAvailability } from '${ROOT}src/modules/media/ffmpeg-availability.ts'
// deno-lint-ignore no-explicit-any
;(Deno as any).Command = undefined
const result = await probeFfmpegAvailability()
console.log(JSON.stringify(result))
`
    const { code, stdout, stderr } = await runInSubprocess(script, ['--allow-all'])

    assertEquals(code, 0, `expected a reported result, not a crash:\n${stderr}`)
    const result = JSON.parse(stdout.trim())
    assertEquals(result.available, false)
    assertEquals(result.reason, 'unsupported-runtime')
    assertStringIncludes(result.detail, 'Deno.Command')
  },
)

// --- webpEncoder capability: deterministic, real fake binaries on PATH — NEVER depends on
// whatever this host's own real ffmpeg happens to have, since the whole point is a guaranteed,
// environment-independent contract (see system-ffmpeg-transcoder.ts's own webp doc).

async function writeFakeFfmpegSuite(
  dir: string,
  encodersOutput: string,
): Promise<void> {
  const fakeFfmpeg = join(dir, 'ffmpeg')
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
done
exit 0
`,
  )
  await Deno.chmod(fakeFfmpeg, 0o755)

  const fakeFfprobe = join(dir, 'ffprobe')
  await Deno.writeTextFile(fakeFfprobe, '#!/bin/sh\nexit 0\n')
  await Deno.chmod(fakeFfprobe, 0o755)
}

const REQUIRED_ENCODERS_TEXT = 'V..... libx264\nA..... aac\nV..... libvpx-vp9\nA..... libopus\n'

Deno.test(
  'probeFfmpegAvailability: capabilities.webpEncoder is false on a real (fake) build without libwebp',
  async () => {
    const dir = await Deno.makeTempDir({
      dir: getTemporaryFolder(import.meta.url),
      prefix: 'fake-ffmpeg-no-webp-',
    })
    try {
      await writeFakeFfmpegSuite(dir, REQUIRED_ENCODERS_TEXT)

      const script = `// deno-coverage-ignore-file
import { probeFfmpegAvailability } from '${ROOT}src/modules/media/ffmpeg-availability.ts'
const result = await probeFfmpegAvailability()
console.log(JSON.stringify(result))
`
      const { code, stdout, stderr } = await runInSubprocess(
        script,
        ['--allow-run', '--allow-read', '--allow-env'],
        { PATH: `${dir}:${Deno.env.get('PATH') ?? ''}` },
      )

      assertEquals(code, 0, `expected a reported result, not a crash:\n${stderr}`)
      const result = JSON.parse(stdout.trim())
      assertEquals(result.available, true)
      assertEquals(result.capabilities, { webpEncoder: false })
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  "probeFfmpegAvailability: reports 'binary-not-found' when ffmpeg resolves on PATH but exits " +
    'non-zero — the real-process failure path, distinct from Deno.errors.NotFound',
  async () => {
    const dir = await Deno.makeTempDir({
      dir: getTemporaryFolder(import.meta.url),
      prefix: 'nonzero-ffmpeg-',
    })
    try {
      const brokenFfmpeg = join(dir, 'ffmpeg')
      await Deno.writeTextFile(brokenFfmpeg, '#!/bin/sh\necho "broken build" 1>&2\nexit 1\n')
      await Deno.chmod(brokenFfmpeg, 0o755)

      const script = `// deno-coverage-ignore-file
import { probeFfmpegAvailability } from '${ROOT}src/modules/media/ffmpeg-availability.ts'
const result = await probeFfmpegAvailability()
console.log(JSON.stringify(result))
`
      const { code, stdout, stderr } = await runInSubprocess(
        script,
        ['--allow-run', '--allow-read', '--allow-env'],
        { PATH: `${dir}:${Deno.env.get('PATH') ?? ''}` },
      )

      assertEquals(code, 0, `expected a reported result, not a crash:\n${stderr}`)
      const result = JSON.parse(stdout.trim())
      assertEquals(result.available, false)
      assertEquals(result.reason, 'binary-not-found')
      assertStringIncludes(result.detail, 'non-zero status')
      assertStringIncludes(result.detail, 'broken build')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

// `checkBinaryRuns`'s generic `catch` fallback (neither `Deno.errors.NotCapable` nor
// `Deno.errors.NotFound`) is deliberately NOT forced with a fabricated PATH-resolution failure
// here: confirmed empirically (chmod 0 file, a directory shadowing the binary name, both tried)
// that Deno's own `Command` spawn implementation normalizes every PATH-resolution failure for a
// bare (non-absolute) command name down to `Deno.errors.NotFound` — never `PermissionDenied` or
// any other class, regardless of the real underlying OS-level cause. Since `checkBinaryRuns` only
// ever spawns `'ffmpeg'`/`'ffprobe'` as bare names (never an absolute path), this catch-all is
// unreachable via any realistic PATH misconfiguration on this platform — dead code by design, not
// a real gap (`complete-test-coverage`'s own Phase 2 "defensive error handling that should never
// trigger" bucket), left uncovered rather than forced with a synthetic throw.

Deno.test(
  "probeFfmpegAvailability: reports ffprobe's OWN failure reason even when ffmpeg itself is fine " +
    '— the two binaries are checked independently, not conflated into one result',
  async () => {
    const dir = await Deno.makeTempDir({
      dir: getTemporaryFolder(import.meta.url),
      prefix: 'broken-ffprobe-',
    })
    try {
      const okFfmpeg = join(dir, 'ffmpeg')
      await Deno.writeTextFile(okFfmpeg, '#!/bin/sh\nexit 0\n')
      await Deno.chmod(okFfmpeg, 0o755)
      const brokenFfprobe = join(dir, 'ffprobe')
      await Deno.writeTextFile(brokenFfprobe, '#!/bin/sh\nexit 1\n')
      await Deno.chmod(brokenFfprobe, 0o755)

      const script = `// deno-coverage-ignore-file
import { probeFfmpegAvailability } from '${ROOT}src/modules/media/ffmpeg-availability.ts'
const result = await probeFfmpegAvailability()
console.log(JSON.stringify(result))
`
      const { code, stdout, stderr } = await runInSubprocess(
        script,
        ['--allow-run', '--allow-read', '--allow-env'],
        { PATH: `${dir}:${Deno.env.get('PATH') ?? ''}` },
      )

      assertEquals(code, 0, `expected a reported result, not a crash:\n${stderr}`)
      const result = JSON.parse(stdout.trim())
      assertEquals(result.available, false)
      assertEquals(result.reason, 'binary-not-found')
      assertStringIncludes(result.detail, 'ffprobe')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  "probeFfmpegAvailability: reports 'incompatible-binary' end-to-end when the real " +
    '`-encoders` output is missing a required encoder — not just via `hasRequiredEncoders` in isolation',
  async () => {
    const dir = await Deno.makeTempDir({
      dir: getTemporaryFolder(import.meta.url),
      prefix: 'incompatible-ffmpeg-',
    })
    try {
      // Missing libx264 — a real minimal/LGPL-only build shape.
      await writeFakeFfmpegSuite(dir, 'A..... aac\nV..... libvpx-vp9\nA..... libopus\n')

      const script = `// deno-coverage-ignore-file
import { probeFfmpegAvailability } from '${ROOT}src/modules/media/ffmpeg-availability.ts'
const result = await probeFfmpegAvailability()
console.log(JSON.stringify(result))
`
      const { code, stdout, stderr } = await runInSubprocess(
        script,
        ['--allow-run', '--allow-read', '--allow-env'],
        { PATH: `${dir}:${Deno.env.get('PATH') ?? ''}` },
      )

      assertEquals(code, 0, `expected a reported result, not a crash:\n${stderr}`)
      const result = JSON.parse(stdout.trim())
      assertEquals(result.available, false)
      assertEquals(result.reason, 'incompatible-binary')
      assertStringIncludes(result.detail, 'libx264')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'probeFfmpegAvailability: capabilities.webpEncoder is true on a real (fake) build with libwebp',
  async () => {
    const dir = await Deno.makeTempDir({
      dir: getTemporaryFolder(import.meta.url),
      prefix: 'fake-ffmpeg-with-webp-',
    })
    try {
      await writeFakeFfmpegSuite(
        dir,
        REQUIRED_ENCODERS_TEXT + 'V....D libwebp              libwebp WebP image (codec webp)\n',
      )

      const script = `// deno-coverage-ignore-file
import { probeFfmpegAvailability } from '${ROOT}src/modules/media/ffmpeg-availability.ts'
const result = await probeFfmpegAvailability()
console.log(JSON.stringify(result))
`
      const { code, stdout, stderr } = await runInSubprocess(
        script,
        ['--allow-run', '--allow-read', '--allow-env'],
        { PATH: `${dir}:${Deno.env.get('PATH') ?? ''}` },
      )

      assertEquals(code, 0, `expected a reported result, not a crash:\n${stderr}`)
      const result = JSON.parse(stdout.trim())
      assertEquals(result.available, true)
      assertEquals(result.capabilities, { webpEncoder: true })
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)
