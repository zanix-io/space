import { assert, assertEquals, assertFalse } from '@std/assert'
import { resetDom } from './dom-test-setup.ts'
import { attachSubmitGuard } from 'modules/comets/submit-guard.ts'

// deno-lint-ignore no-explicit-any
const globals = globalThis as any

function buildForm(
  id: string,
  buttons: Array<{ tag?: 'button' | 'input'; type?: string; label?: string }> = [{}],
): HTMLFormElement {
  const form = globals.document.createElement('form')
  form.id = id
  for (const button of buttons) {
    const el = globals.document.createElement(button.tag ?? 'button')
    if (button.type) el.type = button.type
    if (button.label !== undefined) {
      if (button.tag === 'input') el.value = button.label
      else el.textContent = button.label
    }
    form.appendChild(el)
  }
  globals.document.body.appendChild(form)
  return form
}

function fireSubmit(form: Element): boolean {
  return form.dispatchEvent(new globals.Event('submit', { bubbles: true, cancelable: true }))
}

/** Waits for the guard's deferred state change (it runs one tick after `submit`). */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

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
  async () => {
    setUp()
    const form = buildForm('g2')
    const detach = attachSubmitGuard({ formId: 'g2' })

    fireSubmit(form)

    await tick()
    const secondNotPrevented = fireSubmit(form)

    assertFalse(secondNotPrevented)
    detach()
  },
)

Deno.test(
  'attachSubmitGuard: disables every submit-triggering control on the first submit, by default',
  async () => {
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

    await tick()
    const controls = Array.from(form.querySelectorAll('button, input')) as Array<
      HTMLButtonElement | HTMLInputElement
    >
    assertEquals(controls.map((c) => c.disabled), [true, true, true, false, false])
    detach()
  },
)

Deno.test(
  'attachSubmitGuard: disableControls=false leaves every control enabled, still rejects a second submit',
  async () => {
    setUp()
    const form = buildForm('g4')
    const detach = attachSubmitGuard({ formId: 'g4', disableControls: false })

    fireSubmit(form)

    await tick()
    const button = form.querySelector('button') as HTMLButtonElement
    assertFalse(button.disabled)

    const secondNotPrevented = fireSubmit(form)
    assertFalse(secondNotPrevented)
    detach()
  },
)

Deno.test(
  'attachSubmitGuard: cleanup re-enables every control it disabled and detaches the listener',
  async () => {
    setUp()
    const form = buildForm('g5')
    const detach = attachSubmitGuard({ formId: 'g5' })

    fireSubmit(form)

    await tick()
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
  async () => {
    setUp()
    const form = buildForm('g6')
    const preDisabled = form.querySelector('button') as HTMLButtonElement
    preDisabled.disabled = true
    const detach = attachSubmitGuard({ formId: 'g6' })

    fireSubmit(form)

    await tick()
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
  async () => {
    setUp()
    const form = buildForm('g7')
    const pageShow = capturePageShowHandler(() => attachSubmitGuard({ formId: 'g7' }))

    fireSubmit(form)

    await tick()
    const button = form.querySelector('button') as HTMLButtonElement
    assert(button.disabled)

    pageShow.fire(true)

    assertFalse(button.disabled)
    pageShow.detach()
  },
)

Deno.test(
  'attachSubmitGuard: a bfcache-restore pageshow also lets a real submit through again',
  async () => {
    setUp()
    const form = buildForm('g8')
    const pageShow = capturePageShowHandler(() => attachSubmitGuard({ formId: 'g8' }))

    fireSubmit(form)

    await tick()
    pageShow.fire(true)

    const notPrevented = fireSubmit(form)

    assert(notPrevented)
    pageShow.detach()
  },
)

Deno.test(
  'attachSubmitGuard: a fresh-load pageshow (persisted: false) leaves disabled controls disabled',
  async () => {
    setUp()
    const form = buildForm('g9')
    const pageShow = capturePageShowHandler(() => attachSubmitGuard({ formId: 'g9' }))

    fireSubmit(form)

    await tick()
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

Deno.test(
  "attachSubmitGuard: pendingLabel swaps a <button>'s textContent and an <input type=submit>'s value",
  async () => {
    setUp()
    const form = buildForm('g11', [
      { tag: 'button', label: 'Save' },
      { tag: 'input', type: 'submit', label: 'Send' },
    ])
    const detach = attachSubmitGuard({ formId: 'g11', pendingLabel: 'Saving…' })

    fireSubmit(form)

    await tick()
    const [button, input] = Array.from(form.querySelectorAll('button, input')) as [
      HTMLButtonElement,
      HTMLInputElement,
    ]
    assertEquals(button.textContent, 'Saving…')
    assertEquals(input.value, 'Saving…')
    detach()
  },
)

Deno.test(
  'attachSubmitGuard: pendingLabel applies even when disableControls is false',
  async () => {
    setUp()
    const form = buildForm('g12', [{ tag: 'button', label: 'Save' }])
    const detach = attachSubmitGuard({
      formId: 'g12',
      disableControls: false,
      pendingLabel: 'Saving…',
    })

    fireSubmit(form)

    await tick()
    const button = form.querySelector('button') as HTMLButtonElement
    assertEquals(button.textContent, 'Saving…')
    assertFalse(button.disabled)
    detach()
  },
)

Deno.test(
  'attachSubmitGuard: cleanup restores the original label alongside re-enabling the control',
  async () => {
    setUp()
    const form = buildForm('g13', [{ tag: 'button', label: 'Save' }])
    const detach = attachSubmitGuard({ formId: 'g13', pendingLabel: 'Saving…' })

    fireSubmit(form)

    await tick()
    const button = form.querySelector('button') as HTMLButtonElement
    assertEquals(button.textContent, 'Saving…')

    detach()

    assertEquals(button.textContent, 'Save')
  },
)

Deno.test(
  'attachSubmitGuard: a bfcache-restore pageshow restores the original label, not just control state',
  async () => {
    setUp()
    const form = buildForm('g14', [{ tag: 'button', label: 'Save' }])
    const pageShow = capturePageShowHandler(() =>
      attachSubmitGuard({ formId: 'g14', pendingLabel: 'Saving…' })
    )

    fireSubmit(form)

    await tick()
    const button = form.querySelector('button') as HTMLButtonElement
    assertEquals(button.textContent, 'Saving…')

    pageShow.fire(true)

    assertEquals(button.textContent, 'Save')
    pageShow.detach()
  },
)

Deno.test(
  'attachSubmitGuard: no pendingLabel means no label swap at all',
  async () => {
    setUp()
    const form = buildForm('g15', [{ tag: 'button', label: 'Save' }])
    const detach = attachSubmitGuard({ formId: 'g15' })

    fireSubmit(form)

    await tick()
    const button = form.querySelector('button') as HTMLButtonElement
    assertEquals(button.textContent, 'Save')
    detach()
  },
)

function fireSubmitFrom(form: Element, submitter: Element | null): boolean {
  return form.dispatchEvent(
    Object.assign(new globals.Event('submit', { bubbles: true, cancelable: true }), { submitter }),
  )
}

Deno.test(
  "attachSubmitGuard: the pressed control's name/value is still intact while the submit event is dispatched",
  () => {
    setUp()
    const form = buildForm('g20', [{}, { tag: 'input', type: 'submit', label: 'edit' }])
    const pressed = form.querySelector('input') as HTMLInputElement
    pressed.name = 'next'
    const detach = attachSubmitGuard({ formId: 'g20', pendingLabel: 'Saving…' })

    fireSubmitFrom(form, pressed)

    // The browser reads the form data right after the event: nothing may have changed by then.
    assertFalse(pressed.disabled)
    assertEquals(pressed.value, 'edit')
    assertEquals(new globals.FormData(form, pressed).get('next'), 'edit')
    detach()
  },
)

Deno.test(
  'attachSubmitGuard: pendingLabel relabels only the pressed control, every control is still disabled',
  async () => {
    setUp()
    const form = buildForm('g21', [
      { label: 'Continue' },
      { tag: 'input', type: 'submit', label: 'Complete now' },
    ])
    const [first, second] = Array.from(form.querySelectorAll('button, input')) as Array<
      HTMLButtonElement | HTMLInputElement
    >
    const detach = attachSubmitGuard({ formId: 'g21', pendingLabel: 'Saving…' })

    fireSubmitFrom(form, second)
    await tick()

    assertEquals(first.textContent, 'Continue')
    assertEquals((second as HTMLInputElement).value, 'Saving…')
    assert(first.disabled && second.disabled)

    detach()
    assertEquals((second as HTMLInputElement).value, 'Complete now')
  },
)

Deno.test(
  'attachSubmitGuard: pendingLabel relabels every control when the submitter is unknown',
  async () => {
    setUp()
    const form = buildForm('g22', [{ label: 'Continue' }, { label: 'Complete now' }])
    const detach = attachSubmitGuard({ formId: 'g22', pendingLabel: 'Saving…' })

    fireSubmitFrom(form, null)
    await tick()

    const labels = Array.from(form.querySelectorAll('button')).map((b) => b.textContent)
    assertEquals(labels, ['Saving…', 'Saving…'])
    detach()
  },
)

Deno.test(
  'attachSubmitGuard: a cleanup before the deferred change leaves every control untouched',
  async () => {
    setUp()
    const form = buildForm('g23', [{ label: 'Continue' }])
    const button = form.querySelector('button') as HTMLButtonElement
    const detach = attachSubmitGuard({ formId: 'g23', pendingLabel: 'Saving…' })

    fireSubmit(form)
    detach()
    await tick()

    assertFalse(button.disabled)
    assertEquals(button.textContent, 'Continue')
  },
)
