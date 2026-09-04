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
