import { assert, assertEquals, assertFalse, assertStrictEquals } from '@std/assert'
import {
  COMET_EXPORT_ATTR,
  COMET_MODULE_ATTR,
  COMET_PERSIST_ATTR,
  COMET_PROPS_ATTR,
  COMET_REUSED_ATTR,
} from 'modules/comets/marker.ts'
import {
  detachPersistedComets,
  registerPersistHandle,
  RetainedCometCache,
  reuseRetainedComets,
} from 'modules/client/comet-persistence.ts'

// `RetainedCometCache` is generic over `Node` specifically so its own correctness — insertion,
// eviction order, reuse-or-reject by identity, duplicate-key safety — is fully provable here with
// plain mock objects, no DOM/browser required at all (see that class's own doc).
//
// `detachPersistedComets`/`reuseRetainedComets` themselves ARE covered below too, but still with
// no DOM-shim dependency (this project deliberately has none — see `orbit.test.ts`'s own identical
// note about `ensureStylesheetsLoaded`, and this file's own earlier revision, which left these two
// functions out entirely for that reason): both only ever call `querySelectorAll`/`getAttribute`/
// `setAttribute`/`remove`/`replaceWith` on whatever `ParentNode`/`Element` they're given, so
// `MockElement` below (a plain class, no DOM/browser required) stands in for exactly that surface —
// the same "duck-typed object cast to the real DOM type" pattern `registerPersistHandle`'s own
// test already uses for `boundary`. A real-browser lifecycle test remains out of scope for the
// reason already documented (an intermittent dev-server/browser `import()` race); this covers the
// actual ORCHESTRATION logic (which key wins, when a handle's `dispose`/`reuse` fires, the
// duplicate-key/no-match/no-handle branches) exercised through the module's own real, exported
// functions — never a DOM engine's own rendering/layout behavior, which none of this logic reads.

interface MockNode {
  id: string
}

/** A minimal stand-in for exactly the `Element` surface `detachPersistedComets`/
 * `reuseRetainedComets` call — see this file's own module doc above for why this isn't a DOM shim
 * library. `calls` records what production code does with this node without needing a spy helper
 * per test. */
class MockElement {
  #attrs: Record<string, string>
  public readonly calls: { remove: number; replaceWith: unknown[] } = {
    remove: 0,
    replaceWith: [],
  }

  public constructor(attrs: Record<string, string> = {}) {
    this.#attrs = attrs
  }

  public getAttribute(name: string): string | null {
    return this.#attrs[name] ?? null
  }

  public setAttribute(name: string, value: string): void {
    this.#attrs[name] = value
  }

  public remove(): void {
    this.calls.remove++
  }

  public replaceWith(node: unknown): void {
    this.calls.replaceWith.push(node)
  }
}

/** A `ParentNode` whose `querySelectorAll` returns exactly `elements`, in order — real arrays
 * already have `.forEach`, which is all either function under test ever calls on the result. */
function mockOutlet(elements: MockElement[]): ParentNode {
  return { querySelectorAll: () => elements } as unknown as ParentNode
}

/** `state.disposed`/`state.reused` are read AFTER calling the code under test — never destructured
 * up front, since that would copy the primitive count at spy-creation time instead of reading it
 * live. */
function handleSpy(): {
  handle: { reuse: (p: unknown) => void; dispose: () => void }
  state: { reused: unknown[]; disposed: number }
} {
  const state = { reused: [] as unknown[], disposed: 0 }
  return {
    handle: {
      reuse: (props: unknown) => state.reused.push(props),
      dispose: () => state.disposed++,
    },
    state,
  }
}

function spy(): { fn: () => void; calls: number } {
  const spied = { fn: () => {}, calls: 0 }
  spied.fn = () => {
    spied.calls++
  }
  return spied
}

function entry(
  node: MockNode,
  overrides: Partial<{ moduleUrl: string; exportName: string; dispose: () => void }> = {},
) {
  return {
    moduleUrl: overrides.moduleUrl ?? '/comets/widget.tsx',
    exportName: overrides.exportName ?? 'default',
    node,
    dispose: overrides.dispose ?? (() => {}),
  }
}

Deno.test(
  'registerPersistHandle: stores a handle for a boundary — a plain WeakMap.set with no DOM ' +
    'dependency of its own; the WeakMap key only needs to be an object reference, not a real Element',
  () => {
    const boundary = {} as unknown as Element
    const handle = { reuse: () => {}, dispose: () => {} }
    registerPersistHandle(boundary, handle)
  },
)

Deno.test('RetainedCometCache: set then take with matching identity returns the same node', () => {
  const cache = new RetainedCometCache<MockNode>(5)
  const node = { id: 'a' }
  cache.set('reply-1', entry(node))

  const taken = cache.take('reply-1', '/comets/widget.tsx', 'default')
  assertStrictEquals(taken, node)
})

Deno.test('RetainedCometCache: take on an unknown key returns undefined', () => {
  const cache = new RetainedCometCache<MockNode>(5)
  assertEquals(cache.take('nothing-here', '/comets/widget.tsx', 'default'), undefined)
})

Deno.test(
  'RetainedCometCache: take removes the entry — a second take for the same key fails',
  () => {
    const cache = new RetainedCometCache<MockNode>(5)
    cache.set('reply-1', entry({ id: 'a' }))

    assert(cache.take('reply-1', '/comets/widget.tsx', 'default'))
    assertEquals(cache.take('reply-1', '/comets/widget.tsx', 'default'), undefined)
    assertEquals(cache.size, 0)
  },
)

Deno.test(
  'RetainedCometCache: module URL mismatch is treated as identity change — not reused, disposed instead',
  () => {
    const cache = new RetainedCometCache<MockNode>(5)
    const disposed = spy()
    cache.set('widget', entry({ id: 'a' }, { moduleUrl: '/comets/old.tsx', dispose: disposed.fn }))

    const taken = cache.take('widget', '/comets/new.tsx', 'default')
    assertEquals(taken, undefined)
    assertEquals(disposed.calls, 1)
    assertFalse(cache.has('widget'), 'a stale entry must not linger after a failed take')
  },
)

Deno.test(
  'RetainedCometCache: export name mismatch is ALSO an identity change — not reused, disposed',
  () => {
    const cache = new RetainedCometCache<MockNode>(5)
    const disposed = spy()
    cache.set('widget', entry({ id: 'a' }, { exportName: 'Old', dispose: disposed.fn }))

    const taken = cache.take('widget', '/comets/widget.tsx', 'New')
    assertEquals(taken, undefined)
    assertEquals(disposed.calls, 1)
  },
)

Deno.test('RetainedCometCache: size reflects the current retained count', () => {
  const cache = new RetainedCometCache<MockNode>(5)
  assertEquals(cache.size, 0)
  cache.set('a', entry({ id: 'a' }))
  cache.set('b', entry({ id: 'b' }))
  assertEquals(cache.size, 2)
  cache.take('a', '/comets/widget.tsx', 'default')
  assertEquals(cache.size, 1)
})

Deno.test(
  'RetainedCometCache: LRU eviction — over the cap disposes the OLDEST, not an arbitrary entry',
  () => {
    const cache = new RetainedCometCache<MockNode>(2)
    const disposedA = spy()
    const disposedB = spy()
    const disposedC = spy()
    cache.set('a', entry({ id: 'a' }, { dispose: disposedA.fn }))
    cache.set('b', entry({ id: 'b' }, { dispose: disposedB.fn }))
    cache.set('c', entry({ id: 'c' }, { dispose: disposedC.fn })) // over the cap of 2

    assertEquals(cache.size, 2)
    assertEquals(disposedA.calls, 1, 'the oldest (a) must be evicted+disposed')
    assertEquals(disposedB.calls, 0, 'b is newer than a, must survive')
    assertEquals(disposedC.calls, 0, 'c was just inserted, must survive')
    assertFalse(cache.has('a'))
    assert(cache.has('b'))
    assert(cache.has('c'))
  },
)

Deno.test(
  'RetainedCometCache: re-setting an existing key touches it — protects it from eviction longer',
  () => {
    const cache = new RetainedCometCache<MockNode>(2)
    const disposedA = spy()
    // The SAME node reference both times — matches production exactly: `detachPersistedComets`
    // re-detaches the identical DOM `Element` on a later navigation, never a fresh one.
    const nodeA = { id: 'a' }
    cache.set('a', entry(nodeA, { dispose: disposedA.fn }))
    cache.set('b', entry({ id: 'b' }))
    // touch 'a' again (same shape as a genuine re-detach of an already-retained instance) — this
    // must move it to the MOST recently used position, ahead of 'b'.
    cache.set('a', entry(nodeA, { dispose: disposedA.fn }))
    cache.set('c', entry({ id: 'c' })) // now over the cap — 'b' is the true oldest, not 'a'

    assertEquals(disposedA.calls, 0, 'a was touched most recently and must survive')
    assertFalse(cache.has('b'), 'b, never touched again, is the real oldest and must be evicted')
    assert(cache.has('a'))
    assert(cache.has('c'))
  },
)

Deno.test(
  'RetainedCometCache: two DIFFERENT nodes detached under the same key — the older is disposed immediately, never leaked',
  () => {
    const cache = new RetainedCometCache<MockNode>(5)
    const disposedFirst = spy()
    cache.set('widget', entry({ id: 'first' }, { dispose: disposedFirst.fn }))
    cache.set('widget', entry({ id: 'second' })) // duplicate key, different node — an authoring mistake

    assertEquals(
      disposedFirst.calls,
      1,
      'the replaced entry must be disposed, not silently dropped',
    )
    assertEquals(cache.size, 1)
    const taken = cache.take('widget', '/comets/widget.tsx', 'default')
    assertEquals(taken?.id, 'second', 'only the newer of the two ever remains reachable')
  },
)

Deno.test(
  'RetainedCometCache: re-setting the SAME node under its own key does not dispose it',
  () => {
    const cache = new RetainedCometCache<MockNode>(5)
    const disposed = spy()
    const node = { id: 'a' }
    cache.set('widget', entry(node, { dispose: disposed.fn }))
    cache.set('widget', entry(node, { dispose: disposed.fn })) // same node, e.g. re-touched defensively

    assertEquals(disposed.calls, 0)
    assertStrictEquals(cache.take('widget', '/comets/widget.tsx', 'default'), node)
  },
)

Deno.test('RetainedCometCache: clear() disposes every retained entry and empties the cache', () => {
  const cache = new RetainedCometCache<MockNode>(5)
  const disposedA = spy()
  const disposedB = spy()
  cache.set('a', entry({ id: 'a' }, { dispose: disposedA.fn }))
  cache.set('b', entry({ id: 'b' }, { dispose: disposedB.fn }))

  cache.clear()

  assertEquals(disposedA.calls, 1)
  assertEquals(disposedB.calls, 1)
  assertEquals(cache.size, 0)
})

Deno.test('RetainedCometCache: has() never removes an entry, unlike take()', () => {
  const cache = new RetainedCometCache<MockNode>(5)
  cache.set('a', entry({ id: 'a' }))
  assert(cache.has('a'))
  assert(cache.has('a'), 'checking twice must not consume it')
  assertEquals(cache.size, 1)
})

Deno.test(
  "RetainedCometCache: a negative limit — the constructor's own `number` type never rules it " +
    'out — evicts down to empty and stops there, rather than looping forever once `size > limit` ' +
    "stays true even at size 0. This is the one real edge `set()`'s own `oldestKey === undefined` " +
    'guard exists for: with any non-negative limit, the loop only ever runs while the map is ' +
    'genuinely non-empty, so `.keys().next().value` is never actually `undefined` in practice.',
  () => {
    const cache = new RetainedCometCache<MockNode>(-1)
    const disposed = spy()
    // If the guard were missing, this call would hang the test runner rather than fail an
    // assertion — completing at all IS the proof, same as the concurrency-cap prefetch test's own
    // "never fetched" proof relies on the run finishing rather than a bespoke timeout.
    cache.set('a', entry({ id: 'a' }, { dispose: disposed.fn }))

    assertEquals(cache.size, 0, 'a negative limit evicts everything, including what was just set')
    assertEquals(disposed.calls, 1)
  },
)

// ================================================================================================
// detachPersistedComets / reuseRetainedComets — the module's own real, exported functions, via
// MockElement (see this file's own module doc for why this is not a DOM-shim dependency). Unique
// persist keys per test: `liveCache` is a module-level singleton with no test-only reset, shared
// across every `Deno.test` in this one file/process.
// ================================================================================================

Deno.test(
  'detachPersistedComets: a boundary with no persist key is left in place — never removed',
  () => {
    const boundary = new MockElement()
    detachPersistedComets(mockOutlet([boundary]))
    assertEquals(boundary.calls.remove, 0)
  },
)

Deno.test(
  'detachPersistedComets: a persist-tagged boundary whose lazy strategy never triggered has no ' +
    'registered handle — left in place, same as any other non-persisted boundary',
  () => {
    const boundary = new MockElement({ [COMET_PERSIST_ATTR]: 'never-hydrated' })
    detachPersistedComets(mockOutlet([boundary]))
    assertEquals(boundary.calls.remove, 0)
  },
)

Deno.test(
  'detachPersistedComets + reuseRetainedComets: a registered, persist-tagged boundary is ' +
    'detached, retained, and spliced into a matching placeholder — the real round trip ' +
    "swapOutlet's own two calls perform",
  () => {
    const boundary = new MockElement({
      [COMET_PERSIST_ATTR]: 'round-trip',
      [COMET_MODULE_ATTR]: '/comets/widget.tsx',
      [COMET_EXPORT_ATTR]: 'default',
    })
    const spy = handleSpy()
    registerPersistHandle(boundary as unknown as Element, spy.handle)

    detachPersistedComets(mockOutlet([boundary]))
    assertEquals(boundary.calls.remove, 1, 'a retained boundary is really detached from its outlet')

    const placeholder = new MockElement({
      [COMET_PERSIST_ATTR]: 'round-trip',
      [COMET_MODULE_ATTR]: '/comets/widget.tsx',
      [COMET_EXPORT_ATTR]: 'default',
      [COMET_PROPS_ATTR]: '{"count":2}',
    })
    reuseRetainedComets(mockOutlet([placeholder]))

    assertEquals(
      spy.state.reused,
      [{ count: 2 }],
      "the placeholder's own fresh props reach reuse()",
    )
    assertEquals(boundary.getAttribute(COMET_REUSED_ATTR), '', 'marked so hydrateComets skips it')
    assertEquals(
      placeholder.calls.replaceWith,
      [boundary],
      'the RETAINED node replaces the placeholder',
    )
  },
)

Deno.test(
  'detachPersistedComets: a duplicate persist key in the SAME outlet — only the first is ' +
    "retained, the second's own handle is disposed immediately instead of leaking",
  () => {
    const first = new MockElement({
      [COMET_PERSIST_ATTR]: 'dup-detach',
      [COMET_MODULE_ATTR]: '/comets/widget.tsx',
      [COMET_EXPORT_ATTR]: 'default',
    })
    const second = new MockElement({ [COMET_PERSIST_ATTR]: 'dup-detach' })
    const firstSpy = handleSpy()
    const secondSpy = handleSpy()
    registerPersistHandle(first as unknown as Element, firstSpy.handle)
    registerPersistHandle(second as unknown as Element, secondSpy.handle)

    detachPersistedComets(mockOutlet([first, second]))

    assertEquals(first.calls.remove, 1, 'the first instance under the key is really retained')
    assertEquals(firstSpy.state.disposed, 0)
    assertEquals(second.calls.remove, 0, 'the duplicate is never removed from the DOM by this path')
    assertEquals(secondSpy.state.disposed, 1, "the duplicate's own handle is disposed, not leaked")

    // Confirms the cache genuinely holds the FIRST instance, not the disposed duplicate.
    const placeholder = new MockElement({
      [COMET_PERSIST_ATTR]: 'dup-detach',
      [COMET_MODULE_ATTR]: '/comets/widget.tsx',
      [COMET_EXPORT_ATTR]: 'default',
    })
    reuseRetainedComets(mockOutlet([placeholder]))
    assertEquals(placeholder.calls.replaceWith, [first])
  },
)

Deno.test(
  'reuseRetainedComets: a placeholder with no persist key is left in place — never replaced',
  () => {
    const placeholder = new MockElement()
    reuseRetainedComets(mockOutlet([placeholder]))
    assertEquals(placeholder.calls.replaceWith, [])
  },
)

Deno.test(
  'reuseRetainedComets: a persist-tagged placeholder with no matching retained entry at all is ' +
    'left in place — the caller falls through to its own normal fresh-mount path',
  () => {
    const placeholder = new MockElement({ [COMET_PERSIST_ATTR]: 'never-retained' })
    reuseRetainedComets(mockOutlet([placeholder]))
    assertEquals(placeholder.calls.replaceWith, [])
  },
)

Deno.test(
  'detachPersistedComets + reuseRetainedComets: a persist-tagged boundary with NO module/export ' +
    "attributes falls back to '' for both — still detached, cached and reusable, never skipped",
  () => {
    const boundary = new MockElement({ [COMET_PERSIST_ATTR]: 'no-module-attrs' })
    registerPersistHandle(boundary as unknown as Element, handleSpy().handle)

    detachPersistedComets(mockOutlet([boundary]))
    assertEquals(boundary.calls.remove, 1)

    // Matches on the SAME '' fallback identity — proves the cached entry really used '' for both,
    // not e.g. `undefined` (which `take`'s own moduleUrl/exportName comparison would never match).
    const placeholder = new MockElement({ [COMET_PERSIST_ATTR]: 'no-module-attrs' })
    reuseRetainedComets(mockOutlet([placeholder]))
    assertEquals(placeholder.calls.replaceWith, [boundary])
  },
)

Deno.test(
  'reuseRetainedComets: a duplicate persist key in the SAME fragment — only the first placeholder ' +
    'is eligible for reuse',
  () => {
    const boundary = new MockElement({
      [COMET_PERSIST_ATTR]: 'dup-reuse',
      [COMET_MODULE_ATTR]: '/comets/widget.tsx',
      [COMET_EXPORT_ATTR]: 'default',
    })
    registerPersistHandle(boundary as unknown as Element, handleSpy().handle)
    detachPersistedComets(mockOutlet([boundary]))

    const placeholder1 = new MockElement({
      [COMET_PERSIST_ATTR]: 'dup-reuse',
      [COMET_MODULE_ATTR]: '/comets/widget.tsx',
      [COMET_EXPORT_ATTR]: 'default',
    })
    const placeholder2 = new MockElement({ [COMET_PERSIST_ATTR]: 'dup-reuse' })
    reuseRetainedComets(mockOutlet([placeholder1, placeholder2]))

    assertEquals(
      placeholder1.calls.replaceWith,
      [boundary],
      'the first placeholder wins the retained node',
    )
    assertEquals(
      placeholder2.calls.replaceWith,
      [],
      'the second is skipped, not a second (failed) take',
    )
  },
)
