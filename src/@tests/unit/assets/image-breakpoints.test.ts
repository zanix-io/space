import { assertEquals, assertThrows } from '@std/assert'
import {
  IMAGE_BREAKPOINT_PRESETS,
  resolveImageBreakpoint,
  resolveImageBreakpoints,
} from 'modules/assets/image-breakpoints.ts'

Deno.test(
  'resolveImageBreakpoint: a named preset resolves to its documented legacy width/quality',
  () => {
    assertEquals(resolveImageBreakpoint('msm'), { key: 'msm', width: 360, quality: 85 })
    assertEquals(resolveImageBreakpoint('mlg'), { key: 'mlg', width: 720, quality: 90 })
    assertEquals(resolveImageBreakpoint('dmd'), { key: 'dmd', width: 1440, quality: 95 })
    assertEquals(resolveImageBreakpoint('dlg'), { key: 'dlg', width: 1920, quality: 100 })
    assertEquals(resolveImageBreakpoint('thum'), { key: 'thum', width: 40, quality: 50 })
  },
)

Deno.test(
  'resolveImageBreakpoint: a raw numeric width resolves under a w<width> key, never mistaken ' +
    'for a preset name',
  () => {
    assertEquals(resolveImageBreakpoint(720), { key: 'w720', width: 720, quality: 85 })
    assertEquals(resolveImageBreakpoint(1234), { key: 'w1234', width: 1234, quality: 85 })
  },
)

Deno.test(
  'resolveImageBreakpoint: quality/width overrides apply only to the named preset they target',
  () => {
    const resolved = resolveImageBreakpoint('msm', { quality: { msm: 70 }, width: { mlg: 800 } })
    assertEquals(resolved, { key: 'msm', width: 360, quality: 70 })
  },
)

Deno.test(
  'resolveImageBreakpoint: an unknown preset name throws with the valid preset list',
  () => {
    assertThrows(
      () => resolveImageBreakpoint('xxl' as never),
      TypeError,
      'Unknown image breakpoint preset',
    )
  },
)

Deno.test('resolveImageBreakpoint: a non-positive or non-finite numeric width throws', () => {
  assertThrows(() => resolveImageBreakpoint(0), TypeError, 'Invalid image breakpoint width')
  assertThrows(() => resolveImageBreakpoint(-10), TypeError, 'Invalid image breakpoint width')
  assertThrows(() => resolveImageBreakpoint(NaN), TypeError, 'Invalid image breakpoint width')
  assertThrows(() => resolveImageBreakpoint(Infinity), TypeError, 'Invalid image breakpoint width')
})

Deno.test(
  'resolveImageBreakpoints: a mixed list of named presets and raw widths all resolve ' +
    'independently',
  () => {
    const resolved = resolveImageBreakpoints(['msm', 900, 'dlg'])
    assertEquals(resolved.map((r) => r.key), ['msm', 'w900', 'dlg'])
  },
)

Deno.test('resolveImageBreakpoints: the same literal breakpoint listed twice throws', () => {
  assertThrows(
    () => resolveImageBreakpoints(['msm', 'msm']),
    TypeError,
    'Duplicate image breakpoint',
  )
  assertThrows(() => resolveImageBreakpoints([720, 720]), TypeError, 'Duplicate image breakpoint')
})

Deno.test(
  'resolveImageBreakpoints: a preset and a raw width that resolve to the same pixel width throw',
  () => {
    assertThrows(
      () => resolveImageBreakpoints(['msm', 360]),
      TypeError,
      'both resolve to the same',
    )
  },
)

Deno.test(
  'resolveImageBreakpoints: an override that makes two DIFFERENT presets collide on width ' +
    'also throws',
  () => {
    assertThrows(
      () => resolveImageBreakpoints(['msm', 'mlg'], { width: { mlg: 360 } }),
      TypeError,
      'both resolve to the same',
    )
  },
)

Deno.test('resolveImageBreakpoints: an empty list resolves to an empty array, no error', () => {
  assertEquals(resolveImageBreakpoints([]), [])
})

Deno.test('IMAGE_BREAKPOINT_PRESETS: exposes exactly the five documented legacy presets', () => {
  assertEquals(Object.keys(IMAGE_BREAKPOINT_PRESETS).sort(), ['dlg', 'dmd', 'mlg', 'msm', 'thum'])
})
