import { assert, assertEquals, assertFalse } from '@std/assert'
import { resetDom } from './dom-test-setup.ts'
import {
  attachValidateInline,
  FALLBACK_MESSAGE,
  FORM_INVALID_EVENT,
} from 'modules/comets/validate-inline.ts'
import type { FormInvalidDetail } from 'modules/comets/validate-inline.ts'
import { attachManagedForm } from 'modules/comets/managed-form.ts'
import { attachClearInvalidOnInput } from 'modules/comets/clear-invalid-on-input.ts'
import { dispatchDraftRestoreEvent } from 'modules/comets/draft-restore-event.ts'

// deno-lint-ignore no-explicit-any
const globals = globalThis as any

type El = HTMLElement

/** Builds a form from an HTML string, the way the server renders it, and mounts it. */
function mount(id: string, html: string): HTMLFormElement {
  resetDom()
  const form = globals.document.createElement('form')
  form.id = id
  form.innerHTML = html
  globals.document.body.appendChild(form)
  return form
}

const $ = (form: Element, selector: string) => form.querySelector(selector) as El

function fire(el: Element, type: string): void {
  el.dispatchEvent(new globals.Event(type, { bubbles: true, cancelable: true }))
}

/** Dispatches a cancelable `submit`; returns whether it was left uncancelled. */
function submit(form: Element, submitter?: unknown): boolean {
  const event = new globals.Event('submit', { bubbles: true, cancelable: true })
  if (submitter) event.submitter = submitter
  form.dispatchEvent(event)
  return !event.defaultPrevented
}

/** A `Field`-shaped control: `<div data-space-ui="field" id="f">` with the control at `f-input`. */
function field(id: string, control: string, extra = '', attrs = ''): string {
  return `<div id="${id}" data-space-ui="field" ${attrs}><label for="${id}-input">L</label>` +
    control + extra + `</div>`
}

const REQUIRED = (id: string, extra = '') =>
  `<input id="${id}-input" name="${id}" required ${extra}>`

Deno.test('validateInline: marks the form noValidate and restores it on cleanup', () => {
  const form = mount('v0', REQUIRED('a'))
  assertFalse(form.noValidate)
  const detach = attachValidateInline({ formId: 'v0' })
  assert(form.noValidate)
  detach()
  assertFalse(form.noValidate)
})

Deno.test('validateInline: an empty required input cancels the submit and is marked and described', () => {
  const form = mount('v1', field('a', REQUIRED('a', 'data-message-required="Name it"')))
  const detach = attachValidateInline({ formId: 'v1' })
  const input = $(form, '#a-input')
  assertFalse(submit(form))
  assertEquals(input.getAttribute('aria-invalid'), 'true')
  assertEquals(input.getAttribute('aria-describedby'), 'a-error')
  const error = $(form, '#a-error')
  assertEquals(error.getAttribute('data-space-ui'), 'alert')
  assert(error.parentElement === $(form, '#a'), 'the error sits in the Field container')
  assert(globals.document.activeElement === input, 'the focus moves to the control')
  detach()
})

Deno.test('validateInline: the message is the Field-level data-message-required, then the form default', () => {
  const form = mount(
    'v2',
    field('a', REQUIRED('a'), '', 'data-message-required="Field text"') + REQUIRED('b'),
  )
  form.setAttribute('data-message-required', 'Form text')
  const detach = attachValidateInline({ formId: 'v2' })
  submit(form)
  assertEquals($(form, '#a-error').textContent, 'Field text')
  assertEquals($(form, '#b-error').textContent, 'Form text')
  detach()
})

Deno.test('validateInline: the message depends on the failure; data-validation-message covers the rest', () => {
  const form = mount(
    'v3',
    `<input id="e-input" type="email" value="nope" data-message-type-mismatch="Bad email" data-validation-message="Generic">` +
      `<input id="p-input" pattern="[0-9]+" value="x" data-validation-message="Generic">`,
  )
  const detach = attachValidateInline({ formId: 'v3' })
  submit(form)
  assertEquals($(form, '#e-error').textContent, 'Bad email')
  assertEquals($(form, '#p-error').textContent, 'Generic')
  detach()
})

Deno.test('validateInline: a custom validity keeps its own message over any data-* one', () => {
  const form = mount('v4', REQUIRED('a', 'data-validation-message="Generic" value="x"'))
  const input = $(form, '#a-input') as unknown as HTMLInputElement
  input.setCustomValidity('Taken')
  const detach = attachValidateInline({ formId: 'v4' })
  submit(form)
  assertEquals($(form, '#a-error').textContent, 'Taken')
  detach()
})

Deno.test("validateInline: with no data-* message the control's own validationMessage is used", () => {
  const form = mount('v5', REQUIRED('a'))
  Object.defineProperty($(form, '#a-input'), 'validationMessage', { value: 'Browser text' })
  const detach = attachValidateInline({ formId: 'v5' })
  submit(form)
  assertEquals($(form, '#a-error').textContent, 'Browser text')
  detach()
})

Deno.test('validateInline: several invalid fields are all marked, the first one in the page is focused', () => {
  const form = mount(
    'v6',
    field('a', REQUIRED('a')) + field('b', '<input id="b-input" value="ok">') +
      field('c', REQUIRED('c')),
  )
  const detach = attachValidateInline({ formId: 'v6' })
  assertFalse(submit(form))
  assertEquals($(form, '#a-input').getAttribute('aria-invalid'), 'true')
  assertEquals($(form, '#c-input').getAttribute('aria-invalid'), 'true')
  assertFalse($(form, '#b-input').hasAttribute('aria-invalid'))
  assertEquals($(form, '#b').querySelector('[data-space-ui=alert]'), null)
  assert(globals.document.activeElement === $(form, '#a-input'))
  detach()
})

Deno.test("validateInline: the focused control's error has no role, the others are polite", () => {
  const form = mount('v7', field('a', REQUIRED('a')) + field('c', REQUIRED('c')))
  const detach = attachValidateInline({ formId: 'v7' })
  submit(form)
  assertFalse($(form, '#a-error').hasAttribute('role'))
  assertEquals($(form, '#c-error').getAttribute('role'), 'status')
  detach()
})

Deno.test('validateInline: a valid form is submitted and nothing is marked', () => {
  const form = mount('v8', field('a', REQUIRED('a', 'value="x"')))
  const detach = attachValidateInline({ formId: 'v8' })
  assert(submit(form))
  assertFalse($(form, '#a-input').hasAttribute('aria-invalid'))
  assertEquals($(form, '[data-space-ui=alert]'), null)
  detach()
})

Deno.test('validateInline: a submit control with formnovalidate skips the check', () => {
  const form = mount('v9', REQUIRED('a'))
  const detach = attachValidateInline({ formId: 'v9' })
  assert(submit(form, { formNoValidate: true }))
  assertEquals($(form, '[data-space-ui=alert]'), null)
  detach()
})

Deno.test('validateInline: correcting the field clears the mark and the error', () => {
  const form = mount(
    'v10',
    field('a', REQUIRED('a', 'aria-describedby="a-hint"'), '<p id="a-hint">h</p>'),
  )
  const detach = attachValidateInline({ formId: 'v10' })
  const input = $(form, '#a-input') as unknown as HTMLInputElement
  submit(form)
  assertEquals(input.getAttribute('aria-describedby'), 'a-hint a-error')
  input.value = 'ok'
  fire(input, 'input')
  assertFalse(input.hasAttribute('aria-invalid'))
  assertEquals(input.getAttribute('aria-describedby'), 'a-hint')
  assertEquals($(form, '#a-error'), null)
  detach()
})

Deno.test('validateInline: while still invalid, an edit refreshes the message and keeps the error', () => {
  const form = mount(
    'v11',
    `<input id="a-input" type="email" required data-message-required="Need it" data-message-type-mismatch="Not an email">`,
  )
  const detach = attachValidateInline({ formId: 'v11' })
  const input = $(form, '#a-input') as unknown as HTMLInputElement
  submit(form)
  assertEquals($(form, '#a-error').textContent, 'Need it')
  input.value = 'abc'
  fire(input, 'input')
  assertEquals($(form, '#a-error').textContent, 'Not an email')
  assertEquals(input.getAttribute('aria-invalid'), 'true')
  detach()
})

Deno.test('validateInline: leaving an edited field validates it; leaving an untouched one does not', () => {
  const form = mount('v12', field('a', REQUIRED('a')) + field('b', REQUIRED('b')))
  const detach = attachValidateInline({ formId: 'v12' })
  const a = $(form, '#a-input') as unknown as HTMLInputElement
  fire($(form, '#b-input'), 'focusout')
  assertEquals($(form, '#b-error'), null, 'an untouched field is left alone')
  a.value = 'x'
  fire(a, 'input')
  a.value = ''
  fire(a, 'input')
  assertEquals($(form, '#a-error'), null, 'no error while typing')
  fire(a, 'focusout')
  assertEquals(a.getAttribute('aria-invalid'), 'true')
  assertEquals($(form, '#a-error').getAttribute('role'), 'status')
  detach()
})

Deno.test('validateInline: the events a draft restore dispatches do not count as an edit', () => {
  const form = mount('v13', field('a', REQUIRED('a')))
  const detach = attachValidateInline({ formId: 'v13' })
  dispatchDraftRestoreEvent($(form, '#a-input'), 'input')
  fire($(form, '#a-input'), 'focusout')
  assertEquals($(form, '#a-error'), null)
  detach()
})

Deno.test('validateInline: a server error already in the page is reused, not duplicated', () => {
  const form = mount(
    'v14',
    field(
      'a',
      REQUIRED('a', 'aria-invalid="true" aria-describedby="a-error"'),
      '<div id="a-error" role="alert" data-space-ui="alert">Server says no</div>',
      'data-message-required="Client says no"',
    ),
  )
  const detach = attachValidateInline({ formId: 'v14' })
  submit(form)
  assertEquals(form.querySelectorAll('#a-error').length, 1)
  assertEquals($(form, '#a-error').textContent, 'Client says no')
  assertEquals($(form, '#a-input').getAttribute('aria-describedby'), 'a-error')
  detach()
  assert($(form, '#a-error'), 'a server element is never removed')
})

Deno.test('validateInline: an already server-invalid control that passes validation is left alone', () => {
  const form = mount(
    'v15',
    field(
      'a',
      REQUIRED('a', 'value="x" aria-invalid="true" aria-describedby="a-error"'),
      '<div id="a-error" role="alert" data-space-ui="alert">Server says no</div>',
    ),
  )
  const detach = attachValidateInline({ formId: 'v15' })
  assert(submit(form), 'only constraint validation cancels a submit')
  assertEquals($(form, '#a-input').getAttribute('aria-invalid'), 'true')
  assertFalse($(form, '#a-error').hasAttribute('hidden'))
  detach()
})

Deno.test('validateInline: the hint stays in aria-describedby next to the error', () => {
  const form = mount(
    'v16',
    field('a', REQUIRED('a', 'aria-describedby="a-hint"'), '<p id="a-hint">h</p>'),
  )
  const detach = attachValidateInline({ formId: 'v16' })
  submit(form)
  assertEquals($(form, '#a-input').getAttribute('aria-describedby'), 'a-hint a-error')
  detach()
})

Deno.test('validateInline: a control without a Field gets the error right after it, with an id of its own', () => {
  const form = mount('v17', '<input name="n" required><input id="solo" required>')
  const detach = attachValidateInline({ formId: 'v17' })
  submit(form)
  const first = $(form, '[name=n]')
  const id = first.getAttribute('aria-describedby') ?? ''
  assert(id.endsWith('-error'))
  assert(first.nextElementSibling === $(form, `#${id}`))
  assert($(form, '#solo').nextElementSibling === $(form, '#solo-error'))
  detach()
})

Deno.test('validateInline: a required radio group is one control: one error, every radio marked', () => {
  const form = mount(
    'v18',
    `<div id="g" data-space-ui="field"><input type="radio" id="g-input" name="r" value="1" required>` +
      `<input type="radio" name="r" value="2" required></div>`,
  )
  const detach = attachValidateInline({ formId: 'v18' })
  submit(form)
  assertEquals(form.querySelectorAll('[data-space-ui=alert]').length, 1)
  for (const radio of form.querySelectorAll('[name=r]')) {
    assertEquals(radio.getAttribute('aria-invalid'), 'true')
  }
  const second = form.querySelectorAll('[name=r]')[1] as unknown as HTMLInputElement
  second.checked = true
  fire(second, 'change')
  assertEquals(form.querySelectorAll('[aria-invalid]').length, 0)
  assertEquals($(form, '[data-space-ui=alert]'), null)
  detach()
})

Deno.test('validateInline: a composed control marked data-value-missing is invalid and its trigger is marked', () => {
  const form = mount(
    'v19',
    `<div id="s" data-space-ui="field" data-message-required="Pick one"><label for="s-input">L</label>` +
      `<span data-value-missing="true"><button type="button" id="s-input">Choose</button></span></div>`,
  )
  const detach = attachValidateInline({ formId: 'v19' })
  assertFalse(submit(form))
  const trigger = $(form, '#s-input')
  assertEquals(trigger.getAttribute('aria-invalid'), 'true')
  assertEquals(trigger.getAttribute('aria-describedby'), 's-error')
  assertEquals($(form, '#s-error').textContent, 'Pick one')
  detach()
})

Deno.test('validateInline: a composed radiogroup carries aria-invalid itself and clears after the value arrives', async () => {
  const form = mount(
    'v20',
    `<div id="g" data-space-ui="field"><div id="g-input" role="radiogroup" data-value-missing="true">` +
      `<button type="button" role="radio">A</button></div></div>`,
  )
  const detach = attachValidateInline({ formId: 'v20' })
  submit(form)
  const group = $(form, '#g-input')
  assertEquals(group.getAttribute('aria-invalid'), 'true')
  assertEquals($(form, '#g-error').textContent, FALLBACK_MESSAGE)
  fire(group, 'change')
  group.removeAttribute('data-value-missing')
  assertEquals(
    group.getAttribute('aria-invalid'),
    'true',
    'a composed control is looked at after it re-renders',
  )
  await new Promise((resolve) => setTimeout(resolve, 5))
  assertFalse(group.hasAttribute('aria-invalid'))
  assertEquals($(form, '#g-error'), null)
  detach()
})

Deno.test('validateInline: a disabled control is not validated', () => {
  const form = mount('v21', REQUIRED('a', 'disabled'))
  const detach = attachValidateInline({ formId: 'v21' })
  assert(submit(form))
  detach()
})

Deno.test('validateInline: a cancelled submit dispatches space:form-invalid with the controls and messages', () => {
  const form = mount(
    'v22',
    field('a', REQUIRED('a', 'data-message-required="A!"')) + field('c', REQUIRED('c')),
  )
  const detach = attachValidateInline({ formId: 'v22' })
  const seen: FormInvalidDetail[] = []
  globals.document.body.addEventListener(
    FORM_INVALID_EVENT,
    (e: CustomEvent<FormInvalidDetail>) => {
      seen.push(e.detail)
    },
  )
  submit(form)
  assertEquals(seen.length, 1)
  assertEquals(seen[0].invalid.length, 2)
  assert(seen[0].invalid[0].control === $(form, '#a-input'))
  assertEquals(seen[0].invalid[0].message, 'A!')
  detach()
})

Deno.test('validateInline: no summary event when the submit goes through', () => {
  const form = mount('v23', REQUIRED('a', 'value="x"'))
  const detach = attachValidateInline({ formId: 'v23' })
  let calls = 0
  form.addEventListener(FORM_INVALID_EVENT, () => calls++)
  assert(submit(form))
  assertEquals(calls, 0)
  detach()
})

Deno.test('validateInline: a cancelled submit never reaches the submit guard, which stays usable', () => {
  const form = mount('v24', REQUIRED('a') + '<button id="go">Send</button>')
  const detachGuard = attachManagedForm({ formId: 'v24', validateInline: true, submitGuard: true })
  assertFalse(submit(form))
  assertFalse(($(form, '#go') as unknown as HTMLButtonElement).disabled)
  const input = form.querySelector('input') as HTMLInputElement
  input.value = 'ok'
  assert(submit(form), 'the corrected form is let through')
  assert(
    ($(form, '#go') as unknown as HTMLButtonElement).disabled,
    'the guard acts on the real submit',
  )
  detachGuard()
})

Deno.test('validateInline: it coexists with clearInvalidOnInput; the error returns when the field is left invalid', () => {
  const form = mount('v25', field('a', REQUIRED('a')))
  const detach = attachManagedForm({
    formId: 'v25',
    validateInline: true,
    clearInvalidOnInput: true,
    focusFirstInvalid: true,
  })
  const input = $(form, '#a-input') as unknown as HTMLInputElement
  submit(form)
  assertEquals(input.getAttribute('aria-invalid'), 'true')
  input.value = 'x'
  fire(input, 'input')
  assertFalse(input.hasAttribute('aria-invalid'))
  input.value = ''
  fire(input, 'focusout')
  assertEquals(input.getAttribute('aria-invalid'), 'true')
  assertFalse($(form, '#a-error').hasAttribute('hidden'))
  detach()
})

Deno.test('validateInline: attaching clearInvalidOnInput alone leaves a client error to its own listener', () => {
  const form = mount('v26', field('a', REQUIRED('a')))
  const d1 = attachValidateInline({ formId: 'v26' })
  const d2 = attachClearInvalidOnInput({ formId: 'v26' })
  const input = $(form, '#a-input') as unknown as HTMLInputElement
  submit(form)
  input.value = 'x'
  fire(input, 'input')
  assertFalse(input.hasAttribute('aria-invalid'))
  d2()
  d1()
})

Deno.test('validateInline: reset clears every error it showed', () => {
  const form = mount('v27', field('a', REQUIRED('a')))
  const detach = attachValidateInline({ formId: 'v27' })
  submit(form)
  fire(form, 'reset')
  assertEquals($(form, '#a-error'), null)
  assertFalse($(form, '#a-input').hasAttribute('aria-invalid'))
  detach()
})

Deno.test('validateInline: cleanup removes the error elements it created and detaches', () => {
  const form = mount('v28', field('a', REQUIRED('a')))
  const detach = attachValidateInline({ formId: 'v28' })
  submit(form)
  detach()
  assertEquals($(form, '#a-error'), null)
  assert(submit(form), 'detached: the form no longer validates itself')
})

Deno.test('validateInline: without the option the form is untouched', () => {
  const form = mount('v29', field('a', REQUIRED('a')))
  const detach = attachManagedForm({ formId: 'v29', focusFirstInvalid: true })
  assertFalse(form.noValidate)
  assert(submit(form))
  assertEquals($(form, '[data-space-ui=alert]'), null)
  detach()
})

Deno.test('validateInline: a missing form attaches nothing', () => {
  resetDom()
  attachValidateInline({ formId: 'nope' })()
})
