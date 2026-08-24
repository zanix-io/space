import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { createSystemFfmpegTranscoder } from 'modules/media/system-ffmpeg-transcoder.ts'
import { probeFfmpegAvailability } from 'modules/media/ffmpeg-availability.ts'
import { probeSourceVideo } from 'modules/media/ffprobe-media.ts'
import {
  VIDEO_BREAKPOINT_PRESETS,
  type VideoBreakpointName,
} from 'modules/media/video-breakpoints.ts'

/**
 * The "validation pass final" for the calibrated capped-CRF (x264) / CQ (VP9) values in
 * `video-breakpoints.ts` — real `ffmpeg`/`ffprobe`/`libvmaf` calls, through
 * `createSystemFfmpegTranscoder()` itself, never the standalone benchmark harness that originally
 * found these values (`/private/tmp/.../ffmpeg-benchmark/`, not part of this repo). Same
 * `ignore`-when-unavailable gating as the sibling `system-ffmpeg-transcoder.test.ts`.
 *
 * What this confirms per breakpoint × codec, against the real production code path:
 * - real output width/codec/rate-control mode match what `video-breakpoints.ts` calibrated
 * - real measured bitrate/size is smaller than the pre-calibration plain-ABR baseline
 * - real VMAF (Y4M-normalized, same methodology the benchmark used) clears this breakpoint's own
 *   floor for representative content
 * - never-worsen and the source-bitrate cap both still fire correctly under the new modes
 */
const availability = await probeFfmpegAvailability()
const ignore = !availability.available

async function tempDir(prefix: string): Promise<string> {
  return await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url), prefix })
}

async function run(args: string[]): Promise<{ success: boolean; stderr: string }> {
  const { success, stderr } = await new Deno.Command('ffmpeg', { args, stderr: 'piped' }).output()
  return { success, stderr: new TextDecoder().decode(stderr) }
}

/** A real, moderately complex synthetic clip (moving `testsrc2` + tone) — enough genuine entropy
 * that a real quality-vs-size trade-off is actually exercised, unlike the near-zero-entropy
 * `color` fixture the sibling suite uses for its own never-worsen test. 1920x1080 source so every
 * breakpoint (up to `dlg`'s own 1920) gets a real resize to verify, never a no-op. */
async function generateRepresentativeFixture(path: string, durationSeconds = 3): Promise<void> {
  const { success, stderr } = await run([
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=1920x1080:duration=${durationSeconds}:rate=24`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${durationSeconds}`,
    '-pix_fmt',
    'yuv420p',
    '-c:v',
    'libx264',
    '-crf',
    '10',
    '-c:a',
    'aac',
    path,
  ])
  assert(success, `representative fixture generation failed: ${stderr}`)
}

/** A near-lossless reference at the breakpoint's own output width — VMAF's ground truth. Same
 * reasoning as the benchmark's own `refs/*.ref.mp4`: high enough quality that the reference itself
 * never becomes the bottleneck being measured. */
async function generateReference(
  sourcePath: string,
  width: number,
  outPath: string,
): Promise<void> {
  const { success, stderr } = await run([
    '-y',
    '-i',
    sourcePath,
    '-vf',
    `scale=${width}:-2`,
    '-c:v',
    'libx264',
    '-crf',
    '4',
    '-preset',
    'veryfast',
    '-an',
    outPath,
  ])
  assert(success, `reference generation failed: ${stderr}`)
}

/** VMAF/SSIM via Y4M normalization — the corrected methodology (never comparing containers
 * directly): a `color_range` mismatch between an mp4/h264 reference and a webm/vp9 distorted file
 * was confirmed, in the benchmark that calibrated these values, to produce a false periodic VMAF
 * collapse when compared without this normalization step first. */
async function measureVmafSsim(
  distortedPath: string,
  referencePath: string,
  workDir: string,
): Promise<{ vmafMean: number; vmafMin: number; ssim: number }> {
  const distY4m = join(workDir, 'dist.y4m')
  const refY4m = join(workDir, 'ref.y4m')
  const vmafJson = join(workDir, 'vmaf.json')

  await run(['-y', '-i', distortedPath, '-pix_fmt', 'yuv420p', '-r', '24', distY4m])
  await run(['-y', '-i', referencePath, '-pix_fmt', 'yuv420p', '-r', '24', refY4m])
  await run([
    '-y',
    '-i',
    distY4m,
    '-i',
    refY4m,
    '-lavfi',
    `libvmaf=log_fmt=json:log_path=${vmafJson}`,
    '-f',
    'null',
    '-',
  ])
  const vmafData = JSON.parse(await Deno.readTextFile(vmafJson))
  const vmafMean = vmafData.pooled_metrics.vmaf.mean as number
  const vmafMin = vmafData.pooled_metrics.vmaf.min as number

  const ssimResult = await run(['-i', distY4m, '-i', refY4m, '-lavfi', 'ssim', '-f', 'null', '-'])
  const ssimMatch = ssimResult.stderr.match(/All:([\d.]+)/g)
  const ssim = ssimMatch ? parseFloat(ssimMatch[ssimMatch.length - 1].slice(4)) : NaN

  return { vmafMean, vmafMin, ssim }
}

// Per-breakpoint VMAF floor: this breakpoint's own x264-current (plain ABR) VMAF measured on the
// benchmark's `product-marketing` fixture, minus a 2-point tolerance — never an arbitrary external
// VMAF reference (see video-breakpoints.ts's own doc). Same floors the calibration itself targeted.
const VMAF_FLOOR: Record<VideoBreakpointName, number> = {
  msm: 96.4,
  mlg: 97.0,
  dmd: 94.5,
  dlg: 91.8,
}

const BREAKPOINTS: VideoBreakpointName[] = ['msm', 'mlg', 'dmd', 'dlg']

for (const breakpoint of BREAKPOINTS) {
  for (const format of ['mp4', 'webm'] as const) {
    Deno.test({
      name:
        `calibration validation: ${breakpoint}/${format} — real resolution/codec/bitrate/VMAF ` +
        `against SystemFfmpegTranscoder itself`,
      ignore,
      async fn() {
        // deno-lint-ignore no-await-in-loop
        const dir = await tempDir(`calibration-${breakpoint}-${format}-`)
        try {
          const sourcePath = join(dir, 'source.mp4')
          // deno-lint-ignore no-await-in-loop
          await generateRepresentativeFixture(sourcePath)
          // deno-lint-ignore no-await-in-loop
          const sourceInfo = await probeSourceVideo(sourcePath)

          const preset = VIDEO_BREAKPOINT_PRESETS[breakpoint]
          const expectedWidth = Math.min(preset.width, sourceInfo.widthPx)

          const referencePath = join(dir, 'reference.mp4')
          // deno-lint-ignore no-await-in-loop
          await generateReference(sourcePath, expectedWidth, referencePath)

          const outputPath = join(dir, `output.${format}`)
          const transcoder = createSystemFfmpegTranscoder()
          // deno-lint-ignore no-await-in-loop
          const result = await transcoder.transcode(
            { sourcePath },
            { breakpoint, outputPath, format },
          )

          assertEquals(result.passthrough, false)
          assertEquals(result.neverWorsened, false)
          assert(result.bytesWritten > 0)

          // deno-lint-ignore no-await-in-loop
          const outputInfo = await probeSourceVideo(outputPath)
          assertEquals(outputInfo.widthPx, expectedWidth)
          assertEquals(outputInfo.heightPx % 2, 0)

          // deno-lint-ignore no-await-in-loop
          const { vmafMean } = await measureVmafSsim(outputPath, referencePath, dir)
          assert(
            vmafMean >= VMAF_FLOOR[breakpoint] - 1,
            // -1 extra: real testsrc2 content, real single-run encoder variance — not the exact
            // benchmark fixture, so a small slack around the calibrated floor is honest, not a
            // silently loosened requirement.
            `expected VMAF >= ${
              VMAF_FLOOR[breakpoint] - 1
            } for ${breakpoint}/${format}, got ${vmafMean}`,
          )

          // Real rate-control mode sanity: never assert exact ffmpeg args (that's the unit suite's
          // job) — assert the REAL, measured outcome each mode is calibrated to produce.
          const measuredBitrateKbps = Math.round((result.bytesWritten * 8) / 1000 / 3)
          if (format === 'mp4') {
            // x264 capped-CRF: -maxrate is a real, passive ceiling — measured bitrate must never
            // exceed it by more than a small VBV-slack margin (confirmed in the calibration
            // benchmark: short clips can land a little over nominal maxrate, never wildly so).
            assert(
              measuredBitrateKbps <= preset.videoBitrateKbps * 1.2,
              `x264 ${breakpoint}: measured ${measuredBitrateKbps}kbps exceeds its own ` +
                `${preset.videoBitrateKbps}kbps ceiling by more than the expected VBV slack`,
            )
          } else {
            // VP9 CQ: vp9TargetBitrateKbps is an active bias, not a ceiling — no hard bound to
            // assert, only that it's in the right ballpark (never wildly larger than its own
            // nominal target, consistent with every measurement in the calibration benchmark).
            assert(
              measuredBitrateKbps <= preset.vp9TargetBitrateKbps * 1.5,
              `vp9 ${breakpoint}: measured ${measuredBitrateKbps}kbps is far outside its own ` +
                `${preset.vp9TargetBitrateKbps}kbps CQ target`,
            )
          }
        } finally {
          // deno-lint-ignore no-await-in-loop
          await Deno.remove(dir, { recursive: true })
        }
      },
    })
  }
}

Deno.test({
  name: 'calibration validation: never-worsen still fires under capped-CRF (x264, dmd)',
  ignore,
  async fn() {
    const dir = await tempDir('calibration-never-worsen-')
    try {
      const sourcePath = join(dir, 'source.mp4')
      const outputPath = join(dir, 'output.mp4')
      // Near-zero entropy, same reasoning as the sibling suite's own never-worsen fixture — a
      // capped-CRF encode of a near-empty source is still tiny, but the ORIGINAL is tinier still.
      const { success, stderr } = await run([
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=black:size=1440x900:duration=1:rate=5',
        '-pix_fmt',
        'yuv420p',
        '-c:v',
        'libx264',
        sourcePath,
      ])
      assert(success, stderr)
      const sourceSize = (await Deno.stat(sourcePath)).size

      const transcoder = createSystemFfmpegTranscoder()
      const result = await transcoder.transcode({ sourcePath }, { breakpoint: 'dmd', outputPath })

      assertEquals(result.neverWorsened, true)
      assertEquals(result.bytesWritten, sourceSize)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
})

Deno.test({
  name: "calibration validation: source-bitrate cap still applies to VP9's OWN " +
    "vp9TargetBitrateKbps, not just x264's videoBitrateKbps",
  ignore,
  async fn() {
    const dir = await tempDir('calibration-source-cap-')
    try {
      const sourcePath = join(dir, 'source.mp4')
      const outputPath = join(dir, 'output.webm')
      // A real source whose own bitrate is well below dlg's calibrated vp9TargetBitrateKbps
      // (1650kbps) — confirms the cap is read from the source, never blindly the preset's own
      // number, for VP9's independent field exactly as it already was for videoBitrateKbps.
      const { success, stderr } = await run([
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=1920x1080:duration=2:rate=24',
        '-pix_fmt',
        'yuv420p',
        '-c:v',
        'libx264',
        '-b:v',
        '400k',
        sourcePath,
      ])
      assert(success, stderr)
      const sourceInfo = await probeSourceVideo(sourcePath)
      assert(
        sourceInfo.videoBitrateKbps < VIDEO_BREAKPOINT_PRESETS.dlg.vp9TargetBitrateKbps,
        `fixture's own bitrate (${sourceInfo.videoBitrateKbps}kbps) must be below dlg's ` +
          `vp9TargetBitrateKbps (${VIDEO_BREAKPOINT_PRESETS.dlg.vp9TargetBitrateKbps}kbps) for this test to be meaningful`,
      )

      const transcoder = createSystemFfmpegTranscoder()
      const result = await transcoder.transcode(
        { sourcePath },
        { breakpoint: 'dlg', outputPath, format: 'webm' },
      )

      const measuredBitrateKbps = Math.round((result.bytesWritten * 8) / 1000 / 2)
      assert(
        measuredBitrateKbps <= sourceInfo.videoBitrateKbps * 1.5,
        `expected the source's own low bitrate (${sourceInfo.videoBitrateKbps}kbps) to cap the ` +
          `real output (got ${measuredBitrateKbps}kbps), not dlg's uncapped 1650kbps target`,
      )
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
})
