import { assert, assertEquals, assertFalse } from '@std/assert'
import { resetDom } from './dom-test-setup.ts'
import logger from 'modules/client/client-logger.ts'
// Imported through the Preact client barrel (not the module directly) so this test also exercises
// `mod-preact.ts` — both were entirely invisible in coverage before this file existed, since
// nothing imported either one. Same renderer-agnostic marker protocol as `hydrate-comets.ts`'s own
// React counterpart; see that file's test for the full "why fakes, not a DOM-shim" rationale.
import { hydrateComets } from 'modules/client/mod-preact.ts'
import {
  detachPersistedComets,
  disposeOutletComets,
  reuseRetainedComets,
} from 'modules/client/comet-persistence.ts'
import {
  COMET_EXPORT_ATTR,
  COMET_ID_ATTR,
  COMET_MEDIA_ATTR,
  COMET_MODULE_ATTR,
  COMET_PERSIST_ATTR,
  COMET_PROPS_ATTR,
  COMET_REUSED_ATTR,
  COMET_STRATEGY_ATTR,
} from 'modules/comets/marker.ts'

console.error = () => {}

// `hydrateComets`' own pre-mount control flow (below, through `fakeBoundary`) needs no real DOM at
// all — a plain object tracking which attributes get read is enough. The dynamic `import()` +
// Preact `hydrate`/`render` mount itself is a DIFFERENT matter — this project DOES have a real-DOM
// precedent for exactly that class of problem (`dom-test-setup.ts`'s own `happy-dom` document,
// already used by `orbit-navigation.test.ts`/`ensure-stylesheets-loaded.test.ts`), so the
// "real import succeeds" cases further down use it directly: real `document.createElement`
// boundaries, a real fixture module (`fixtures/hydrate-widget-preact.ts`) dynamically imported by
// its own real `file://` URL, and Preact's real `hydrate`/`render` mounting into them.

function fakeBoundary(
  attrs: Record<string, string> = {},
  reused = false,
  nestedInsideAnotherComet = false,
): HTMLElement & { calls: string[] } {
  const attributes = new Map(Object.entries(attrs))
  let isReused = reused
  const calls: string[] = []
  const boundary = {
    calls,
    // `isNestedComet` (`nested-comet-guard.ts`) reads this, never `boundary` itself — matches its
    // own doc: it walks up from the PARENT, so a boundary is never mistaken for its own ancestor.
    parentElement: {
      closest: (selector: string) => {
        calls.push(`closest:${selector}`)
        return nestedInsideAnotherComet ? {} : null
      },
    },
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

/** Polls instead of a fixed `sleep`: the dynamic import plus the render can exceed a fixed delay
 * when the full suite runs under load. */
async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  // deno-lint-ignore no-await-in-loop
  while (!condition() && Date.now() < deadline) await sleep(10)
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
  'hydrateComets (preact): a boundary nested inside ANOTHER Comet boundary is skipped entirely ' +
    "— the outer boundary's own hydration already reaches it transitively; a second, " +
    'independent hydrate() call here is a real, reproduced conflict (see nested-comet-guard.ts)',
  () => {
    const boundary = fakeBoundary({}, false, true)
    hydrateComets(fakeRoot([boundary]))

    assert(boundary.calls.includes(`closest:[${COMET_ID_ATTR}]`))
    assertFalse(
      boundary.calls.includes(`get:${COMET_STRATEGY_ATTR}`),
      'a nested boundary must never even reach the strategy check',
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
    })
    const errors = countErrors()
    try {
      hydrateComets(fakeRoot([boundary]))

      assert(boundary.calls.includes(`get:${COMET_STRATEGY_ATTR}`))
      assert(boundary.calls.includes(`get:${COMET_EXPORT_ATTR}`))
      assert(boundary.calls.includes(`get:${COMET_PROPS_ATTR}`))

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

// -- Real import/mount cases (real DOM, real dynamic import, real Preact) -----------------------

const fixtureModuleUrl = new URL('./fixtures/hydrate-widget-preact.ts', import.meta.url).href

Deno.test(
  'hydrateBoundary (real import): default strategy hydrates real SSR markup with the default export',
  async () => {
    resetDom()
    const boundary = document.createElement('div')
    boundary.setAttribute(COMET_MODULE_ATTR, fixtureModuleUrl)
    boundary.setAttribute(COMET_PROPS_ATTR, '{"label":"x"}')
    boundary.innerHTML = '<span class="widget">widget:server</span>'
    document.body.appendChild(boundary)

    hydrateComets(fakeRoot([boundary]))
    await waitFor(() => boundary.innerHTML.includes('widget:x'))

    assert(boundary.innerHTML.includes('widget:x'), boundary.innerHTML)
  },
)

Deno.test(
  "hydrateBoundary (real import): strategy 'only' mounts with render(), not hydrate()",
  async () => {
    resetDom()
    const boundary = document.createElement('div')
    boundary.setAttribute(COMET_MODULE_ATTR, fixtureModuleUrl)
    boundary.setAttribute(COMET_STRATEGY_ATTR, 'only')
    document.body.appendChild(boundary)

    hydrateComets(fakeRoot([boundary]))
    await waitFor(() => boundary.innerHTML.includes('widget:'))

    assert(boundary.innerHTML.includes('widget:'), boundary.innerHTML)
  },
)

Deno.test(
  'hydrateBoundary (real import): an explicit export name resolves that named export, not the default',
  async () => {
    resetDom()
    const boundary = document.createElement('div')
    boundary.setAttribute(COMET_MODULE_ATTR, fixtureModuleUrl)
    boundary.setAttribute(COMET_EXPORT_ATTR, 'Named')
    boundary.setAttribute(COMET_PROPS_ATTR, '{"label":"y"}')
    document.body.appendChild(boundary)

    hydrateComets(fakeRoot([boundary]))
    await waitFor(() => boundary.innerHTML.includes('named:y'))

    assert(boundary.innerHTML.includes('named:y'), boundary.innerHTML)
  },
)

const nestedCometFixtureUrl = new URL(
  './fixtures/hydrate-widget-nested-comet-preact.ts',
  import.meta.url,
).href

Deno.test(
  "hydrateBoundary (real import): a Comet nested inside the mounted Comet's own render tree " +
    "hydrates too — the real, confirmed regression this closes: this file's own module-load " +
    'registration (`setActiveRenderer`/`setCometElementFactory`/`setCometIdScopeProvider` in ' +
    'hydrate-comets-preact.ts) is the ONLY renderer registration this test ever triggers — no ' +
    'SSR entry point (`mod-preact.ts`) is imported anywhere in this file — so a pass here means ' +
    "the CLIENT bundle alone, exactly as a real app's own client-entry.ts ships it, is enough " +
    "for a nested Comet (defineComet used directly inside another Comet's own JSX, the same " +
    'shape `ProductImage` inside a wishlist card composes) to render without the ' +
    '`InternalError: no react element factory is registered` crash that used to fire ' +
    'unconditionally, every time, before this file registered anything at all.',
  async () => {
    resetDom()
    const boundary = document.createElement('div')
    boundary.setAttribute(COMET_MODULE_ATTR, nestedCometFixtureUrl)
    boundary.setAttribute(COMET_STRATEGY_ATTR, 'only')
    boundary.setAttribute(COMET_PROPS_ATTR, '{"label":"z"}')
    document.body.appendChild(boundary)

    const errors = countErrors()
    try {
      hydrateComets(fakeRoot([boundary]))
      await waitFor(() => boundary.innerHTML.includes('inner:z'))

      assertEquals(errors.count(), 0, 'the nested Comet must not have thrown/logged anything')
      assert(boundary.innerHTML.includes('outer:z'), boundary.innerHTML)
      assert(
        boundary.innerHTML.includes('inner:z'),
        'the NESTED Comet must have rendered its own real content, not silently nothing — ' +
          boundary.innerHTML,
      )
    } finally {
      errors.restore()
    }
  },
)

Deno.test(
  'hydrateBoundary (real import): a persist-tagged boundary registers a real reuse/dispose ' +
    "handle — exercised through comet-persistence's own real consumption paths, never called " +
    'directly (neither is exported for that)',
  async () => {
    resetDom()
    const outlet = document.createElement('div')
    document.body.appendChild(outlet)

    // Two boundaries sharing the SAME persist key: `detachPersistedComets` retains the first one
    // and disposes every later duplicate — the real, only way `dispose` (below) ever runs.
    const boundary1 = document.createElement('div')
    boundary1.setAttribute(COMET_MODULE_ATTR, fixtureModuleUrl)
    boundary1.setAttribute(COMET_PERSIST_ATTR, 'widget-1')
    boundary1.setAttribute(COMET_PROPS_ATTR, '{"label":"a"}')
    outlet.appendChild(boundary1)

    const boundary2 = document.createElement('div')
    boundary2.setAttribute(COMET_MODULE_ATTR, fixtureModuleUrl)
    boundary2.setAttribute(COMET_PERSIST_ATTR, 'widget-1')
    boundary2.setAttribute(COMET_PROPS_ATTR, '{"label":"b"}')
    outlet.appendChild(boundary2)

    hydrateComets(fakeRoot([boundary1, boundary2]))
    await waitFor(() => boundary2.innerHTML !== '' && boundary1.innerHTML !== '')

    detachPersistedComets(outlet)
    assertEquals(
      boundary2.innerHTML,
      '',
      "the duplicate's own dispose() (render(null, boundary)) must have unmounted it for real",
    )
    assertFalse(outlet.contains(boundary1), 'the first, non-duplicate instance is retained')

    // `reuseRetainedComets` is the real, only way `reuse` (below) ever runs: a fresh placeholder
    // for the SAME key/module/export, in a fragment not yet attached anywhere.
    const container = document.createElement('div')
    const placeholder = document.createElement('div')
    placeholder.setAttribute(COMET_MODULE_ATTR, fixtureModuleUrl)
    placeholder.setAttribute(COMET_PERSIST_ATTR, 'widget-1')
    placeholder.setAttribute(COMET_PROPS_ATTR, '{"label":"reused"}')
    container.appendChild(placeholder)

    reuseRetainedComets(container)

    assert(
      boundary1.innerHTML.includes('widget:reused'),
      "reuse()'s own render(createElement(Component, nextProps), boundary) must have re-rendered " +
        `the retained node with its fresh props — got: ${boundary1.innerHTML}`,
    )
    assert(container.contains(boundary1), 'the retained node must replace the placeholder')
  },
)

Deno.test(
  'hydrateBoundary (real import): a boundary WITHOUT persist still registers a real dispose ' +
    "handle — exercised through disposeOutletComets, the real fix for Orbit's replaceChildren " +
    "never unmounting a Comet's own root",
  async () => {
    resetDom()
    const outlet = document.createElement('div')
    document.body.appendChild(outlet)

    const boundary = document.createElement('div')
    boundary.setAttribute(COMET_ID_ATTR, 'plain-1')
    boundary.setAttribute(COMET_MODULE_ATTR, fixtureModuleUrl)
    boundary.setAttribute(COMET_PROPS_ATTR, '{"label":"plain"}')
    outlet.appendChild(boundary)

    hydrateComets(fakeRoot([boundary]))
    await waitFor(() => boundary.innerHTML.includes('widget:plain'))
    assert(boundary.innerHTML.includes('widget:plain'), `not mounted: ${boundary.innerHTML}`)

    disposeOutletComets(outlet)
    assertEquals(
      boundary.innerHTML,
      '',
      'dispose() (render(null, boundary)) must have unmounted the non-persist boundary for real',
    )
  },
)

Deno.test(
  'hydrateBoundary (real import): a module that does not export what the boundary names logs an ' +
    'error naming the comet and its module and leaves the SSR markup intact — no ' +
    '"[object Object]" text',
  async () => {
    resetDom()
    const moduleUrl = new URL('./fixtures/hydrate-no-export.ts', import.meta.url).href
    const boundary = document.createElement('div')
    boundary.setAttribute(COMET_MODULE_ATTR, moduleUrl)
    boundary.setAttribute(COMET_EXPORT_ATTR, 'SubmitGuard')
    boundary.innerHTML = '<p>server markup</p>'
    document.body.appendChild(boundary)

    const messages: string[] = []
    const original = logger.error
    logger.error = ((...args: unknown[]) => {
      messages.push(String(args[0]))
    }) as typeof original
    try {
      hydrateComets(fakeRoot([boundary]))
      await waitFor(() => messages.length > 0)

      assertEquals(messages.length, 1, messages.join('\n'))
      assert(messages[0].includes('"SubmitGuard"'), messages[0])
      assert(messages[0].includes(moduleUrl), messages[0])
      assertEquals(boundary.innerHTML, '<p>server markup</p>')
      assertFalse(boundary.innerHTML.includes('[object Object]'))
    } finally {
      logger.error = original
    }
  },
)
