import { installTimerMock, resetDom } from '../../unit/comets/dom-test-setup.ts'
import { assertEquals } from '@std/assert'
import { createElement, render } from 'preact'
import { act } from 'preact/test-utils'
import { FormDraftPersistence } from 'modules/comets/form-draft-persistence-preact.tsx'
import { ManagedForm } from 'modules/comets/managed-form-preact.tsx'
import { DRAFT_RESTORE_TIMEOUT_MS, forgetDraftValues } from 'modules/comets/draft-restoring.ts'
import { persistDraftValue, restoreDraftValue } from 'modules/comets/form-draft-persistence.ts'

/**
 * The client half of the restoring marker (`data-draft-restoring`): rendered while a render that
 * follows a failed submit restores, removed once the form's own fields are back and, with
 * `awaitValues`, once each controlled value is back too. The server half is covered by
 * `form-draft-persistence-comet.test.tsx`/`managed-form-comet.test.tsx`; `act` flushes the effects
 * a browser runs after hydration, which a real `useEffect` needs in order to run at all here.
 *
 * @module
 */

// deno-lint-ignore no-explicit-any
const globals = globalThis as any

const MARKER = '[data-draft-restoring]'

function mount(id: string): { container: HTMLElement; form: HTMLFormElement } {
  resetDom()
  const form = globals.document.createElement('form')
  form.id = id
  const field = globals.document.createElement('input')
  field.name = 'title'
  form.appendChild(field)
  const container = globals.document.createElement('div')
  globals.document.body.appendChild(form)
  globals.document.body.appendChild(container)
  return { container, form }
}

function submitSnapshot(key: string, snapshot: unknown): void {
  globals.sessionStorage.setItem(`zn-space:${key}:submitted`, JSON.stringify(snapshot))
}

Deno.test('FormDraftPersistence (client): the marker is gone once the form has restored its own fields', async () => {
  const { container, form } = mount('c1')
  submitSnapshot('c1', { title: 'typed before the failure' })

  await act(() =>
    render(
      createElement(FormDraftPersistence, {
        formId: 'c1',
        storageKey: 'c1',
        hasServerValues: false,
        returnedFromFailure: true,
      }),
      container,
    )
  )

  assertEquals(container.querySelector(MARKER), null)
  assertEquals(
    (form.elements.namedItem('title') as HTMLInputElement).value,
    'typed before the failure',
  )
  render(null, container)
})

Deno.test('FormDraftPersistence (client): with awaitValues the marker stays until each controlled value has restored', async () => {
  const { container, form } = mount('c2')
  submitSnapshot('c2', { title: 'typed' })
  const picked = 'c2/picked'
  submitSnapshot(picked, { id: 'p1' })

  await act(() =>
    render(
      createElement(FormDraftPersistence, {
        formId: 'c2',
        storageKey: 'c2',
        hasServerValues: false,
        returnedFromFailure: true,
        awaitValues: [picked],
      }),
      container,
    )
  )
  // The form's own fields are back; its controlled value has not restored yet.
  assertEquals((form.elements.namedItem('title') as HTMLInputElement).value, 'typed')
  assertEquals(container.querySelector(MARKER)?.getAttribute('data-draft-restoring'), 'c2')

  const restored: unknown[] = []
  await act(() => {
    restoreDraftValue((value) => restored.push(value), {
      storageKey: picked,
      formId: 'c2',
      hasServerValues: false,
      returnedFromFailure: true,
    })
  })

  assertEquals(restored, [{ id: 'p1' }])
  assertEquals(container.querySelector(MARKER), null)
  render(null, container)
})

Deno.test('FormDraftPersistence (client): a controlled value that never hydrates cannot hold the form past the timeout', async () => {
  const { container } = mount('c3')
  const timers = installTimerMock()
  try {
    await act(() =>
      render(
        createElement(FormDraftPersistence, {
          formId: 'c3',
          storageKey: 'c3',
          hasServerValues: false,
          returnedFromFailure: true,
          awaitValues: ['c3/never'],
        }),
        container,
      )
    )
    assertEquals(container.querySelector(MARKER)?.getAttribute('data-draft-restoring'), 'c3')

    await act(() => timers.advance(DRAFT_RESTORE_TIMEOUT_MS))

    assertEquals(container.querySelector(MARKER), null)
  } finally {
    timers.restore()
    render(null, container)
    forgetDraftValues('c3')
  }
})

Deno.test('FormDraftPersistence (client): server values or a render that is not a failure never show the marker', async () => {
  for (
    const props of [
      { hasServerValues: true, returnedFromFailure: true },
      { hasServerValues: false, returnedFromFailure: false },
      { hasServerValues: false },
    ]
  ) {
    const { container } = mount('c4')
    // deno-lint-ignore no-await-in-loop
    await act(() =>
      render(
        createElement(FormDraftPersistence, { formId: 'c4', storageKey: 'c4', ...props }),
        container,
      )
    )
    assertEquals(container.querySelector(MARKER), null)
    render(null, container)
  }
})

Deno.test('ManagedForm (client): the marker follows its draft, and a form without one never has it', async () => {
  const { container, form } = mount('c5')
  submitSnapshot('c5', { title: 'managed' })

  await act(() =>
    render(
      createElement(ManagedForm, {
        formId: 'c5',
        draft: { storageKey: 'c5', hasServerValues: false, returnedFromFailure: true },
        submitGuard: true,
      }),
      container,
    )
  )
  assertEquals(container.querySelector(MARKER), null)
  assertEquals((form.elements.namedItem('title') as HTMLInputElement).value, 'managed')
  render(null, container)

  await act(() =>
    render(createElement(ManagedForm, { formId: 'c5', submitGuard: true }), container)
  )
  assertEquals(container.querySelector(MARKER), null)
  render(null, container)
})

Deno.test('a controlled value of a form restores on the next visit only after a failure, never after a success', () => {
  const { form } = mount('c6')
  const timers = installTimerMock()
  try {
    persistDraftValue({ id: 'p9' }, {
      storageKey: 'c6/picked',
      formId: 'c6',
      returnedFromFailure: false,
    })
    form.dispatchEvent(new globals.Event('submit', { bubbles: true, cancelable: true }))

    const afterSuccess: unknown[] = []
    restoreDraftValue((value) => afterSuccess.push(value), {
      storageKey: 'c6/picked',
      formId: 'c6',
      hasServerValues: false,
      returnedFromFailure: false,
    })

    assertEquals(afterSuccess, [])
  } finally {
    timers.restore()
    forgetDraftValues('c6')
  }
})
