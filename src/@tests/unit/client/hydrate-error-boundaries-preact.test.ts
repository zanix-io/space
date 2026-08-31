import { assert, assertEquals, assertFalse } from '@std/assert'
import { resetDom } from './dom-test-setup.ts'
import logger from 'modules/client/client-logger.ts'
import { hydrateErrorBoundaries } from 'modules/client/hydrate-error-boundaries-preact.ts'
import {
  ERROR_BOUNDARY_MODULE_ATTR,
  ERROR_BOUNDARY_MSG_ATTR,
  ERROR_BOUNDARY_PARAMS_ATTR,
  ERROR_BOUNDARY_STACK_ATTR,
} from 'modules/router/error-boundary-marker.ts'

console.error = () => {}

// Same two-tier split `hydrate-comets-preact.test.ts` already established: control flow via cheap
// fakes, real mount via `dom-test-setup.ts`'s own `happy-dom` document + a real fixture module.
// Much simpler than React's counterpart's own fake shapes — this renderer's marker is either
// present (a segment that genuinely failed) or absent (the normal case), never a structural
// comment/template pair to look for — see `error-boundary-preact.ts`'s own doc for why.

function fakeBoundary(attrs: Record<string, string> = {}): HTMLElement & { calls: string[] } {
  const attributes = new Map(Object.entries(attrs))
  const calls: string[] = []
  const boundary = {
    calls,
    getAttribute(name: string): string | null {
      calls.push(`get:${name}`)
      return attributes.get(name) ?? null
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
  'hydrateErrorBoundaries (preact): a boundary with no module attribute returns immediately, ' +
    'never reading params/msg/stack',
  () => {
    const boundary = fakeBoundary()
    hydrateErrorBoundaries(fakeRoot([boundary]))

    assert(boundary.calls.includes(`get:${ERROR_BOUNDARY_MODULE_ATTR}`))
    assertFalse(boundary.calls.includes(`get:${ERROR_BOUNDARY_PARAMS_ATTR}`))
  },
)

Deno.test(
  'hydrateErrorBoundaries (preact): a module attribute reaches params/msg/stack; a failed ' +
    'dynamic import is caught and logged, never thrown',
  async () => {
    const boundary = fakeBoundary({
      [ERROR_BOUNDARY_MODULE_ATTR]: './__nonexistent-error-boundary-module-preact__.ts',
      [ERROR_BOUNDARY_PARAMS_ATTR]: '{"id":"1"}',
      [ERROR_BOUNDARY_MSG_ATTR]: 'boom',
      [ERROR_BOUNDARY_STACK_ATTR]: 'Error: boom\n  at x',
    })
    const errors = countErrors()
    try {
      hydrateErrorBoundaries(fakeRoot([boundary]))

      assert(boundary.calls.includes(`get:${ERROR_BOUNDARY_PARAMS_ATTR}`))
      assert(boundary.calls.includes(`get:${ERROR_BOUNDARY_MSG_ATTR}`))
      assert(boundary.calls.includes(`get:${ERROR_BOUNDARY_STACK_ATTR}`))

      await sleep(200)
      assertEquals(errors.count(), 1)
    } finally {
      errors.restore()
    }
  },
)

Deno.test(
  'hydrateErrorBoundaries (preact): multiple boundaries under root are each visited independently',
  () => {
    const untouched = fakeBoundary()
    const withMarker = fakeBoundary({
      [ERROR_BOUNDARY_MODULE_ATTR]: './__another-nonexistent-error-boundary-module-preact__.ts',
    })
    hydrateErrorBoundaries(fakeRoot([untouched, withMarker]))

    assertFalse(untouched.calls.includes(`get:${ERROR_BOUNDARY_PARAMS_ATTR}`))
    assert(withMarker.calls.includes(`get:${ERROR_BOUNDARY_PARAMS_ATTR}`))
  },
)

// -- Real import/mount cases (real DOM, real dynamic import, real Preact) -------------------------

const fixtureModuleUrl = new URL('./fixtures/error-fallback-preact.ts', import.meta.url).href

Deno.test(
  'hydrateErrorBoundaries (preact, real import): hydrates the ALREADY-CORRECT SSR markup in ' +
    'place (real `hydrate()`, not a fresh mount) — the reconstructed error/params round-trip into ' +
    'the SAME content the real Fallback renders',
  async () => {
    resetDom()
    const boundary = document.createElement('div')
    boundary.setAttribute(ERROR_BOUNDARY_MODULE_ATTR, fixtureModuleUrl)
    boundary.setAttribute(ERROR_BOUNDARY_PARAMS_ATTR, '{"id":"42"}')
    boundary.setAttribute(ERROR_BOUNDARY_MSG_ATTR, 'boom')
    boundary.setAttribute(ERROR_BOUNDARY_STACK_ATTR, 'Error: boom\n  at x')
    // The exact markup `error-boundary-preact.ts`'s own SSR render already produced for this same
    // Fallback/error/params combination — `hydrate()` reconciles against this, it never replaces it.
    boundary.innerHTML = '<p class="fallback">fallback:boom:{"id":"42"}</p>'
    document.body.appendChild(boundary)

    hydrateErrorBoundaries(fakeRoot([boundary]))
    await sleep(150)

    assert(boundary.innerHTML.includes('fallback:boom:'), boundary.innerHTML)
    assert(boundary.innerHTML.includes('"id":"42"'), boundary.innerHTML)
  },
)

const namedExportFixtureModuleUrl =
  new URL('./fixtures/error-fallback-preact-named-export.ts', import.meta.url).href

Deno.test(
  'hydrateErrorBoundaries (preact, real import): a module with ONLY a named `DefaultErrorView` ' +
    "export, no `export default` — this package's own built-in fallback's real shape — still " +
    'hydrates, via the `module.default ?? module.DefaultErrorView` fallback (same real, ' +
    "reproduced regression as this file's React sibling)",
  async () => {
    resetDom()
    const boundary = document.createElement('div')
    boundary.setAttribute(ERROR_BOUNDARY_MODULE_ATTR, namedExportFixtureModuleUrl)
    boundary.setAttribute(ERROR_BOUNDARY_PARAMS_ATTR, '{}')
    boundary.setAttribute(ERROR_BOUNDARY_MSG_ATTR, 'pailas')
    boundary.innerHTML = '<p class="fallback">fallback:pailas:{}</p>'
    document.body.appendChild(boundary)

    hydrateErrorBoundaries(fakeRoot([boundary]))
    await sleep(150)

    assert(boundary.innerHTML.includes('fallback:pailas:'), boundary.innerHTML)
  },
)

Deno.test(
  'hydrateErrorBoundaries (preact, real import): a boundary with no module attribute at all (a ' +
    'ResolvedSegment built without a real file path) is never touched, even with a real DOM',
  async () => {
    resetDom()
    const boundary = document.createElement('div')
    boundary.innerHTML = '<p>real page content</p>'
    document.body.appendChild(boundary)

    hydrateErrorBoundaries(fakeRoot([boundary]))
    await sleep(150)

    assertEquals(boundary.innerHTML, '<p>real page content</p>')
  },
)
