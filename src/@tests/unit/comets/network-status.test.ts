import { assertEquals } from '@std/assert'
import { resetDom } from './dom-test-setup.ts'
import { attachNetworkStatus } from 'modules/comets/network-status.ts'

// deno-lint-ignore no-explicit-any
const globals = globalThis as any

/** Captures the exact functions registered for `online`/`offline` on the window, without ever
 * dispatching a real event on it — see `dom-test-setup.ts`'s own doc for why a real window-level
 * `dispatchEvent` isn't used in this directory's tests at all. Calling a captured handler
 * directly exercises the exact same code `attachNetworkStatus` registers, just without the
 * crash risk. */
function captureNetworkHandlers(attach: () => () => void): {
  fireOnline(): void
  fireOffline(): void
  detach: () => void
  removedBoth(): boolean
} {
  const originalAdd = globals.addEventListener
  const originalRemove = globals.removeEventListener
  let onlineHandler: (() => void) | undefined
  let offlineHandler: (() => void) | undefined
  let removedOnline = false
  let removedOffline = false
  globals.addEventListener = (type: string, listener: unknown, options?: unknown) => {
    if (type === 'online') onlineHandler = listener as () => void
    if (type === 'offline') offlineHandler = listener as () => void
    return originalAdd(type, listener, options)
  }
  globals.removeEventListener = (type: string, listener: unknown) => {
    if (type === 'online' && listener === onlineHandler) removedOnline = true
    if (type === 'offline' && listener === offlineHandler) removedOffline = true
    return originalRemove(type, listener)
  }
  const detach = attach()
  globals.addEventListener = originalAdd
  const online = onlineHandler
  const offline = offlineHandler
  if (!online || !offline) {
    throw new Error('online/offline listeners were never registered')
  }
  return {
    fireOnline: () => online(),
    fireOffline: () => offline(),
    detach: () => {
      detach()
      globals.removeEventListener = originalRemove
    },
    removedBoth: () => removedOnline && removedOffline,
  }
}

function setUp(): void {
  resetDom()
}

Deno.test(
  'attachNetworkStatus: calls onChange once, immediately, with the current navigator.onLine',
  () => {
    setUp()
    const calls: boolean[] = []
    const detach = attachNetworkStatus((online) => calls.push(online))

    assertEquals(calls, [true])
    detach()
  },
)

Deno.test(
  'attachNetworkStatus: calls onChange again on a real offline/online transition',
  () => {
    setUp()
    const calls: boolean[] = []
    const { fireOffline, fireOnline, detach } = captureNetworkHandlers(() =>
      attachNetworkStatus((online) => calls.push(online))
    )

    fireOffline()
    fireOnline()

    assertEquals(calls, [true, false, true])
    detach()
  },
)

Deno.test(
  'attachNetworkStatus: cleanup removes both the online and offline listeners it registered',
  () => {
    setUp()
    const { detach, removedBoth } = captureNetworkHandlers(() => attachNetworkStatus(() => {}))

    assertEquals(removedBoth(), false)
    detach()
    assertEquals(removedBoth(), true)
  },
)
