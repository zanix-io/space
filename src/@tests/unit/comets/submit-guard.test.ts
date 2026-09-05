import { assert, assertEquals, assertFalse } from '@std/assert'
import { resetDom } from './dom-test-setup.ts'
import { attachSubmitGuard } from 'modules/comets/submit-guard.ts'

// deno-lint-ignore no-explicit-any
const globals = globalThis as any

function buildForm(
  id: string,
  buttons: Array<{ tag?: 'button' | 'input'; type?: string }> = [{}],
): HTMLFormElement {
  const form = globals.document.createElement('form')
  form.id = id
  for (const button of buttons) {
    const el = globals.document.createElement(button.tag ?? 'button')
    if (button.type) el.type = button.type
    form.appendChild(el)
  }
  globals.document.body.appendChild(form)
  return form
}

function fireSubmit(form: Element): boolean {
  return form.dispatchEvent(new globals.Event('submit', { bubbles: true, cancelable: true }))
}

function setUp(): void {
  resetDom()
}

/** Captures the exact `pageshow` handler {@linkcode attachSubmitGuard} registers on `globalThis`,
 * without ever dispatching a real event on it — see `dom-test-setup.ts`'s own doc for why a real
 * window-level `dispatchEvent` isn't used in this directory's tests at all, and
 * `network-status.test.ts`'s own identical `captureNetworkHandlers` for the same pattern applied to
 * a different pair of window events. Calling the captured handler directly exercises the exact same
 * code `attachSubmitGuard` registers, just without the crash risk. */
function capturePageShowHandler(attach: () => () => void): {
  fire(persisted: boolean): void
  detach: () => void
  removed(): boolean
} {
  const originalAdd = globals.addEventListener
  const originalRemove = globals.removeEventListener
  let handler: ((event: Event) => void) | undefined
  let wasRemoved = false
  globals.addEventListener = (type: string, listener: unknown, options?: unknown) => {
    if (type === 'pageshow') handler = listener as (event: Event) => void
    return originalAdd(type, listener, options)
  }
  globals.removeEventListener = (type: string, listener: unknown) => {
    if (type === 'pageshow' && listener === handler) wasRemoved = true
    return originalRemove(type, listener)
  }
  const detach = attach()
  globals.addEventListener = originalAdd
  const pageShowHandler = handler
  if (!pageShowHandler) throw new Error('pageshow listener was never registered')
  return {
    fire: (persisted: boolean) =>
      pageShowHandler(Object.assign(new globals.Event('pageshow'), { persisted })),
    detach: () => {
      detach()
      globals.removeEventListener = originalRemove
    },
    removed: () => wasRemoved,
  }
}

Deno.test('attachSubmitGuard: the first submit is let through, unprevented', () => {
  setUp()
  const form = buildForm('g1')
  const detach = attachSubmitGuard({ formId: 'g1' })

  const notPrevented = fireSubmit(form)

  assert(notPrevented)
  detach()
})

Deno.test(
  'attachSubmitGuard: a second submit while the first is still in flight is rejected outright',
  () => {
    setUp()
    const form = buildForm('g2')
    const detach = attachSubmitGuard({ formId: 'g2' })

    fireSubmit(form)
    const secondNotPrevented = fireSubmit(form)

    assertFalse(secondNotPrevented)
    detach()
  },
)

Deno.test(
  'attachSubmitGuard: disables every submit-triggering control on the first submit, by default',
  () => {
    setUp()
    const form = buildForm('g3', [
      { tag: 'button' }, // no type — implicit submit
      { tag: 'button', type: 'submit' },
      { tag: 'input', type: 'submit' },
      { tag: 'button', type: 'button' }, // never a submit control
      { tag: 'button', type: 'reset' }, // never a submit control
    ])
    const detach = attachSubmitGuard({ formId: 'g3' })

    fireSubmit(form)

    const controls = Array.from(form.querySelectorAll('button, input')) as Array<
      HTMLButtonElement | HTMLInputElement
    >
    assertEquals(controls.map((c) => c.disabled), [true, true, true, false, false])
    detach()
  },
)

Deno.test(
  'attachSubmitGuard: disableControls=false leaves every control enabled, still rejects a second submit',
  () => {
    setUp()
    const form = buildForm('g4')
    const detach = attachSubmitGuard({ formId: 'g4', disableControls: false })

    fireSubmit(form)
    const button = form.querySelector('button') as HTMLButtonElement
    assertFalse(button.disabled)

    const secondNotPrevented = fireSubmit(form)
    assertFalse(secondNotPrevented)
    detach()
  },
)

Deno.test(
  'attachSubmitGuard: cleanup re-enables every control it disabled and detaches the listener',
  () => {
    setUp()
    const form = buildForm('g5')
    const detach = attachSubmitGuard({ formId: 'g5' })

    fireSubmit(form)
    const button = form.querySelector('button') as HTMLButtonElement
    assert(button.disabled)

    detach()
    assertFalse(button.disabled)

    // The listener itself is gone too — a submit after detach is never intercepted.
    const notPrevented = fireSubmit(form)
    assert(notPrevented)
  },
)

Deno.test(
  'attachSubmitGuard: cleanup never re-enables a control that was ALREADY disabled before this attached',
  () => {
    setUp()
    const form = buildForm('g6')
    const preDisabled = form.querySelector('button') as HTMLButtonElement
    preDisabled.disabled = true
    const detach = attachSubmitGuard({ formId: 'g6' })

    fireSubmit(form)
    detach()

    assert(preDisabled.disabled)
  },
)

Deno.test('attachSubmitGuard: a formId matching nothing on the page is a safe no-op', () => {
  setUp()
  const detach = attachSubmitGuard({ formId: 'does-not-exist' })
  detach() // must not throw
})

Deno.test(
  'attachSubmitGuard: a bfcache-restore pageshow (persisted: true) re-enables disabled controls',
  () => {
    setUp()
    const form = buildForm('g7')
    const pageShow = capturePageShowHandler(() => attachSubmitGuard({ formId: 'g7' }))

    fireSubmit(form)
    const button = form.querySelector('button') as HTMLButtonElement
    assert(button.disabled)

    pageShow.fire(true)

    assertFalse(button.disabled)
    pageShow.detach()
  },
)

Deno.test(
  'attachSubmitGuard: a bfcache-restore pageshow also lets a real submit through again',
  () => {
    setUp()
    const form = buildForm('g8')
    const pageShow = capturePageShowHandler(() => attachSubmitGuard({ formId: 'g8' }))

    fireSubmit(form)
    pageShow.fire(true)

    const notPrevented = fireSubmit(form)

    assert(notPrevented)
    pageShow.detach()
  },
)

Deno.test(
  'attachSubmitGuard: a fresh-load pageshow (persisted: false) leaves disabled controls disabled',
  () => {
    setUp()
    const form = buildForm('g9')
    const pageShow = capturePageShowHandler(() => attachSubmitGuard({ formId: 'g9' }))

    fireSubmit(form)
    const button = form.querySelector('button') as HTMLButtonElement
    assert(button.disabled)

    pageShow.fire(false)

    assert(button.disabled)
    pageShow.detach()
  },
)

Deno.test('attachSubmitGuard: cleanup also detaches the pageshow listener', () => {
  setUp()
  buildForm('g10')
  const pageShow = capturePageShowHandler(() => attachSubmitGuard({ formId: 'g10' }))

  pageShow.detach()

  assert(pageShow.removed())
})
