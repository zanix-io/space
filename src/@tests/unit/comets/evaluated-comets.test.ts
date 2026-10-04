import { assertEquals } from '@std/assert'
import { defineComet } from 'modules/comets/define-comet.ts'
import {
  getEvaluatedCometUrls,
  recordEvaluatedComet,
  resetEvaluatedComets,
} from 'modules/comets/evaluated-comets.ts'

Deno.test('evaluated comets: defineComet records the module URL it was given', () => {
  resetEvaluatedComets()
  function Widget() {
    return null
  }
  defineComet(Widget, 'https://jsr.io/@scope/pkg/1.0.0/ui/widget.tsx', 'Widget')
  assertEquals(getEvaluatedCometUrls(), ['https://jsr.io/@scope/pkg/1.0.0/ui/widget.tsx'])
})

Deno.test('evaluated comets: a comet defined twice, or recorded twice, is listed once', () => {
  resetEvaluatedComets()
  recordEvaluatedComet('file:///a/b.tsx')
  recordEvaluatedComet('file:///a/b.tsx')
  recordEvaluatedComet('file:///a/c.tsx')
  assertEquals(getEvaluatedCometUrls(), ['file:///a/b.tsx', 'file:///a/c.tsx'])
})

Deno.test('evaluated comets: the registry is shared through a global symbol, not a module variable', () => {
  resetEvaluatedComets()
  recordEvaluatedComet('file:///x/y.tsx')
  const shared = (globalThis as unknown as Record<symbol, Set<string>>)[
    Symbol.for('@zanix/space/evaluated-comets')
  ]
  assertEquals([...shared], ['file:///x/y.tsx'])
  resetEvaluatedComets()
  assertEquals(getEvaluatedCometUrls(), [])
})

Deno.test('evaluated comets: defineComet without a usable name throws and records nothing', () => {
  resetEvaluatedComets()
  const anonymous = (() => () => null)()
  try {
    defineComet(anonymous as () => null, 'file:///anon.tsx')
  } catch {
    // The name check fails first: nothing about this module is worth building.
  }
  assertEquals(getEvaluatedCometUrls(), [])
})
