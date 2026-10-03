import { installTimerMock, resetDom } from '../../unit/comets/dom-test-setup.ts'
import { assertEquals } from '@std/assert'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { FormDraftPersistence } from 'modules/comets/form-draft-persistence-react.tsx'
import { ManagedForm } from 'modules/comets/managed-form-react.tsx'
import { DRAFT_RESTORE_TIMEOUT_MS, forgetDraftValues } from 'modules/comets/draft-restoring.ts'
import { restoreDraftValue } from 'modules/comets/form-draft-persistence.ts'

/**
 * The React half of `draft-restoring-client.test.tsx`: the restoring marker (`data-draft-restoring`)
 * is rendered while a render that follows a failed submit restores, and removed once the form's own
 * fields — and, with `awaitValues`, each controlled value — are back. React needs a `window` and its
 * act environment flag to run effects under a simulated DOM.
 *
 * @module
 */

// deno-lint-ignore no-explicit-any
const globals = globalThis as any
globals.window = globalThis
globals.IS_REACT_ACT_ENVIRONMENT = true

const MARKER = '[data-draft-restoring]'

function mount(id: string): { container: HTMLElement; form: HTMLFormElement; root: Root } {
  resetDom()
  const form = globals.document.createElement('form')
  form.id = id
  const field = globals.document.createElement('input')
  field.name = 'title'
  form.appendChild(field)
  const container = globals.document.createElement('div')
  globals.document.body.appendChild(form)
  globals.document.body.appendChild(container)
  return { container, form, root: createRoot(container) }
}

function submitSnapshot(key: string, snapshot: unknown): void {
  globals.sessionStorage.setItem(`zn-space:${key}:submitted`, JSON.stringify(snapshot))
}

Deno.test('FormDraftPersistence (react client): the marker is gone once the form has restored its own fields', async () => {
  const { container, form, root } = mount('rc1')
  submitSnapshot('rc1', { title: 'typed before the failure' })

  await act(() => {
    root.render(
      createElement(FormDraftPersistence, {
        formId: 'rc1',
        storageKey: 'rc1',
        hasServerValues: false,
        returnedFromFailure: true,
      }),
    )
  })

  assertEquals(container.querySelector(MARKER), null)
  assertEquals(
    (form.elements.namedItem('title') as HTMLInputElement).value,
    'typed before the failure',
  )
  await act(() => root.unmount())
})

Deno.test('FormDraftPersistence (react client): with awaitValues the marker stays until each controlled value has restored', async () => {
  const { container, root } = mount('rc2')
  const picked = 'rc2/picked'
  submitSnapshot(picked, { id: 'p1' })

  await act(() => {
    root.render(
      createElement(FormDraftPersistence, {
        formId: 'rc2',
        storageKey: 'rc2',
        hasServerValues: false,
        returnedFromFailure: true,
        awaitValues: [picked],
      }),
    )
  })
  assertEquals(container.querySelector(MARKER)?.getAttribute('data-draft-restoring'), 'rc2')

  const restored: unknown[] = []
  await act(() => {
    restoreDraftValue((value) => restored.push(value), {
      storageKey: picked,
      formId: 'rc2',
      hasServerValues: false,
      returnedFromFailure: true,
    })
  })

  assertEquals(restored, [{ id: 'p1' }])
  assertEquals(container.querySelector(MARKER), null)
  await act(() => root.unmount())
})

Deno.test('FormDraftPersistence (react client): a controlled value that never hydrates cannot hold the form past the timeout', async () => {
  const { container, root } = mount('rc3')
  const timers = installTimerMock()
  try {
    await act(() => {
      root.render(
        createElement(FormDraftPersistence, {
          formId: 'rc3',
          storageKey: 'rc3',
          hasServerValues: false,
          returnedFromFailure: true,
          awaitValues: ['rc3/never'],
        }),
      )
    })
    assertEquals(container.querySelector(MARKER)?.getAttribute('data-draft-restoring'), 'rc3')

    await act(() => timers.advance(DRAFT_RESTORE_TIMEOUT_MS))

    assertEquals(container.querySelector(MARKER), null)
  } finally {
    timers.restore()
    await act(() => root.unmount())
    forgetDraftValues('rc3')
  }
})

Deno.test('FormDraftPersistence (react client): server values or a render that is not a failure never show the marker', async () => {
  for (
    const props of [
      { hasServerValues: true, returnedFromFailure: true },
      { hasServerValues: false, returnedFromFailure: false },
      { hasServerValues: false },
    ]
  ) {
    const { container, root } = mount('rc4')
    // deno-lint-ignore no-await-in-loop
    await act(() => {
      root.render(
        createElement(FormDraftPersistence, { formId: 'rc4', storageKey: 'rc4', ...props }),
      )
    })
    assertEquals(container.querySelector(MARKER), null)
    // deno-lint-ignore no-await-in-loop
    await act(() => root.unmount())
  }
})

Deno.test('ManagedForm (react client): the marker follows its draft, and a form without one never has it', async () => {
  const { container, form, root } = mount('rc5')
  submitSnapshot('rc5', { title: 'managed' })

  await act(() => {
    root.render(
      createElement(ManagedForm, {
        formId: 'rc5',
        draft: { storageKey: 'rc5', hasServerValues: false, returnedFromFailure: true },
        submitGuard: true,
      }),
    )
  })
  assertEquals(container.querySelector(MARKER), null)
  assertEquals((form.elements.namedItem('title') as HTMLInputElement).value, 'managed')

  await act(() => {
    root.render(createElement(ManagedForm, { formId: 'rc5', submitGuard: true }))
  })
  assertEquals(container.querySelector(MARKER), null)
  await act(() => root.unmount())
})
