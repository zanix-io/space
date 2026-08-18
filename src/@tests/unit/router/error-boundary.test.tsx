import { assert, assertEquals, assertStrictEquals } from '@std/assert'
import logger from '@zanix/logger'
import { SpaceErrorBoundary } from 'modules/router/error-boundary.tsx'
import type { ErrorBoundaryProps } from 'typings/page.ts'
import type { ErrorInfo } from 'react'

function Fallback({ error, reset }: ErrorBoundaryProps) {
  return (
    <p data-fallback onClick={reset}>
      {String((error as Error)?.message ?? error)}
    </p>
  )
}

/** Same convention as `hydrate-comets.test.ts`'s own `countErrors()` — save the original, restore
 * in a `finally`, capture the real call arguments rather than just a count. */
function spyOnLoggerError(): { calls: unknown[][]; restore: () => void } {
  const original = logger.error
  const calls: unknown[][] = []
  logger.error = ((...args: unknown[]) => {
    calls.push(args)
  }) as typeof original
  return { calls, restore: () => (logger.error = original) }
}

/** A minimal, real `Component.updater` — the same seam react-dom/react-test-renderer each supply
 * their own version of — so `setState` (called by `reset()`) genuinely mutates `this.state`
 * instead of silently no-oping through React's default `ReactNoopUpdateQueue`, which only warns
 * when a component was never actually mounted by a reconciler. */
function withRealSetState(
  instance: SpaceErrorBoundary,
): void {
  type State = { hasError: boolean; error: unknown }
  ;(instance as unknown as { updater: unknown }).updater = {
    isMounted: () => true,
    enqueueSetState: (
      publicInstance: { state: State },
      partialState: Partial<State> | ((state: State) => Partial<State>),
    ) => {
      const next = typeof partialState === 'function'
        ? (partialState as (state: State) => Partial<State>)(publicInstance.state)
        : partialState
      Object.assign(publicInstance.state, next)
    },
    enqueueReplaceState: () => {},
    enqueueForceUpdate: () => {},
  }
}

// -------------------------------------------------------------------------------------------
// getDerivedStateFromError — a plain static method
// -------------------------------------------------------------------------------------------

Deno.test(
  'SpaceErrorBoundary.getDerivedStateFromError: returns { hasError: true, error } for whatever ' +
    'was thrown',
  () => {
    const error = new Error('boom')
    const state = SpaceErrorBoundary.getDerivedStateFromError(error)
    assertEquals(state, { hasError: true, error })
  },
)

Deno.test(
  'SpaceErrorBoundary.getDerivedStateFromError: works for a non-Error thrown value too',
  () => {
    const state = SpaceErrorBoundary.getDerivedStateFromError('a thrown string')
    assertEquals(state, { hasError: true, error: 'a thrown string' })
  },
)

// -------------------------------------------------------------------------------------------
// componentDidCatch — logs, never throws or swallows silently
// -------------------------------------------------------------------------------------------

Deno.test(
  'componentDidCatch: logs the error and the component stack via logger.error',
  () => {
    const instance = new SpaceErrorBoundary({ children: null, fallback: Fallback })
    const spy = spyOnLoggerError()
    try {
      const error = new Error('segment blew up')
      const info: ErrorInfo = { componentStack: '\n    in Segment\n    in Page' }
      instance.componentDidCatch(error, info)

      assertEquals(spy.calls.length, 1)
      const [message, loggedError, loggedStack] = spy.calls[0]
      assertEquals(message, 'Uncaught error in a Space page segment')
      assertStrictEquals(loggedError, error)
      assertEquals(loggedStack, info.componentStack)
    } finally {
      spy.restore()
    }
  },
)

// -------------------------------------------------------------------------------------------
// render — the actual UI decision: children while healthy, the fallback once caught
// -------------------------------------------------------------------------------------------

Deno.test('render: renders children unchanged while hasError is false', () => {
  const children = <p>healthy content</p>
  const instance = new SpaceErrorBoundary({ children, fallback: Fallback })
  assertStrictEquals(instance.render(), children)
})

Deno.test(
  'render: once hasError is true, renders the fallback with the caught error and a reset callback',
  () => {
    const instance = new SpaceErrorBoundary({ children: <p>healthy</p>, fallback: Fallback })
    const caught = new Error('caught during render')
    // Manufactured state — exactly what getDerivedStateFromError would have produced.
    instance.state = { hasError: true, error: caught }

    const output = instance.render()
    assert(output !== null && typeof output === 'object')
    // deno-lint-ignore no-explicit-any
    const element = output as any
    assertStrictEquals(element.type, Fallback)
    assertStrictEquals(element.props.error, caught)
    assertEquals(typeof element.props.reset, 'function')
  },
)

// -------------------------------------------------------------------------------------------
// reset — actually clears hasError back to false, via a real setState call
// -------------------------------------------------------------------------------------------

Deno.test(
  'reset: clears hasError back to false and drops the caught error, via setState',
  () => {
    const instance = new SpaceErrorBoundary({ children: <p>healthy</p>, fallback: Fallback })
    withRealSetState(instance)
    instance.state = { hasError: true, error: new Error('caught') }

    // `reset` is private at the type level — this is the one legitimate way to reach it from a
    // test, same as `render()`/`componentDidCatch` are reached by their own public signatures.
    const boundary = instance as unknown as { reset: () => void }
    boundary.reset()

    assertEquals(instance.state, { hasError: false, error: undefined })
    // And render() now reflects the reset — back to children, not the fallback.
    assertStrictEquals(instance.render(), instance.props.children)
  },
)
