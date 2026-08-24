import { assertEquals, assertThrows } from '@std/assert'
import {
  MAX_AUDIO_BITRATE_KBPS,
  resolveVideoBreakpoint,
  VIDEO_BREAKPOINT_PRESETS,
} from 'modules/media/video-breakpoints.ts'

Deno.test(
  'VIDEO_BREAKPOINT_PRESETS: the four presets, legacy width/bitrate + calibrated crf/CQ values',
  () => {
    assertEquals(VIDEO_BREAKPOINT_PRESETS, {
      msm: {
        width: 720,
        videoBitrateKbps: 1000,
        x264Crf: 23,
        vp9Crf: 30,
        vp9TargetBitrateKbps: 1000,
      },
      mlg: {
        width: 720,
        videoBitrateKbps: 1500,
        x264Crf: 23,
        vp9Crf: 30,
        vp9TargetBitrateKbps: 1500,
      },
      dmd: {
        width: 1440,
        videoBitrateKbps: 2000,
        x264Crf: 26,
        vp9Crf: 30,
        vp9TargetBitrateKbps: 1000,
      },
      dlg: {
        width: 1920,
        videoBitrateKbps: 3000,
        x264Crf: 28,
        vp9Crf: 30,
        vp9TargetBitrateKbps: 1650,
      },
    })
  },
)

Deno.test(
  "VIDEO_BREAKPOINT_PRESETS: VP9's own bitrate is deliberately independent of x264's ceiling " +
    'at dmd/dlg (never the same field/value reused with a different meaning)',
  () => {
    assertEquals(
      VIDEO_BREAKPOINT_PRESETS.dmd.vp9TargetBitrateKbps ===
        VIDEO_BREAKPOINT_PRESETS.dmd.videoBitrateKbps,
      false,
    )
    assertEquals(
      VIDEO_BREAKPOINT_PRESETS.dlg.vp9TargetBitrateKbps ===
        VIDEO_BREAKPOINT_PRESETS.dlg.videoBitrateKbps,
      false,
    )
  },
)

Deno.test('MAX_AUDIO_BITRATE_KBPS: the legacy audio ceiling, applied regardless of preset', () => {
  assertEquals(MAX_AUDIO_BITRATE_KBPS, 128)
})

Deno.test('resolveVideoBreakpoint: msm resolves to its own real width/bitrate/crf values', () => {
  assertEquals(resolveVideoBreakpoint('msm'), {
    name: 'msm',
    width: 720,
    videoBitrateKbps: 1000,
    x264Crf: 23,
    vp9Crf: 30,
    vp9TargetBitrateKbps: 1000,
  })
})

Deno.test(
  "resolveVideoBreakpoint: mlg shares msm's width — a real legacy oddity, not a bug",
  () => {
    const msm = resolveVideoBreakpoint('msm')
    const mlg = resolveVideoBreakpoint('mlg')
    assertEquals(msm.width, mlg.width)
    assertEquals(msm.videoBitrateKbps === mlg.videoBitrateKbps, false)
  },
)

Deno.test(
  'resolveVideoBreakpoint: dmd and dlg resolve to their own real width/bitrate/crf values',
  () => {
    assertEquals(resolveVideoBreakpoint('dmd'), {
      name: 'dmd',
      width: 1440,
      videoBitrateKbps: 2000,
      x264Crf: 26,
      vp9Crf: 30,
      vp9TargetBitrateKbps: 1000,
    })
    assertEquals(resolveVideoBreakpoint('dlg'), {
      name: 'dlg',
      width: 1920,
      videoBitrateKbps: 3000,
      x264Crf: 28,
      vp9Crf: 30,
      vp9TargetBitrateKbps: 1650,
    })
  },
)

Deno.test('resolveVideoBreakpoint: width override applies, the rest falls back to preset', () => {
  const resolved = resolveVideoBreakpoint('msm', { width: 640 })
  assertEquals(resolved, {
    name: 'msm',
    width: 640,
    videoBitrateKbps: 1000,
    x264Crf: 23,
    vp9Crf: 30,
    vp9TargetBitrateKbps: 1000,
  })
})

Deno.test('resolveVideoBreakpoint: bitrate override applies, the rest falls back to preset', () => {
  const resolved = resolveVideoBreakpoint('dlg', { videoBitrateKbps: 4000 })
  assertEquals(resolved, {
    name: 'dlg',
    width: 1920,
    videoBitrateKbps: 4000,
    x264Crf: 28,
    vp9Crf: 30,
    vp9TargetBitrateKbps: 1650,
  })
})

Deno.test('resolveVideoBreakpoint: both width and bitrate can be overridden together', () => {
  const resolved = resolveVideoBreakpoint('mlg', { width: 800, videoBitrateKbps: 1800 })
  assertEquals(resolved, {
    name: 'mlg',
    width: 800,
    videoBitrateKbps: 1800,
    x264Crf: 23,
    vp9Crf: 30,
    vp9TargetBitrateKbps: 1500,
  })
})

Deno.test(
  'resolveVideoBreakpoint: x264Crf/vp9Crf/vp9TargetBitrateKbps can each be overridden independently',
  () => {
    const resolved = resolveVideoBreakpoint('dmd', {
      x264Crf: 24,
      vp9Crf: 32,
      vp9TargetBitrateKbps: 1200,
    })
    assertEquals(resolved, {
      name: 'dmd',
      width: 1440,
      videoBitrateKbps: 2000,
      x264Crf: 24,
      vp9Crf: 32,
      vp9TargetBitrateKbps: 1200,
    })
  },
)

Deno.test('resolveVideoBreakpoint: an unrecognized preset name throws TypeError', () => {
  // @ts-expect-error — deliberately an invalid name to exercise the runtime check
  assertThrows(() => resolveVideoBreakpoint('xlg'), TypeError, 'Unknown video breakpoint preset')
})
