import { assert, assertEquals, assertFalse } from '@std/assert'
import { resetDom } from './dom-test-setup.ts'
import { attachSubmitIntercept } from 'modules/comets/submit-intercept.ts'
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

/** Stubs `form.submit()` (never a real happy-dom navigation) so a test can observe whether the
 * real submission fired, without the crash risk a genuine window-level navigation attempt would
 * carry in this DOM harness — see `dom-test-setup.ts`'s own doc on why `dispatchEvent` itself is
 * never used directly on `globalThis` here. */
function stubFormSubmit(form: HTMLFormElement): { calls(): number } {
  let calls = 0
  form.submit = () => {
    calls++
  }
  return { calls: () => calls }
}

/** Resolves/rejects on demand — lets a test control exactly when `intercept`'s own promise
 * settles, to exercise the pending window a real `fetch()` would occupy. */
function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (e: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setUp(): void {
  resetDom()
}

Deno.test(
  "attachSubmitIntercept: 'handled' never navigates and re-enables the form's controls",
  async () => {
    setUp()
    const form = buildForm('si1')
    const submitStub = stubFormSubmit(form)
    const detach = attachSubmitIntercept({
      formId: 'si1',
      intercept: () => Promise.resolve('handled'),
    })

    const notPrevented = fireSubmit(form)
    assertFalse(notPrevented) // event.preventDefault() is unconditional

    // Let the microtask queue drain so intercept's own promise settles.
    await Promise.resolve()
    await Promise.resolve()

    assertEquals(submitStub.calls(), 0)
    const button = form.querySelector('button') as HTMLButtonElement
    assertFalse(button.disabled)
    detach()
  },
)

Deno.test(
  "attachSubmitIntercept: 'proceed' completes a real submission via form.submit()",
  async () => {
    setUp()
    const form = buildForm('si2')
    const submitStub = stubFormSubmit(form)
    const detach = attachSubmitIntercept({
      formId: 'si2',
      intercept: () => Promise.resolve('proceed'),
    })

    fireSubmit(form)
    await Promise.resolve()
    await Promise.resolve()

    assertEquals(submitStub.calls(), 1)
    detach()
  },
)

Deno.test(
  'attachSubmitIntercept: a REJECTED intercept promise falls back to a real submission, same as proceed',
  async () => {
    setUp()
    const form = buildForm('si3')
    const submitStub = stubFormSubmit(form)
    const detach = attachSubmitIntercept({
      formId: 'si3',
      intercept: () => Promise.reject(new Error('network down')),
    })

    fireSubmit(form)
    await Promise.resolve()
    await Promise.resolve()

    assertEquals(submitStub.calls(), 1)
    detach()
  },
)

Deno.test(
  'attachSubmitIntercept: disables submit controls immediately, synchronously, before intercept settles',
  () => {
    setUp()
    const form = buildForm('si4')
    const detach = attachSubmitIntercept({
      formId: 'si4',
      intercept: () => new Promise(() => {}), // never settles within this test
    })

    fireSubmit(form)

    const button = form.querySelector('button') as HTMLButtonElement
    assert(button.disabled)
    detach()
  },
)

Deno.test(
  'attachSubmitIntercept: a double-click while intercept is pending calls intercept only once',
  async () => {
    setUp()
    const form = buildForm('si5')
    let interceptCalls = 0
    const pending = deferred<'proceed'>()
    const detach = attachSubmitIntercept({
      formId: 'si5',
      intercept: () => {
        interceptCalls++
        return pending.promise
      },
    })

    fireSubmit(form)
    const secondNotPrevented = fireSubmit(form)
    assertFalse(secondNotPrevented) // still preventDefault'd — rejected outright

    pending.resolve('proceed')
    await Promise.resolve()
    await Promise.resolve()

    assertEquals(interceptCalls, 1)
    detach()
  },
)

Deno.test(
  'attachSubmitIntercept: a formId matching nothing on the page is a safe no-op',
  () => {
    setUp()
    const detach = attachSubmitIntercept({
      formId: 'does-not-exist',
      intercept: () => Promise.resolve('proceed'),
    })
    detach() // must not throw
  },
)

Deno.test(
  'attachSubmitIntercept: cleanup mid-flight re-enables controls it disabled',
  () => {
    setUp()
    const form = buildForm('si6')
    const detach = attachSubmitIntercept({
      formId: 'si6',
      intercept: () => new Promise(() => {}),
    })

    fireSubmit(form)
    const button = form.querySelector('button') as HTMLButtonElement
    assert(button.disabled)

    detach()

    assertFalse(button.disabled)
  },
)

Deno.test(
  'attachSubmitIntercept: reproduces the real login-two-step bug — SubmitGuard also mounted on ' +
    'the SAME form disables controls synchronously, yet a real, async-resolved "proceed" still ' +
    "completes the submission via form.submit(), never stuck by SubmitGuard's own disabled control",
  async () => {
    setUp()
    const form = buildForm('si7')
    const submitStub = stubFormSubmit(form)
    const pending = deferred<'proceed'>()

    // SubmitGuard mounted first, exactly like iam's `LoginView` mounting
    // `ManagedForm({ submitGuard: true })` on `#login-form` alongside this Comet.
    const detachGuard = attachSubmitGuard({ formId: 'si7' })
    const detachIntercept = attachSubmitIntercept({
      formId: 'si7',
      intercept: () => pending.promise,
    })

    fireSubmit(form)

    // SubmitGuard's own synchronous side effect already disabled the button — exactly the
    // precondition that broke the old `form.requestSubmit()`-based workaround.
    const button = form.querySelector('button') as HTMLButtonElement
    assert(button.disabled)
    assertEquals(submitStub.calls(), 0)

    // Real async work resolves well after the synchronous disable above — never instantaneous.
    await new Promise((resolve) => setTimeout(resolve, 0))
    pending.resolve('proceed')
    await Promise.resolve()
    await Promise.resolve()

    assertEquals(submitStub.calls(), 1)
    detachIntercept()
    detachGuard()
  },
)

/** Fires a `submit` carrying the pressed control the way a real browser's `SubmitEvent` does. */
function fireSubmitFrom(form: Element, submitter: Element | null): boolean {
  return form.dispatchEvent(
    Object.assign(new globals.Event('submit', { bubbles: true, cancelable: true }), { submitter }),
  )
}

/** Replaces `form.submit()` with a spy that records what the real submission would carry: the form
 * data (as the entry list a browser builds, without a submitter) and the form's own attributes. */
function spyFormSubmit(form: HTMLFormElement): { sent: Array<Record<string, unknown>> } {
  const sent: Array<Record<string, unknown>> = []
  form.submit = () => {
    sent.push({
      data: Object.fromEntries(new globals.FormData(form).entries()),
      action: form.getAttribute('action'),
      method: form.getAttribute('method'),
      enctype: form.getAttribute('enctype'),
      target: form.getAttribute('target'),
    })
  }
  return { sent }
}

const settle = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

Deno.test(
  "attachSubmitIntercept: 'proceed' sends the pressed control's name/value, and only that control's",
  async () => {
    setUp()
    const form = buildForm('si20', [{}, {}])
    const [first, second] = Array.from(form.querySelectorAll('button')) as HTMLButtonElement[]
    first.name = 'next'
    first.value = 'continue'
    second.name = 'next'
    second.value = 'edit'
    const spy = spyFormSubmit(form)
    const detach = attachSubmitIntercept({
      formId: 'si20',
      intercept: () => Promise.resolve('proceed'),
    })

    fireSubmitFrom(form, second)
    await settle()

    assertEquals(spy.sent.length, 1)
    assertEquals(spy.sent[0].data, { next: 'edit' })
    // Nothing is left behind on the form once the call returns.
    assertEquals(form.querySelectorAll('input[type="hidden"]').length, 0)
    detach()
  },
)

Deno.test(
  "attachSubmitIntercept: 'proceed' applies the pressed control's formaction/formmethod for the call only",
  async () => {
    setUp()
    const form = buildForm('si21', [{}])
    form.setAttribute('action', '/save')
    form.setAttribute('method', 'post')
    const button = form.querySelector('button') as HTMLButtonElement
    button.setAttribute('formaction', '/delete')
    button.setAttribute('formmethod', 'get')
    button.setAttribute('formtarget', '_blank')
    const spy = spyFormSubmit(form)
    const detach = attachSubmitIntercept({
      formId: 'si21',
      intercept: () => Promise.resolve('proceed'),
    })

    fireSubmitFrom(form, button)
    await settle()

    assertEquals(spy.sent[0].action, '/delete')
    assertEquals(spy.sent[0].method, 'get')
    assertEquals(spy.sent[0].target, '_blank')
    assertEquals(form.getAttribute('action'), '/save')
    assertEquals(form.getAttribute('method'), 'post')
    assertFalse(form.hasAttribute('target'))
    detach()
  },
)

Deno.test(
  'attachSubmitIntercept: a REJECTED intercept still submits as the pressed control',
  async () => {
    setUp()
    const form = buildForm('si22', [{}])
    const button = form.querySelector('button') as HTMLButtonElement
    button.name = 'next'
    button.value = 'edit'
    const spy = spyFormSubmit(form)
    const detach = attachSubmitIntercept({
      formId: 'si22',
      intercept: () => Promise.reject(new Error('network down')),
    })

    fireSubmitFrom(form, button)
    await settle()

    assertEquals(spy.sent[0].data, { next: 'edit' })
    detach()
  },
)

Deno.test(
  'attachSubmitIntercept: an unknown submitter submits the form as is',
  async () => {
    setUp()
    const form = buildForm('si23', [{}])
    const button = form.querySelector('button') as HTMLButtonElement
    button.name = 'next'
    button.value = 'edit'
    form.setAttribute('action', '/save')
    button.setAttribute('formaction', '/delete')
    const spy = spyFormSubmit(form)
    const detach = attachSubmitIntercept({
      formId: 'si23',
      intercept: () => Promise.resolve('proceed'),
    })

    fireSubmitFrom(form, null)
    await settle()

    assertEquals(spy.sent[0].data, {})
    assertEquals(spy.sent[0].action, '/save')
    detach()
  },
)

Deno.test(
  "attachSubmitIntercept: 'handled' leaves the form untouched whichever control was pressed",
  async () => {
    setUp()
    const form = buildForm('si24', [{}])
    const button = form.querySelector('button') as HTMLButtonElement
    button.name = 'next'
    button.value = 'edit'
    button.setAttribute('formaction', '/delete')
    const spy = spyFormSubmit(form)
    const detach = attachSubmitIntercept({
      formId: 'si24',
      intercept: () => Promise.resolve('handled'),
    })

    fireSubmitFrom(form, button)
    await settle()

    assertEquals(spy.sent.length, 0)
    assertFalse(form.hasAttribute('action'))
    detach()
  },
)
