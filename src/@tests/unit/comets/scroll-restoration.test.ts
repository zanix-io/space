import { assert, assertEquals } from '@std/assert'
import { installTimerMock, resetDom } from './dom-test-setup.ts'
import {
  attachScrollRestoration,
  DEFAULT_DRAFT_DEBOUNCE_MS,
} from 'modules/comets/scroll-restoration.ts'

// deno-lint-ignore no-explicit-any
const globals = globalThis as any

/** A real, container-scoped scroll element — `dispatchEvent` on an ordinary element (proven safe
 * by `form-draft-persistence.test.ts`/`submit-guard.test.ts`) exercises the exact same
 * listener/debounce code `attachScrollRestoration` runs for the window case too, just against a
 * different `scrollEventTarget`. See `dom-test-setup.ts`'s own doc for why a real window-level
 * `dispatchEvent` isn't used here at all. */
function buildContainer(id: string): HTMLElement {
  const el = globals.document.createElement('div')
  el.id = id
  globals.document.body.appendChild(el)
  return el
}

function fireScroll(el: Element): void {
  el.dispatchEvent(new globals.Event('scroll'))
}

function scrollContainerTo(el: Element, x: number, y: number): void {
  ;(el as unknown as { scrollLeft: number; scrollTop: number }).scrollLeft = x
  ;(el as unknown as { scrollLeft: number; scrollTop: number }).scrollTop = y
}

function setUp(): void {
  resetDom()
}

Deno.test(
  'attachScrollRestoration: restores a saved window position on attach',
  () => {
    setUp()
    globals.sessionStorage.setItem('zn-space:scroll:/en/products', JSON.stringify([10, 200]))

    const detach = attachScrollRestoration({})

    assertEquals(globals.scrollX, 10)
    assertEquals(globals.scrollY, 200)
    detach()
  },
)

Deno.test(
  'attachScrollRestoration: a location.hash present skips restoring — an explicit anchor wins',
  () => {
    setUp()
    globals.sessionStorage.setItem('zn-space:scroll:/en/products', JSON.stringify([0, 400]))
    globals.location.hash = '#section-2'

    const detach = attachScrollRestoration({})

    assertEquals(globals.scrollY, 0)
    detach()
  },
)

Deno.test(
  'attachScrollRestoration: nothing saved yet leaves the current position untouched',
  () => {
    setUp()
    globals.scrollTo(0, 77)

    const detach = attachScrollRestoration({})

    assertEquals(globals.scrollY, 77)
    detach()
  },
)

Deno.test(
  'attachScrollRestoration: an explicit storageKey overrides the location-derived default',
  () => {
    setUp()
    globals.sessionStorage.setItem('zn-space:scroll:shared-key', JSON.stringify([0, 42]))

    const detach = attachScrollRestoration({ storageKey: 'shared-key' })

    assertEquals(globals.scrollY, 42)
    detach()
  },
)

Deno.test(
  'attachScrollRestoration: tracks a named container element instead of the window when targetId is given',
  () => {
    setUp()
    const timers = installTimerMock()
    const container = buildContainer('sidebar')
    globals.sessionStorage.setItem('zn-space:scroll:sidebar-key', JSON.stringify([0, 88]))

    const detach = attachScrollRestoration({ targetId: 'sidebar', storageKey: 'sidebar-key' })

    assertEquals((container as unknown as { scrollTop: number }).scrollTop, 88)

    scrollContainerTo(container, 0, 150)
    fireScroll(container)
    timers.advance(DEFAULT_DRAFT_DEBOUNCE_MS)
    assertEquals(
      JSON.parse(globals.sessionStorage.getItem('zn-space:scroll:sidebar-key')),
      [0, 150],
    )

    // The WINDOW's own position is untouched by a container-scoped instance.
    assertEquals(globals.scrollY, 0)

    detach()
    timers.restore()
  },
)

Deno.test(
  'attachScrollRestoration: saves the container position, debounced, on scroll',
  () => {
    setUp()
    const timers = installTimerMock()
    const container = buildContainer('panel')
    const detach = attachScrollRestoration({
      targetId: 'panel',
      storageKey: 'panel-key',
      debounceMs: 300,
    })

    scrollContainerTo(container, 0, 123)
    fireScroll(container)

    assertEquals(globals.sessionStorage.getItem('zn-space:scroll:panel-key'), null)
    timers.advance(299)
    assertEquals(globals.sessionStorage.getItem('zn-space:scroll:panel-key'), null)
    timers.advance(1)
    assertEquals(
      JSON.parse(globals.sessionStorage.getItem('zn-space:scroll:panel-key')),
      [0, 123],
    )

    detach()
    timers.restore()
  },
)

Deno.test(
  'attachScrollRestoration: uses DEFAULT_DRAFT_DEBOUNCE_MS when debounceMs is omitted',
  () => {
    setUp()
    const timers = installTimerMock()
    const container = buildContainer('panel2')
    const detach = attachScrollRestoration({ targetId: 'panel2', storageKey: 'panel2-key' })

    scrollContainerTo(container, 0, 10)
    fireScroll(container)
    timers.advance(DEFAULT_DRAFT_DEBOUNCE_MS - 1)
    assertEquals(globals.sessionStorage.getItem('zn-space:scroll:panel2-key'), null)
    timers.advance(1)
    assert(globals.sessionStorage.getItem('zn-space:scroll:panel2-key') !== null)

    detach()
    timers.restore()
  },
)

Deno.test(
  'attachScrollRestoration: storage="local" writes to localStorage, never sessionStorage',
  () => {
    setUp()
    const timers = installTimerMock()
    const container = buildContainer('panel3')
    const detach = attachScrollRestoration({
      targetId: 'panel3',
      storageKey: 'local-key',
      storage: 'local',
    })

    scrollContainerTo(container, 0, 30)
    fireScroll(container)
    timers.advance(DEFAULT_DRAFT_DEBOUNCE_MS)

    assertEquals(globals.sessionStorage.getItem('zn-space:scroll:local-key'), null)
    assert(globals.localStorage.getItem('zn-space:scroll:local-key') !== null)

    detach()
    timers.restore()
  },
)

Deno.test(
  'attachScrollRestoration: a targetId matching nothing on the page is a safe no-op',
  () => {
    setUp()
    const detach = attachScrollRestoration({ targetId: 'does-not-exist' })
    detach() // must not throw
  },
)

Deno.test(
  'attachScrollRestoration: cleanup stops future saves from reaching storage',
  () => {
    setUp()
    const timers = installTimerMock()
    const container = buildContainer('panel4')
    const detach = attachScrollRestoration({ targetId: 'panel4', storageKey: 'cleanup-key' })

    scrollContainerTo(container, 0, 5)
    fireScroll(container)
    detach()
    timers.advance(DEFAULT_DRAFT_DEBOUNCE_MS)

    assertEquals(globals.sessionStorage.getItem('zn-space:scroll:cleanup-key'), null)
    timers.restore()
  },
)
