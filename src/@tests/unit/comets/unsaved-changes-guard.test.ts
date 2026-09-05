import { assert, assertEquals, assertFalse } from '@std/assert'
import { resetDom } from './dom-test-setup.ts'
import { attachUnsavedChangesGuard } from 'modules/comets/unsaved-changes-guard.ts'

// deno-lint-ignore no-explicit-any
const globals = globalThis as any

function buildForm(id: string, fields: string[]): HTMLFormElement {
  const form = globals.document.createElement('form')
  form.id = id
  for (const name of fields) {
    const el = globals.document.createElement('input')
    el.name = name
    form.appendChild(el)
  }
  globals.document.body.appendChild(form)
  return form
}

function fireInput(field: Element): void {
  field.dispatchEvent(new globals.Event('input', { bubbles: true }))
}

function fireSubmit(form: Element): void {
  form.dispatchEvent(new globals.Event('submit', { bubbles: true, cancelable: true }))
}

/** Captures the exact function registered for `beforeunload` on the window, without ever
 * dispatching a real event on it — see `dom-test-setup.ts`'s own doc for why a real window-level
 * `dispatchEvent` isn't used in this directory's tests at all. Calling the captured handler
 * directly, with a hand-built fake event, exercises the exact same code
 * `attachUnsavedChangesGuard` registers, just without the crash risk. Also tracks whether the
 * SAME reference is later passed to `removeEventListener`, so cleanup can be verified without
 * needing to actually dispatch anything. */
function captureBeforeUnloadHandler(attach: () => () => void): {
  handler: (event: { preventDefault(): void; returnValue: string }) => void
  detach: () => void
  removedSameHandler(): boolean
} {
  const originalAdd = globals.addEventListener
  const originalRemove = globals.removeEventListener
  let handler: ((event: { preventDefault(): void; returnValue: string }) => void) | undefined
  let removedSame = false
  globals.addEventListener = (type: string, listener: unknown, options?: unknown) => {
    if (type === 'beforeunload') handler = listener as typeof handler
    return originalAdd(type, listener, options)
  }
  globals.removeEventListener = (type: string, listener: unknown) => {
    if (type === 'beforeunload' && listener === handler) removedSame = true
    return originalRemove(type, listener)
  }
  const detach = attach()
  globals.addEventListener = originalAdd
  if (!handler) throw new Error('beforeunload listener was never registered')
  return {
    handler,
    detach: () => {
      detach()
      globals.removeEventListener = originalRemove
    },
    removedSameHandler: () => removedSame,
  }
}

function fakeEvent() {
  let prevented = false
  return {
    get defaultPrevented() {
      return prevented
    },
    preventDefault() {
      prevented = true
    },
    returnValue: '',
  }
}

function setUp(): void {
  resetDom()
}

Deno.test(
  'attachUnsavedChangesGuard: a page unload with no changes at all is never intercepted',
  () => {
    setUp()
    buildForm('u1', ['title'])
    const { handler, detach } = captureBeforeUnloadHandler(() =>
      attachUnsavedChangesGuard({ formId: 'u1' })
    )

    const event = fakeEvent()
    handler(event)

    assertFalse(event.defaultPrevented)
    detach()
  },
)

Deno.test(
  'attachUnsavedChangesGuard: a field changing marks the form dirty — the next unload is intercepted',
  () => {
    setUp()
    const form = buildForm('u2', ['title'])
    const { handler, detach } = captureBeforeUnloadHandler(() =>
      attachUnsavedChangesGuard({ formId: 'u2' })
    )

    fireInput(form.elements.namedItem('title') as Element)
    const event = fakeEvent()
    handler(event)

    assert(event.defaultPrevented)
    assertEquals(event.returnValue, '')
    detach()
  },
)

Deno.test(
  'attachUnsavedChangesGuard: submit clears dirty — the very submission that saves it is never itself intercepted',
  () => {
    setUp()
    const form = buildForm('u3', ['title'])
    const { handler, detach } = captureBeforeUnloadHandler(() =>
      attachUnsavedChangesGuard({ formId: 'u3' })
    )

    fireInput(form.elements.namedItem('title') as Element)
    fireSubmit(form)
    const event = fakeEvent()
    handler(event)

    assertFalse(event.defaultPrevented)
    detach()
  },
)

Deno.test(
  'attachUnsavedChangesGuard: excludeFields never marks the form dirty on its own',
  () => {
    setUp()
    const form = buildForm('u4', ['title', 'liveSearch'])
    const { handler, detach } = captureBeforeUnloadHandler(() =>
      attachUnsavedChangesGuard({ formId: 'u4', excludeFields: ['liveSearch'] })
    )

    fireInput(form.elements.namedItem('liveSearch') as Element)
    const event = fakeEvent()
    handler(event)

    assertFalse(event.defaultPrevented)
    detach()
  },
)

Deno.test(
  'attachUnsavedChangesGuard: cleanup removes beforeunload with the exact same handler reference it registered',
  () => {
    setUp()
    buildForm('u5', ['title'])
    const { detach, removedSameHandler } = captureBeforeUnloadHandler(() =>
      attachUnsavedChangesGuard({ formId: 'u5' })
    )

    assertFalse(removedSameHandler())
    detach()
    assert(removedSameHandler())
  },
)

Deno.test(
  'attachUnsavedChangesGuard: a formId matching nothing on the page is a safe no-op',
  () => {
    setUp()
    const detach = attachUnsavedChangesGuard({ formId: 'does-not-exist' })
    detach() // must not throw
  },
)
