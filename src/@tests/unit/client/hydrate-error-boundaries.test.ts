import { assert, assertEquals, assertFalse } from '@std/assert'
import { resetDom } from './dom-test-setup.ts'
import logger from 'modules/client/client-logger.ts'
import { hydrateErrorBoundaries } from 'modules/client/hydrate-error-boundaries.ts'
import {
  ERROR_BOUNDARY_MODULE_ATTR,
  ERROR_BOUNDARY_PARAMS_ATTR,
} from 'modules/router/error-boundary-marker.ts'

console.error = () => {}

/**
 * `dom-test-setup.ts` deliberately bridges only `document`/`Event` — the narrowest surface its own
 * existing consumers (`ensureStylesheetsLoaded`, Preact's `hydrate`/`render`) ever touch (see that
 * module's own doc). React DOM's `createRoot(...).render()` needs one more: a global `window`
 * (confirmed empirically — without it, `resolveUpdatePriority` throws a raw `ReferenceError: window
 * is not defined` the instant `.render()` is called). Bridged here, not in the shared file, for the
 * same reason `orbit-navigation.test.ts` bridges its OWN extra surface (`Element`, `MouseEvent`,
 * ...) locally rather than growing the shared minimum every consumer pays for — and called from
 * INSIDE each test body, never at this module's own top level, for the exact reason
 * `orbit-navigation.test.ts`'s own `bridgeGlobals` doc gives: `deno test`'s collection pass can
 * evaluate a test file's top-level code before `dom-test-setup.ts`'s side effect has landed on
 * `globalThis` yet, a real, confirmed failure mode in this exact test environment.
 */
function bridgeWindow(): void {
  // deno-lint-ignore no-explicit-any
  const globals = globalThis as any
  globals.window = globals.document.defaultView
}

// Same two-tier split `hydrate-comets-preact.test.ts` already established (see that file's own
// doc): `hydrateErrorBoundaries`' own pre-mount control flow (below, via `fakeBoundary`) needs no
// real DOM — plain fake nodes tracking which attributes get read are enough, and (crucially) let a
// "no postponed template" boundary be asserted as COMPLETELY untouched (never even reads
// `ERROR_BOUNDARY_MODULE_ATTR`) without needing a real comment/template pair. The dynamic
// `import()` + real `createRoot().render()` mount is a different matter — covered further down with
// `dom-test-setup.ts`'s own real `happy-dom` document and a real fixture module, the same real-DOM
// precedent `hydrate-comets-preact.test.ts` already set for its own renderer.

/** A fake comment node — `nodeType`/`data` are the only two fields `findPostponedTemplate` ever
 * reads off one. `1`/`8` here mirror `hydrate-error-boundaries.ts`'s own literal
 * `ELEMENT_NODE`/`COMMENT_NODE` constants, not a reference to the real DOM `Node` global (undefined
 * in this test environment — see that module's own doc for why it deliberately avoids it too). */
function fakeComment(data: string, nextSibling: unknown = undefined) {
  return { nodeType: 8, data, nextSibling }
}

function fakeTemplate(attrs: Record<string, string> = {}) {
  const attributes = new Map(Object.entries(attrs))
  return {
    nodeType: 1,
    tagName: 'TEMPLATE',
    getAttribute: (name: string) => attributes.get(name) ?? null,
  }
}

function fakeBoundary(
  childNodes: unknown[],
  attrs: Record<string, string> = {},
): HTMLElement & { calls: string[] } {
  const attributes = new Map(Object.entries(attrs))
  const calls: string[] = []
  const boundary = {
    calls,
    childNodes,
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
  'hydrateErrorBoundaries: a boundary with no postponed `$!` comment at all is left completely ' +
    'untouched — the normal, successful-render case never even reads the module attribute',
  () => {
    const boundary = fakeBoundary(['plain text node stand-in'], {
      [ERROR_BOUNDARY_MODULE_ATTR]: '/routes/error.tsx',
    })
    hydrateErrorBoundaries(fakeRoot([boundary]))

    assertFalse(boundary.calls.includes(`get:${ERROR_BOUNDARY_MODULE_ATTR}`))
  },
)

Deno.test(
  'hydrateErrorBoundaries: a `$!` comment with no TEMPLATE as its next sibling is not recognized ' +
    'either — the exact shape must match, not just the presence of the comment',
  () => {
    const boundary = fakeBoundary([fakeComment('$!', undefined)])
    hydrateErrorBoundaries(fakeRoot([boundary]))

    assertFalse(boundary.calls.includes(`get:${ERROR_BOUNDARY_MODULE_ATTR}`))
  },
)

Deno.test(
  'hydrateErrorBoundaries: a real `$!`+TEMPLATE pair with no module attribute on the boundary ' +
    'itself returns without ever attempting a dynamic import',
  () => {
    const template = fakeTemplate({ 'data-msg': 'boom' })
    const boundary = fakeBoundary([fakeComment('$!', template)])
    hydrateErrorBoundaries(fakeRoot([boundary]))

    assert(boundary.calls.includes(`get:${ERROR_BOUNDARY_MODULE_ATTR}`))
    assertFalse(boundary.calls.includes(`get:${ERROR_BOUNDARY_PARAMS_ATTR}`))
  },
)

Deno.test(
  'hydrateErrorBoundaries: a real `$!`+TEMPLATE pair WITH a module attribute reaches the params ' +
    'read; a failed dynamic import is caught and logged, never thrown',
  async () => {
    const template = fakeTemplate({ 'data-msg': 'boom', 'data-stck': 'Error: boom\n  at x' })
    const boundary = fakeBoundary([fakeComment('$!', template)], {
      [ERROR_BOUNDARY_MODULE_ATTR]: './__nonexistent-error-boundary-module-for-tests__.ts',
      [ERROR_BOUNDARY_PARAMS_ATTR]: '{"id":"1"}',
    })
    const errors = countErrors()
    try {
      hydrateErrorBoundaries(fakeRoot([boundary]))

      assert(boundary.calls.includes(`get:${ERROR_BOUNDARY_MODULE_ATTR}`))
      assert(boundary.calls.includes(`get:${ERROR_BOUNDARY_PARAMS_ATTR}`))

      await sleep(200)
      assertEquals(errors.count(), 1)
    } finally {
      errors.restore()
    }
  },
)

Deno.test(
  'hydrateErrorBoundaries: multiple boundaries under root are each visited independently',
  () => {
    const untouched = fakeBoundary([], { [ERROR_BOUNDARY_MODULE_ATTR]: '/routes/error.tsx' })
    const template = fakeTemplate()
    const withMarker = fakeBoundary([fakeComment('$!', template)], {
      [ERROR_BOUNDARY_MODULE_ATTR]: './__another-nonexistent-error-boundary-module__.ts',
    })
    hydrateErrorBoundaries(fakeRoot([untouched, withMarker]))

    assertFalse(untouched.calls.includes(`get:${ERROR_BOUNDARY_MODULE_ATTR}`))
    assert(withMarker.calls.includes(`get:${ERROR_BOUNDARY_MODULE_ATTR}`))
  },
)

// -- Real import/mount cases (real DOM, real dynamic import, real React) -------------------------

const fixtureModuleUrl = new URL('./fixtures/error-fallback.tsx', import.meta.url).href

Deno.test(
  'hydrateErrorBoundaries (real import): mounts the real Fallback with the reconstructed error ' +
    "and params, replacing React's own leftover postponed markup — the DEV-build case, real " +
    'message/stack attributes present',
  async () => {
    resetDom()
    bridgeWindow()
    const boundary = document.createElement('div')
    boundary.setAttribute(ERROR_BOUNDARY_MODULE_ATTR, fixtureModuleUrl)
    boundary.setAttribute(ERROR_BOUNDARY_PARAMS_ATTR, '{"id":"42"}')
    boundary.appendChild(document.createComment('$!'))
    const template = document.createElement('template')
    template.setAttribute('data-msg', 'Switched to client rendering...\n\nboom')
    template.setAttribute('data-stck', 'Switched to client rendering...\n\nError: boom\n  at x')
    boundary.appendChild(template)
    boundary.appendChild(document.createComment('/$'))
    document.body.appendChild(boundary)

    hydrateErrorBoundaries(fakeRoot([boundary]))
    await sleep(150)

    assert(boundary.innerHTML.includes('fallback:boom:'), boundary.innerHTML)
    assert(boundary.innerHTML.includes('"id":"42"'), boundary.innerHTML)
  },
)

Deno.test(
  'hydrateErrorBoundaries (real import): a completely bare `<template></template>` (the ' +
    'PRODUCTION react-dom-server shape — see hydrate-error-boundaries.ts own doc) still mounts ' +
    'the real Fallback, with the generic reconstructed message',
  async () => {
    resetDom()
    bridgeWindow()
    const boundary = document.createElement('div')
    boundary.setAttribute(ERROR_BOUNDARY_MODULE_ATTR, fixtureModuleUrl)
    boundary.setAttribute(ERROR_BOUNDARY_PARAMS_ATTR, '{}')
    boundary.appendChild(document.createComment('$!'))
    boundary.appendChild(document.createElement('template'))
    boundary.appendChild(document.createComment('/$'))
    document.body.appendChild(boundary)

    hydrateErrorBoundaries(fakeRoot([boundary]))
    await sleep(150)

    assert(boundary.innerHTML.includes('fallback:Unknown error:'), boundary.innerHTML)
  },
)

const namedExportFixtureModuleUrl =
  new URL('./fixtures/error-fallback-named-export.tsx', import.meta.url).href

Deno.test(
  'hydrateErrorBoundaries (real import): a module with ONLY a named `DefaultErrorView` export, no ' +
    "`export default` — this package's own built-in fallback's real shape — still mounts, via the " +
    '`module.default ?? module.DefaultErrorView` fallback (real, reproduced regression: this used ' +
    'to silently leave the postponed `<template>` un-mounted, no error logged, nothing visible)',
  async () => {
    resetDom()
    bridgeWindow()
    const boundary = document.createElement('div')
    boundary.setAttribute(ERROR_BOUNDARY_MODULE_ATTR, namedExportFixtureModuleUrl)
    boundary.setAttribute(ERROR_BOUNDARY_PARAMS_ATTR, '{}')
    boundary.appendChild(document.createComment('$!'))
    const template = document.createElement('template')
    template.setAttribute('data-msg', 'Switched to client rendering...\n\npailas')
    boundary.appendChild(template)
    boundary.appendChild(document.createComment('/$'))
    document.body.appendChild(boundary)

    hydrateErrorBoundaries(fakeRoot([boundary]))
    await sleep(150)

    assert(boundary.innerHTML.includes('fallback:pailas:'), boundary.innerHTML)
  },
)

Deno.test(
  'hydrateErrorBoundaries (real import): a boundary whose segment rendered successfully (real ' +
    'content, no `$!` marker) is never touched, even with a real DOM',
  async () => {
    resetDom()
    bridgeWindow()
    const boundary = document.createElement('div')
    boundary.setAttribute(ERROR_BOUNDARY_MODULE_ATTR, fixtureModuleUrl)
    boundary.innerHTML = '<p>real page content</p>'
    document.body.appendChild(boundary)

    hydrateErrorBoundaries(fakeRoot([boundary]))
    await sleep(150)

    assertEquals(boundary.innerHTML, '<p>real page content</p>')
  },
)
