import { installTimerMock, resetDom } from '../../unit/comets/dom-test-setup.ts'
import { assert, assertEquals } from '@std/assert'
import { createElement, render } from 'preact'
import { act } from 'preact/test-utils'
import { ManagedForm } from 'modules/comets/managed-form-preact.tsx'
import { DRAFT_RESTORE_TIMEOUT_MS, forgetDraftValues } from 'modules/comets/draft-restoring.ts'
import { restoreDraftValue } from 'modules/comets/form-draft-persistence.ts'

/**
 * The client half of `ManagedForm`'s `focusFirstInvalid` under Preact: what a form the server
 * rendered with `aria-invalid` controls does once its comet hydrates. The primitive itself is
 * covered by `unit/comets/focus-first-invalid.test.ts`; `act` flushes the effects a browser runs
 * after hydration, and a real zero-delay wait lets the single scheduled focus run happen.
 *
 * @module
 */

// deno-lint-ignore no-explicit-any
const globals = globalThis as any

const flush = () => new Promise((resolve) => setTimeout(resolve, 5))

function focusedName(): string | undefined {
  return (globals.document.activeElement as HTMLInputElement | null)?.name || undefined
}

/** A form with a clean `title` and an `email` the server marked invalid, plus a place for the comet. */
function mount(id: string): { container: HTMLElement; form: HTMLFormElement } {
  resetDom()
  const form = globals.document.createElement('form')
  form.id = id
  for (const [name, invalid] of [['title', false], ['email', true]] as const) {
    const field = globals.document.createElement('input')
    field.name = name
    if (invalid) field.setAttribute('aria-invalid', 'true')
    form.appendChild(field)
  }
  const container = globals.document.createElement('div')
  globals.document.body.appendChild(form)
  globals.document.body.appendChild(container)
  return { container, form }
}

Deno.test('ManagedForm (preact client): focusFirstInvalid focuses the first invalid control once the comet hydrated', async () => {
  const { container } = mount('pf1')

  await act(() =>
    render(createElement(ManagedForm, { formId: 'pf1', focusFirstInvalid: true }), container)
  )
  await flush()

  assertEquals(focusedName(), 'email')
  render(null, container)
})

Deno.test('ManagedForm (preact client): without the option the focus is left alone', async () => {
  const { container } = mount('pf2')

  await act(() => render(createElement(ManagedForm, { formId: 'pf2' }), container))
  await flush()

  assertEquals(focusedName(), undefined)
  render(null, container)
})

Deno.test('ManagedForm (preact client): a re-render with the same props does not move the focus again', async () => {
  const { container, form } = mount('pf3')
  const element = () => createElement(ManagedForm, { formId: 'pf3', focusFirstInvalid: true })

  await act(() => render(element(), container))
  await flush()
  assertEquals(focusedName(), 'email')
  ;(form.elements.namedItem('title') as HTMLInputElement).focus()
  await act(() => render(element(), container))
  await flush()

  assertEquals(focusedName(), 'title')
  render(null, container)
})

Deno.test('ManagedForm (preact client): a form that arrives later, as an Orbit swap does, is focused by its own mount', async () => {
  const first = mount('pf4')
  await act(() =>
    render(createElement(ManagedForm, { formId: 'pf4', focusFirstInvalid: true }), first.container)
  )
  await flush()
  assertEquals(focusedName(), 'email')
  render(null, first.container)

  // The outlet is replaced: a fresh form with its own error and a fresh comet mount.
  const second = mount('pf4b')
  await act(() =>
    render(
      createElement(ManagedForm, { formId: 'pf4b', focusFirstInvalid: true }),
      second.container,
    )
  )
  await flush()

  assertEquals(focusedName(), 'email')
  assert(globals.document.activeElement?.closest('form')?.id === 'pf4b')
  render(null, second.container)
})

Deno.test('ManagedForm (preact client): a form that restores a draft is focused only after its controlled value is back', async () => {
  const { container, form } = mount('pf5')
  globals.sessionStorage.setItem('zn-space:pf5:submitted', JSON.stringify({ title: 'kept' }))
  const picked = 'pf5/picked'
  globals.sessionStorage.setItem(`zn-space:${picked}:submitted`, JSON.stringify({ id: 'p1' }))
  forgetDraftValues('pf5')

  await act(() =>
    render(
      createElement(ManagedForm, {
        formId: 'pf5',
        draft: {
          storageKey: 'pf5',
          hasServerValues: false,
          returnedFromFailure: true,
          awaitValues: [picked],
        },
        focusFirstInvalid: true,
      }),
      container,
    )
  )
  await flush()
  // The form's own fields are back, the controlled value is not, and the focus has not moved.
  assertEquals((form.elements.namedItem('title') as HTMLInputElement).value, 'kept')
  assertEquals(focusedName(), undefined)
  assert(container.querySelector('[data-draft-restoring]'))

  await act(() => {
    restoreDraftValue(() => {}, {
      storageKey: picked,
      formId: 'pf5',
      hasServerValues: false,
      returnedFromFailure: true,
    })
  })
  await flush()

  assertEquals(focusedName(), 'email')
  assertEquals(container.querySelector('[data-draft-restoring]'), null)
  render(null, container)
})

Deno.test('ManagedForm (preact client): a controlled value that never reports does not hold the focus past the restore timeout', async () => {
  const { container } = mount('pf6')
  globals.sessionStorage.setItem('zn-space:pf6:submitted', JSON.stringify({ title: 'kept' }))
  forgetDraftValues('pf6')
  const timers = installTimerMock()

  try {
    await act(() =>
      render(
        createElement(ManagedForm, {
          formId: 'pf6',
          draft: {
            storageKey: 'pf6',
            hasServerValues: false,
            returnedFromFailure: true,
            awaitValues: ['pf6/never'],
          },
          focusFirstInvalid: true,
        }),
        container,
      )
    )
    timers.advance(DRAFT_RESTORE_TIMEOUT_MS - 1)
    assertEquals(focusedName(), undefined)

    await act(() => timers.advance(1))
    timers.advance(0)
    assertEquals(focusedName(), 'email')
  } finally {
    timers.restore()
  }
  render(null, container)
})
