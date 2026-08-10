import { assertEquals, assertFalse } from '@std/assert'
import { scheduleCometHydration } from 'modules/client/schedule-comet-hydration.ts'

// deno-lint-ignore no-explicit-any
const fakeElement = {} as any

Deno.test("scheduleCometHydration: 'load' runs immediately", () => {
  let ran = false
  scheduleCometHydration('load', fakeElement, undefined, () => (ran = true))
  assertEquals(ran, true)
})

Deno.test("scheduleCometHydration: 'only' runs immediately, same as 'load'", () => {
  let ran = false
  scheduleCometHydration('only', fakeElement, undefined, () => (ran = true))
  assertEquals(ran, true)
})

Deno.test("scheduleCometHydration: 'none' never runs", () => {
  let ran = false
  scheduleCometHydration('none', fakeElement, undefined, () => (ran = true))
  assertFalse(ran)
})

Deno.test("scheduleCometHydration: 'idle' defers to the injected requestIdleCallback", () => {
  let ran = false
  let capturedCallback: (() => void) | undefined
  scheduleCometHydration('idle', fakeElement, undefined, () => (ran = true), {
    requestIdleCallback: (cb) => (capturedCallback = cb),
  })
  assertFalse(ran, 'must not run before the idle callback actually fires')
  capturedCallback?.()
  assertEquals(ran, true)
})

Deno.test(
  "scheduleCometHydration: 'visible' runs once the injected IntersectionObserver reports an intersecting entry",
  () => {
    let ran = false
    let observedCallback: (entries: { isIntersecting: boolean }[]) => void = () => {}
    let disconnected = false

    class FakeIntersectionObserver {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        observedCallback = callback
      }
      public observe(): void {}
      public disconnect(): void {
        disconnected = true
      }
    }

    scheduleCometHydration('visible', fakeElement, undefined, () => (ran = true), {
      // deno-lint-ignore no-explicit-any
      IntersectionObserverCtor: FakeIntersectionObserver as any,
    })

    observedCallback([{ isIntersecting: false }])
    assertFalse(ran, 'a non-intersecting entry must not trigger hydration')

    observedCallback([{ isIntersecting: true }])
    assertEquals(ran, true)
    assertEquals(disconnected, true, 'the observer must disconnect once used')
  },
)

Deno.test(
  "scheduleCometHydration: 'media' runs immediately when the injected matchMedia already matches",
  () => {
    let ran = false
    scheduleCometHydration('media', fakeElement, '(max-width: 768px)', () => (ran = true), {
      matchMedia: () => ({ matches: true }) as MediaQueryList,
    })
    assertEquals(ran, true)
  },
)

Deno.test(
  "scheduleCometHydration: 'media' waits for a change event when it doesn't match yet",
  () => {
    let ran = false
    let listener: (() => void) | undefined
    let removed = false
    const mql = {
      matches: false,
      addEventListener: (_: string, cb: () => void) => (listener = cb),
      removeEventListener: () => (removed = true),
      // deno-lint-ignore no-explicit-any
    } as any

    scheduleCometHydration('media', fakeElement, '(max-width: 768px)', () => (ran = true), {
      matchMedia: () => mql,
    })
    assertFalse(ran)

    mql.matches = false
    listener?.()
    assertFalse(ran, 'a change event while still not matching must not trigger hydration')

    mql.matches = true
    listener?.()
    assertEquals(ran, true)
    assertEquals(removed, true)
  },
)

Deno.test("scheduleCometHydration: 'media' with no media query runs immediately", () => {
  let ran = false
  scheduleCometHydration('media', fakeElement, undefined, () => (ran = true))
  assertEquals(ran, true)
})
