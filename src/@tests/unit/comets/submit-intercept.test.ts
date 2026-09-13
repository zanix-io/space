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
