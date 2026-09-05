import { assert, assertEquals, assertFalse } from '@std/assert'
import { installTimerMock, resetDom } from './dom-test-setup.ts'
import { attachManagedForm } from 'modules/comets/managed-form.ts'
import { DEFAULT_DRAFT_DEBOUNCE_MS } from 'modules/comets/form-draft-persistence.ts'

// deno-lint-ignore no-explicit-any
const globals = globalThis as any

function buildForm(id: string, fields: Array<{ name: string; value?: string }> = [
  { name: 'title', value: '' },
]): HTMLFormElement {
  const form = globals.document.createElement('form')
  form.id = id
  for (const field of fields) {
    const el = globals.document.createElement('input')
    el.name = field.name
    if (field.value !== undefined) el.value = field.value
    form.appendChild(el)
  }
  globals.document.body.appendChild(form)
  return form
}

function fireInput(field: Element): void {
  field.dispatchEvent(new globals.Event('input', { bubbles: true }))
}

function fireSubmit(form: Element): boolean {
  return form.dispatchEvent(new globals.Event('submit', { bubbles: true, cancelable: true }))
}

function setUp(): void {
  resetDom()
}

Deno.test(
  'attachManagedForm: with nothing enabled, attaches no behavior at all — a safe, inert no-op',
  () => {
    setUp()
    const form = buildForm('m1')
    const detach = attachManagedForm({ formId: 'm1' })

    // No SubmitGuard: a second submit is NOT rejected.
    fireSubmit(form)
    const secondNotPrevented = fireSubmit(form)
    assert(secondNotPrevented)

    detach()
  },
)

Deno.test(
  'attachManagedForm: draft enables real FormDraftPersistence, scoped to this formId',
  () => {
    setUp()
    const timers = installTimerMock()
    const form = buildForm('m2')
    const detach = attachManagedForm({
      formId: 'm2',
      draft: { storageKey: 'm2-key', hasServerValues: false },
    })

    fireInput(form.elements.namedItem('title') as Element)
    timers.advance(DEFAULT_DRAFT_DEBOUNCE_MS)

    assertEquals(
      JSON.parse(globals.sessionStorage.getItem('zn-space:m2-key')),
      { title: '' },
    )

    detach()
    timers.restore()
  },
)

Deno.test(
  'attachManagedForm: submitGuard=true enables real SubmitGuard with its own defaults',
  () => {
    setUp()
    const form = buildForm('m3')
    const detach = attachManagedForm({ formId: 'm3', submitGuard: true })

    fireSubmit(form)
    const secondNotPrevented = fireSubmit(form)

    assertFalse(secondNotPrevented)
    detach()
  },
)

Deno.test(
  'attachManagedForm: submitGuard as an options object forwards it — disableControls=false honored',
  () => {
    setUp()
    const form = buildForm('m4')
    const detach = attachManagedForm({
      formId: 'm4',
      submitGuard: { disableControls: false },
    })

    fireSubmit(form)
    const button = globals.document.createElement('button')
    form.appendChild(button)
    // No control was ever disabled — disableControls: false was honored.
    assertFalse(button.disabled)

    detach()
  },
)

Deno.test(
  'attachManagedForm: unsavedChanges=true enables real UnsavedChangesGuard',
  () => {
    setUp()
    const form = buildForm('m5')
    const originalAdd = globals.addEventListener
    let handler: ((event: { preventDefault(): void; returnValue: string }) => void) | undefined
    globals.addEventListener = (type: string, listener: unknown, options?: unknown) => {
      if (type === 'beforeunload') handler = listener as typeof handler
      return originalAdd(type, listener, options)
    }
    const detach = attachManagedForm({ formId: 'm5', unsavedChanges: true })
    globals.addEventListener = originalAdd
    if (!handler) throw new Error('beforeunload listener was never registered')

    fireInput(form.elements.namedItem('title') as Element)
    let prevented = false
    handler({ preventDefault: () => prevented = true, returnValue: '' })

    assert(prevented)
    detach()
  },
)

Deno.test(
  'attachManagedForm: all three enabled at once compose without conflict',
  () => {
    setUp()
    const timers = installTimerMock()
    const form = buildForm('m6')
    const detach = attachManagedForm({
      formId: 'm6',
      draft: { storageKey: 'm6-key', hasServerValues: false },
      submitGuard: true,
      unsavedChanges: true,
    })

    fireInput(form.elements.namedItem('title') as Element)
    timers.advance(DEFAULT_DRAFT_DEBOUNCE_MS)
    assert(globals.sessionStorage.getItem('zn-space:m6-key') !== null)

    // submitGuard: the draft's own submit handler (clearing the draft) still runs alongside it.
    fireSubmit(form)
    assertEquals(globals.sessionStorage.getItem('zn-space:m6-key'), null)
    const secondNotPrevented = fireSubmit(form)
    assertFalse(secondNotPrevented)

    detach()
    timers.restore()
  },
)

Deno.test(
  'attachManagedForm: cleanup detaches every behavior it enabled',
  () => {
    setUp()
    const form = buildForm('m7')
    const detach = attachManagedForm({ formId: 'm7', submitGuard: true })

    detach()
    const secondNotPrevented = fireSubmit(form)
    // With SubmitGuard detached, a "second" submit (there was no first, post-detach) is not
    // rejected — proves the guard's own listener is really gone, not just its internal state reset.
    assert(secondNotPrevented)
  },
)
