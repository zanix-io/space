import { assert, assertEquals, assertFalse } from '@std/assert'
import logger from '@zanix/logger'
// Imported through the Preact client barrel (not the module directly) so this test also exercises
// `mod-preact.ts` — both were entirely invisible in coverage before this file existed, since
// nothing imported either one. Same renderer-agnostic marker protocol as `hydrate-comets.ts`'s own
// React counterpart; see that file's test for the full "why fakes, not a DOM-shim" rationale.
import { hydrateComets } from 'modules/client/mod-preact.ts'
import {
  COMET_EXPORT_ATTR,
  COMET_MEDIA_ATTR,
  COMET_MODULE_ATTR,
  COMET_PERSIST_ATTR,
  COMET_PROPS_ATTR,
  COMET_REUSED_ATTR,
  COMET_STRATEGY_ATTR,
} from 'modules/comets/marker.ts'

console.error = () => {}

// The dynamic `import()` + Preact `hydrate`/`render` mount itself (everything past the module
// import) is NOT exercised here — genuinely out of scope, requiring a real DOM/browser, per this
// project's own established no-DOM-shim precedent (see `comet-persistence.test.ts` /
// `orbit.test.ts`). Only `hydrateComets`' own pre-mount control flow is covered below.

function fakeBoundary(
  attrs: Record<string, string> = {},
  reused = false,
): HTMLElement & { calls: string[] } {
  const attributes = new Map(Object.entries(attrs))
  let isReused = reused
  const calls: string[] = []
  const boundary = {
    calls,
    hasAttribute(name: string): boolean {
      calls.push(`has:${name}`)
      return name === COMET_REUSED_ATTR ? isReused : attributes.has(name)
    },
    getAttribute(name: string): string | null {
      calls.push(`get:${name}`)
      return attributes.get(name) ?? null
    },
    removeAttribute(name: string): void {
      calls.push(`remove:${name}`)
      if (name === COMET_REUSED_ATTR) isReused = false
    },
  }
  return boundary as unknown as HTMLElement & { calls: string[] }
}

function fakeRoot(boundaries: HTMLElement[]): ParentNode {
  return { querySelectorAll: () => boundaries } as unknown as ParentNode
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function countErrors(): { count: () => number; restore: () => void } {
  const original = logger.error
  let calls = 0
  logger.error = ((...args: unknown[]) => {
    calls++
    return original.apply(logger, args as never)
  }) as typeof original
  return { count: () => calls, restore: () => (logger.error = original) }
}

Deno.test(
  'hydrateComets (preact): a boundary already marked reused is skipped, and the marker is cleared',
  () => {
    const boundary = fakeBoundary({}, true)
    hydrateComets(fakeRoot([boundary]))

    assert(boundary.calls.includes(`has:${COMET_REUSED_ATTR}`))
    assert(boundary.calls.includes(`remove:${COMET_REUSED_ATTR}`))
    assertFalse(
      boundary.calls.includes(`get:${COMET_STRATEGY_ATTR}`),
      'a reused boundary must never even reach the strategy check',
    )
  },
)

Deno.test(
  "hydrateComets (preact): strategy 'none' is skipped without ever reading the media attribute",
  () => {
    const boundary = fakeBoundary({ [COMET_STRATEGY_ATTR]: 'none' })
    hydrateComets(fakeRoot([boundary]))

    assert(boundary.calls.includes(`get:${COMET_STRATEGY_ATTR}`))
    assertFalse(boundary.calls.includes(`get:${COMET_MEDIA_ATTR}`))
  },
)

Deno.test(
  "hydrateComets (preact): no strategy attribute defaults to 'load', hydrates immediately, and " +
    "reaches hydrateBoundary's own early return when there is no module URL",
  () => {
    const boundary = fakeBoundary({})
    hydrateComets(fakeRoot([boundary]))

    assert(boundary.calls.includes(`get:${COMET_MEDIA_ATTR}`), 'strategy was not "none"')
    assert(boundary.calls.includes(`get:${COMET_MODULE_ATTR}`))
  },
)

Deno.test(
  'hydrateComets (preact): a module URL reaches hydrateBoundary; a failed dynamic import is ' +
    'caught and logged, never thrown',
  async () => {
    const boundary = fakeBoundary({
      [COMET_STRATEGY_ATTR]: 'load',
      [COMET_MODULE_ATTR]: './__nonexistent-comet-module-for-tests-preact__.ts',
      [COMET_EXPORT_ATTR]: 'Named',
      [COMET_MEDIA_ATTR]: '(min-width: 1px)',
    })
    const errors = countErrors()
    try {
      hydrateComets(fakeRoot([boundary]))

      assert(boundary.calls.includes(`get:${COMET_MODULE_ATTR}`))
      assert(boundary.calls.includes(`get:${COMET_EXPORT_ATTR}`))
      assert(boundary.calls.includes(`get:${COMET_PROPS_ATTR}`))
      assert(boundary.calls.includes(`get:${COMET_PERSIST_ATTR}`))

      await sleep(200)
      assertEquals(errors.count(), 1)
    } finally {
      errors.restore()
    }
  },
)

Deno.test(
  'hydrateComets (preact): hydrateBoundary falls back to "load"/"default" when neither its own ' +
    'strategy nor export attribute is set',
  async () => {
    const boundary = fakeBoundary({
      [COMET_MODULE_ATTR]: './__another-nonexistent-comet-module-preact__.ts',
      [COMET_PROPS_ATTR]: '{"count":1}',
      [COMET_PERSIST_ATTR]: 'widget-1',
    })
    const errors = countErrors()
    try {
      hydrateComets(fakeRoot([boundary]))

      assert(boundary.calls.includes(`get:${COMET_STRATEGY_ATTR}`))
      assert(boundary.calls.includes(`get:${COMET_EXPORT_ATTR}`))
      assert(boundary.calls.includes(`get:${COMET_PROPS_ATTR}`))
      assert(boundary.calls.includes(`get:${COMET_PERSIST_ATTR}`))

      await sleep(200)
      assertEquals(errors.count(), 1)
    } finally {
      errors.restore()
    }
  },
)

Deno.test(
  'hydrateComets (preact): multiple boundaries under root are each visited independently',
  () => {
    const reusedBoundary = fakeBoundary({}, true)
    const skippedBoundary = fakeBoundary({ [COMET_STRATEGY_ATTR]: 'none' })
    hydrateComets(fakeRoot([reusedBoundary, skippedBoundary]))

    assert(reusedBoundary.calls.includes(`remove:${COMET_REUSED_ATTR}`))
    assert(skippedBoundary.calls.includes(`get:${COMET_STRATEGY_ATTR}`))
    assertFalse(skippedBoundary.calls.includes(`remove:${COMET_REUSED_ATTR}`))
  },
)
